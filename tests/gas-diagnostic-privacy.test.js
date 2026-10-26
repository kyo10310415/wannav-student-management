import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_GAS_PRIVATE';
let sequence = 0;
async function fixture({ fail = false, messages = [] } = {}) {
  const logs = [], queries = [], sends = [];
  const upstream = () => { throw Object.assign(new Error(marker), { response: { data: marker } }); };
  const deps = { Hono, createHash, timingSafeEqual, GAS_BROADCAST_CREATED_BY: 'gas-broadcast', discordClient: {}, query: async (...args) => { queries.push(args); if (fail) upstream(); return { rows: [{}] }; }, enqueueBroadcast: async (...args) => { sends.push(args); if (fail) upstream(); return { jobId: 'job', broadcastId: 1, total: 1 }; }, getBroadcastJobStatus: async () => ({ job_id: 'job', broadcast_id: 1, status: 'completed', total: 1, sent: 1, failed: 0 }), getBroadcastLogs: async () => messages.map(error_message => ({ student_id: 'fixture', student_name: 'fixture', status: 'failed', error_message, sent_at: null })), console: { error: (...args) => logs.push(inspect(args)) } };
  const source = (await readFile(new URL('../src/routes/gasBroadcast.js', import.meta.url), 'utf8'))
    .replace(/import \{[\s\S]*?\} from '[^']+';\r?\n/g, '')
    .replace("import { client as discordClient } from '../services/discordService.js';", '');
  assert.equal(/\bimport\s/.test(source), false);
  const key = 'gasPrivacy' + sequence++;
  globalThis[key] = deps;
  try {
    const module = await import('data:text/javascript;base64,' + Buffer.from(`const { Hono, createHash, timingSafeEqual, GAS_BROADCAST_CREATED_BY, discordClient, query, enqueueBroadcast, getBroadcastJobStatus, getBroadcastLogs, console } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64'));
    return { app: module.createGasBroadcastRoutes({ ...deps, discordClient: { isReady: () => true }, getApiKey: () => 'fixture-key' }), logs, queries, sends };
  } finally { delete globalThis[key]; }
}
const auth = { headers: { 'X-API-Key': 'fixture-key' } };
const post = { method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignKey: 'fixture', content: marker, targets: [{ studentId: 'fixture', studentName: 'fixture', chatUrl: 'https://discord.com/channels/' + '1'.repeat(18) + '/' + '2'.repeat(18) }] }) };
test('GAS queue and both read error boundaries conceal upstream logs and responses', async () => {
  const f = await fixture({ fail: true });
  for (const [path, options] of [['/send', post], ['/jobs/job', auth], ['/results/1', auth]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes(marker), false);
  }
  assert.equal(f.logs.length, 3); assert.equal(f.logs.join('\n').includes(marker), false);
});
test('GAS results conceal historical raw error details while retaining known fixed diagnostics and business fields', async () => {
  const messages = [marker, null, '', 'Broadcast delivery failed', 'No chat URL', 'No arbitrary-secret URL'];
  const f = await fixture({ messages });
  const response = await f.app.request('/results/1', auth);
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(results.map(x => x.errorMessage), ['Broadcast delivery failed', null, '', 'Broadcast delivery failed', 'No chat URL', 'Broadcast delivery failed']);
  assert.equal(results.every(x => x.studentId === 'fixture' && x.studentName === 'fixture' && x.status === 'failed'), true);
});
test('anonymous and incorrect machine keys cannot query or send', async () => {
  const f = await fixture();
  for (const path of ['/jobs/job', '/results/1']) {
    assert.equal((await f.app.request(path)).status, 401);
    assert.equal((await f.app.request(path, { headers: { 'X-API-Key': 'wrong' } })).status, 401);
  }
  assert.equal(f.queries.length + f.sends.length, 0);
});
