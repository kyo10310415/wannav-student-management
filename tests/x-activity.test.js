import test from 'node:test';
import assert from 'node:assert/strict';
import { createXActivityReader } from '../src/services/xActivityService.js';
import { actionPeriods } from '../src/services/actionPointRules.js';

function fixture({ posts = [], fail = false } = {}) {
  const cache = new Map(), calls = [];
  const read = createXActivityReader({ token: () => 'synthetic-only', db: async (sql, params) => {
    const [key, value] = params; let row = cache.get(key);
    if (sql.startsWith('SELECT')) return { rows: row ? [{ ...row }] : [] };
    if (sql.startsWith('INSERT')) {
      if (row?.last_attempt_at && value - new Date(row.last_attempt_at) < 7 * 86400000) return { rows: [] };
      row = { ...row, username: key, last_attempt_at: value }; cache.set(key, row); return { rows: [{ ...row }] };
    }
    if (sql.includes('SET x_user_id')) row.x_user_id = value;
    else Object.assign(row, { last_checked_at: value, last_post_at: params[2], last_inactive: params[3] });
    return { rows: [] };
  }, get: async (url, config) => {
    calls.push({ url, config });
    if (url.includes('/by/username/')) return { data: { data: { id: '123' } } };
    if (fail) throw new Error('SYNTHETIC_PRIVATE');
    return { data: { data: posts } };
  } });
  const run = (date, name = 'student') => { const now = new Date(date); return read(name, actionPeriods(now), now); };
  return { run, calls, cache };
}
test('weekly cache blocks manual/daily/month-boundary duplicate reads; user ID is fetched only once', async () => {
  const f = fixture();
  assert.equal((await f.run('2026-10-29')).inactive, true); assert.equal(f.calls.length, 2);
  await f.run('2026-10-30'); await f.run('2026-11-01'); assert.equal(f.calls.length, 2);
  await f.run('2026-11-05'); assert.equal(f.calls.length, 3);
  assert.equal(f.calls.filter(c => c.url.includes('/by/username/')).length, 1);
});
test('known recent post avoids even a weekly API read until its 14-day evidence expires', async () => {
  const f = fixture({ posts: [{ id: '1', created_at: '2026-11-01T00:00:00Z' }] });
  await f.run('2026-11-02'); await f.run('2026-11-09'); await f.run('2026-11-15');
  assert.equal(f.calls.length, 2);
  // At day 15 the cached post is outside the current window; the reader rechecks.
  await assert.rejects(f.run('2026-11-16')); assert.equal(f.calls.length, 3);
});
test('failed timeline attempts are throttled for a week and the successfully fetched ID is retained', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(f.run('2026-11-01')); assert.equal(f.calls.length, 2);
  assert.equal(await f.run('2026-11-02'), null); assert.equal(f.calls.length, 2);
  await assert.rejects(f.run('2026-11-08')); assert.equal(f.calls.length, 3);
});
test('account changes invalidate identity while case and @ changes share cached results', async () => {
  const f = fixture(); await f.run('2026-11-01', '@Student'); await f.run('2026-11-01', 'STUDENT');
  assert.equal(f.calls.length, 2);
  await f.run('2026-11-01', 'other'); assert.equal(f.calls.length, 4);
});
