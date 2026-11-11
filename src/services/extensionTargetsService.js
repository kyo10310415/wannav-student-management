let cached, pending;
export async function fetchMonthlyExtensionTargets(fetchImpl = fetch, env = process.env) {
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date());
  const base = env.EXTENSION_TARGETS_API_URL;
  const token = env.EXTENSION_TARGETS_READ_TOKEN;
  if (!base || !token) throw new Error('Monthly targets not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/monthly-targets/current') throw new Error('Invalid targets URL');
  const key = `${base}:${token}`;
  if (cached?.key === key && cached.month === month && Date.now() - cached.at < 60000) return cached.value;
  if (pending?.key === key) return pending.promise;
  const promise = (async () => {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error('Monthly targets unavailable');
    const value = await response.json();
    if (value.success !== true || value.month !== month || !Array.isArray(value.data) || value.data.some(row =>
      typeof row.studentId !== 'string' || ![row.hearing, row.examination].every(rounds => Array.isArray(rounds) && rounds.every(n => Number.isInteger(n) && n >= 1 && n <= 10)))) throw new Error('Invalid targets response');
    cached = { key, month, at: Date.now(), value };
    return value;
  })();
  pending = { key, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}
