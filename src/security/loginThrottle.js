import { createHash } from 'node:crypto';

// Process-local protection: limits reset on restart and are not shared by replicas.
export function createLoginThrottle({ now = Date.now, maxFailures = 5, accountWindowMs = 15 * 60_000,
  maxConcurrent = 4, maxEntries = 10_000 } = {}) {
  const accounts = new Map();
  let inFlight = 0, sweepAt = now();
  const denied = milliseconds => ({ allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(milliseconds / 1000)) });
  return {
    begin(email) {
      const time = now();
      if (inFlight >= maxConcurrent) return denied(1000);
      if (time >= sweepAt) {
        for (const [key, entry] of accounts) if (entry.expires <= time && entry.pending === 0) accounts.delete(key);
        sweepAt = time + 60_000;
      }
      const key = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
      let entry = accounts.get(key);
      if (entry && entry.expires <= time && entry.pending === 0) { accounts.delete(key); entry = undefined; }
      if (!entry) {
        // Bounded LRU avoids letting arbitrary email addresses lock out everyone.
        // Eviction under extreme cardinality can reset an account's local budget.
        if (accounts.size >= maxEntries) {
          for (const [oldKey, oldEntry] of accounts) {
            if (oldEntry.pending === 0) { accounts.delete(oldKey); break; }
          }
          if (accounts.size >= maxEntries) return denied(1000);
        }
        entry = { failures: 0, pending: 0, expires: time + accountWindowMs };
        accounts.set(key, entry);
      }
      accounts.delete(key);
      accounts.set(key, entry);
      // Reserve pending checks too, so concurrent requests cannot exceed the budget.
      if (entry.failures + entry.pending >= maxFailures) return denied(entry.expires - time);
      entry.pending++; inFlight++;
      let finished = false;
      return {
        allowed: true,
        finish(outcome = 'error') {
          if (finished) return;
          finished = true;
          entry.pending--; inFlight--;
          if (outcome === 'failure') entry.failures++;
          if (outcome === 'success') entry.failures = 0;
          if (entry.pending === 0 && entry.failures === 0) accounts.delete(key);
        }
      };
    }
  };
}
