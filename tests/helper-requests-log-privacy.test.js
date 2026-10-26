import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_HELPER_PRIVATE';
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, detail: marker, config: { url: marker } });
const record = { id: 42, student_id: marker, student_name: marker, requesting_tutor_id: marker,
  requesting_tutor_name: marker, deadline: '2099-01-01T00:00:00Z', status: 'pending' };
const body = { lesson_date: '2026-10-26', lesson_time: '12:00', student_id: marker, student_name: marker, notion_url: marker,
  requesting_tutor_id: 'forged', requesting_tutor_name: 'forged', lesson_progress: 3, reason: marker, notes: marker, deadline: record.deadline };
const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
let sequence = 0;
async function fixture({ role = 'crew', query = async () => ({ rows: [record] }), notifyFail = false } = {}) {
  const logs = [], queries = [], notifications = [];
  const deps = { Hono, query: async (...args) => { queries.push(args); return query(...args); },
    notifyHelperRequestCreated: async request => { notifications.push(request); if (notifyFail) throw failure(); },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/helper-requests.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace("import { notifyHelperRequestCreated } from '../services/helperNotificationService.js';", 'const { notifyHelperRequestCreated } = deps;');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'helperPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const root = new Hono();
  root.use('*', async (c, next) => { c.set('authenticatedUser', { role, employee_id: marker, tutor_name: marker }); return next(); });
  root.route('/', app);
  return { app: root, logs, queries, notifications };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all DB error routes return only fixed errors and private logs', async () => {
  const f = await fixture({ query: async () => { throw failure(); } });
  for (const [path, options] of [['/'], ['/42'], ['/', post(body)], ['/42/accept', post({ tutor_id: marker, tutor_name: marker })],
    ['/check-expired', post({})], ['/42', { method: 'DELETE' }]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Helper request operation failed' });
  }
  assert.equal(f.notifications.length, 0); safe(f);
});

test('list and single success data remain intact and missing record stays 404', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/')).json(), { success: true, data: [record] });
  assert.deepEqual(await (await f.app.request('/42')).json(), { success: true, data: record });
  assert.deepEqual(f.queries[1][1], ['42']); safe(f);
  const empty = await fixture({ query: async () => ({ rows: [] }) });
  assert.equal((await empty.app.request('/42')).status, 404); safe(empty);
});

test('create preserves trusted crew identity, administrator input, counters and notification payload', async () => {
  for (const role of ['crew', 'admin']) {
    const f = await fixture({ role });
    assert.deepEqual(await (await f.app.request('/', post(body))).json(), { success: true, data: record });
    assert.deepEqual(f.queries[0][1], [body.lesson_date, body.lesson_time, marker, marker, marker,
      role === 'crew' ? marker : 'forged', role === 'crew' ? marker : 'forged', 3, marker, marker, record.deadline]);
    assert.ok(f.queries[1][0].includes('helper_request_count = COALESCE(helper_request_count, 0) + 1'));
    assert.deepEqual(f.queries[1][1], [role === 'crew' ? marker : 'forged']);
    assert.deepEqual(f.notifications, [record]); safe(f);
  }
});

test('notification and post-insert failure preserve existing partial-write failure contract', async () => {
  for (const options of [{ notifyFail: true }, { query: async sql => { if (sql.includes('UPDATE tutors')) throw failure(); return { rows: [record] }; } }]) {
    const f = await fixture(options);
    const response = await f.app.request('/', post(body)); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Helper request operation failed' });
    assert.equal(f.queries.length, 2); assert.equal(f.notifications.length, options.notifyFail ? 1 : 0); safe(f);
  }
});

test('accept keeps trusted crew identity, pending condition and one counter increment without notification', async () => {
  const f = await fixture();
  const response = await f.app.request('/42/accept', post({ tutor_id: 'forged', tutor_name: 'forged' }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.queries[1][1], [marker, marker, '42']);
  assert.ok(f.queries[1][0].includes("WHERE id = $3 AND status = 'pending'"));
  assert.deepEqual(f.queries[2][1], [marker]); assert.equal(f.notifications.length, 0); safe(f);
  for (const [rows, status] of [[[], 404], [[{ ...record, deadline: '2000-01-01' }], 400]]) {
    const skipped = await fixture({ query: async () => ({ rows }) });
    assert.equal((await skipped.app.request('/42/accept', post({}))).status, status);
    assert.equal(skipped.queries.length, 1); safe(skipped);
  }
  const raced = await fixture({ query: async sql => ({ rows: sql.includes('SELECT *') ? [record] : [] }) });
  assert.equal((await raced.app.request('/42/accept', post({}))).status, 404);
  assert.equal(raced.queries.length, 2); safe(raced);
});

test('expiry preserves pending/deadline predicates and per-request tutor counters without notifications', async () => {
  const f = await fixture({ query: async sql => ({ rows: sql.includes('SELECT *') ? [record, { ...record, requesting_tutor_id: marker + '-2' }] : [] }) });
  assert.deepEqual(await (await f.app.request('/check-expired', post({}))).json(), { success: true, message: 'Updated 2 expired requests' });
  assert.ok(f.queries[1][0].includes("WHERE status = 'pending' AND deadline < NOW()"));
  assert.deepEqual(f.queries.slice(2).map(call => call[1]), [[marker], [marker + '-2']]);
  assert.equal(f.notifications.length, 0); safe(f);
  const empty = await fixture({ query: async () => ({ rows: [] }) });
  assert.deepEqual(await (await empty.app.request('/check-expired', post({}))).json(), { success: true, message: 'No expired requests found' });
  assert.equal(empty.queries.length, 1); safe(empty);
});

test('delete preserves accepted-tutor counter and does not mutate absent requests', async () => {
  const f = await fixture({ query: async () => ({ rows: [{ ...record, status: 'accepted', accepted_by_tutor_id: marker + '-accepted' }] }) });
  assert.deepEqual(await (await f.app.request('/42', { method: 'DELETE' })).json(), { success: true, message: 'Helper request deleted successfully' });
  assert.ok(f.queries[1][0].includes('DELETE FROM helper_requests WHERE id = $1'));
  assert.deepEqual(f.queries[1][1], ['42']);
  assert.deepEqual(f.queries.slice(2).map(call => call[1]), [[marker], [marker + '-accepted']]);
  assert.equal(f.notifications.length, 0); safe(f);
  const empty = await fixture({ query: async () => ({ rows: [] }) });
  assert.equal((await empty.app.request('/42', { method: 'DELETE' })).status, 404);
  assert.equal(empty.queries.length, 1); safe(empty);
});
