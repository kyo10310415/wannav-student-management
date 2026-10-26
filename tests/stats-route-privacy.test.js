import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
let sequence = 0;
async function fixture(role = 'admin', fail = false) {
  const logs = [], sends = [];
  const deps = { Hono, console: { log() {}, error: (...args) => logs.push(inspect(args)) }, sendDailyStatsReport: async () => { sends.push(true); if (fail) throw Error('SYNTHETIC_STATS_PRIVATE'); } };
  const source = (await readFile(new URL('../src/routes/stats.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'statsPrivacy' + sequence++;
  globalThis[key] = deps; let route;
  try { route = (await import('data:text/javascript;base64,' + Buffer.from(`const { Hono, console, sendDailyStatsReport } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64'))).default; }
  finally { delete globalThis[key]; }
  const app = new Hono(); installApiAccess(app, { db: async () => ({ rows: [{ id: 1, email: 'fixture@example.invalid', role }] }) }); app.route('/api/stats', route);
  return { app, logs, sends };
}
const post = { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } };
test('manual statistics upstream failures return fixed diagnostics and no private log details', async () => {
  const f = await fixture('admin', true); const response = await f.app.request('/api/stats/send', post);
  assert.equal(response.status, 500); assert.equal((await response.json()).error, 'Statistics report could not be sent');
  assert.equal(f.logs.join('\n').includes('SYNTHETIC_STATS_PRIVATE'), false);
});
test('admin and leader retain manual send while crew and anonymous requests never invoke it', async () => {
  for (const role of ['admin', 'leader', 'crew']) {
    const f = await fixture(role); const response = await f.app.request('/api/stats/send', post);
    assert.equal(response.status, role === 'crew' ? 403 : 200); assert.equal(f.sends.length, role === 'crew' ? 0 : 1);
  }
  const f = await fixture(); assert.equal((await f.app.request('/api/stats/send', { method: 'POST' })).status, 401); assert.equal(f.sends.length, 0);
});
