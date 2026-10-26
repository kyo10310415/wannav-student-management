import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_SCHEDULE_PRIVATE';
const body = { event_id: marker, tutor_email: marker, tutor_name: marker, absence_type: 'cancel', reason: marker,
  schedule_date: '2026/10/26', schedule_time: '12:00', schedule_title: marker, matched_keyword: marker, leader_email: marker };
const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const rawError = () => Object.assign(new Error(marker), { config: { url: marker }, response: { data: marker } });
let sequence = 0;
async function fixture({ query = async () => ({ rows: [] }), schedules = [], sheetFail = false, notifyFail = false, partialTutor = false } = {}) {
  const logs = [], queries = [], sends = [];
  const deps = { Hono, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    process: { env: { APP_URL: 'https://fixture.example.test' } },
    query: async (...args) => { queries.push(args); return query(...args); },
    fetchSchedulesFromSheet: async () => { if (sheetFail) throw rawError(); return schedules; },
    fetchIndividualWebhooks: async () => ({ [marker.toLowerCase()]: { webhook: marker, discordUserId: marker } }),
    fetchTutorWebhooks: async () => ({ [partialTutor ? marker + '-suffix' : marker]: { webhook: marker, discordUserId: marker } }),
    notifyAbsenceRequest: async (...args) => { sends.push({ kind: 'request', args }); if (notifyFail) throw rawError(); return { success: true }; },
    notifyAbsenceApproval: async (...args) => { sends.push({ kind: 'approval', args }); if (notifyFail) throw rawError(); return { success: true }; } };
  let source = await readFile(new URL('../src/routes/schedules.js', import.meta.url), 'utf8');
  source = source.replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
    .replace("import { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } from '../services/sheetsService.js';", 'const { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } = deps;')
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace("import { notifyAbsenceRequest, notifyAbsenceApproval } from '../services/discordService.js';", 'const { notifyAbsenceRequest, notifyAbsenceApproval } = deps;')
    .replace("await import('../services/sheetsService.js')", 'deps')
    .replace("await import('../services/discordService.js')", 'deps');
  assert.equal(source.includes('import('), false);
  const key = 'schedulePrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const root = new Hono();
  root.use('*', async (c, next) => { c.set('authenticatedUser', { email: marker + '-approver', tutor_name: marker + '-approver' }); return next(); });
  root.route('/', app);
  return { app: root, logs, queries, sends };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all schedule DB error responses stay fixed and private', async () => {
  const f = await fixture({ query: async () => { throw rawError(); } });
  const targets = [['/'], ['/absence', post(body)], ['/absence/fixture/fixture', { method: 'DELETE' }],
    ['/absence-stats'], ['/absence-requests'], ['/absence-requests/pending'], ['/absence/42/approve', post({})]];
  for (const [path, options] of targets) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Schedule operation failed' });
  }
  safe(f);
});

test('schedule enrichment and provider fallback preserve successful contracts', async () => {
  const f = await fixture({ schedules: [{ account: marker.toLowerCase(), attendees: marker.toLowerCase(), title: marker }],
    query: async () => ({ rows: [{ email: marker, tutor_name: marker }] }) });
  assert.deepEqual(await (await f.app.request('/')).json(), { success: true, data: [{ account: marker.toLowerCase(), attendees: marker.toLowerCase(), title: marker, leader_name: marker, attendee_names: [marker] }] });
  safe(f);
  const failed = await fixture({ sheetFail: true });
  assert.deepEqual(await (await failed.app.request('/')).json(), { success: true, data: [], cache_error: true });
  assert.equal(failed.queries.length, 0);
  safe(failed);
});

test('absence creation and type replacement preserve counters, payload and nonfatal delivery failures', async () => {
  for (const existing of [false, true]) {
    const f = await fixture({ notifyFail: existing, query: async sql => {
      if (sql.includes('SELECT id, absence_type')) return { rows: existing ? [{ id: 42, absence_type: 'reschedule' }] : [] };
      return { rows: [{ id: 42 }] };
    } });
    const response = await f.app.request('/absence', post(body));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { id: 42, absence_type: 'cancel', tutor_name: marker, message: '不参加申請を受け付けました' });
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].args[0], marker);
    assert.equal(f.sends[0].args[1], marker);
    assert.deepEqual(f.sends[0].args[2], Object.fromEntries(['schedule_title', 'schedule_date', 'schedule_time', 'matched_keyword', 'tutor_name', 'tutor_email', 'absence_type', 'reason'].map(k => [k, body[k]])));
    assert.equal(f.sends[0].args[3], 'https://fixture.example.test/?page=schedules');
    assert.ok(f.queries.some(([sql]) => sql.includes('cancel_count = cancel_count + 1')));
    if (existing) assert.ok(f.queries.some(([sql]) => sql.includes('schedule_reschedule_count = GREATEST')));
    safe(f);
  }
});

test('approval preserves partial tutor matching, trusted approver and notification continuation', async () => {
  for (const notifyFail of [false, true]) {
    const f = await fixture({ partialTutor: true, notifyFail, query: async sql => ({ rows: sql.includes('SELECT * FROM absence_requests') ? [{ ...body, status: 'pending' }] : [] }) });
    const response = await f.app.request('/absence/42/approve', post({ leader_email: 'forged', leader_name: 'forged' }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.queries[1][1], [marker + '-approver', '42']);
    assert.equal(f.sends[0].kind, 'approval');
    assert.equal(f.sends[0].args[0], marker);
    assert.equal(f.sends[0].args[2].leader_name, marker + '-approver');
    assert.equal(f.sends[0].args[2].tutor_name, marker);
    safe(f);
  }
});

test('deletion and validation/not-found outcomes preserve their SQL and status', async () => {
  const f = await fixture({ query: async sql => ({ rows: sql.includes('SELECT absence_type') ? [{ absence_type: 'cancel' }] : [] }) });
  assert.equal((await f.app.request('/absence/fixture/fixture', { method: 'DELETE' })).status, 200);
  assert.match(f.queries[1][0], /DELETE FROM absence_requests/);
  assert.match(f.queries[2][0], /cancel_count = GREATEST/);
  const before = f.queries.length;
  assert.equal((await f.app.request('/absence', post({}))).status, 400);
  assert.equal((await f.app.request('/absence', post({ ...body, absence_type: 'invalid' }))).status, 400);
  assert.equal(f.queries.length, before);
  assert.equal((await f.app.request('/absence/42/approve', post({}))).status, 404);
  safe(f);
});

test('absence list, pending groups and statistics retain successful empty and populated responses', async () => {
  const row = { id: 42, event_id: marker, tutor_email: marker, tutor_name: marker, absence_type: 'cancel', reason: marker, schedule_title: marker, schedule_date: '2026/10/26', schedule_time: '12:00', matched_keyword: marker, created_at: 'fixture' };
  const f = await fixture({ query: async sql => ({ rows: sql.includes("status = 'pending'") || sql.includes("status = 'approved'") ? [row] : [] }) });
  const requests = await (await f.app.request('/absence-requests?year=2026&month=10')).json();
  assert.equal(requests.success, true);
  assert.equal(requests.data.requests[marker][0].tutor_email, marker);
  const pending = await (await f.app.request('/absence-requests/pending?year=2026&month=10')).json();
  assert.equal(pending.data.pendingRequests[0].requests[0].reason, marker);
  const stats = await (await f.app.request('/absence-stats?year=2026&month=10')).json();
  assert.deepEqual(stats, { success: true, data: { year: 2026, month: 10, stats: [] } });
  assert.deepEqual(f.queries[0][1], ['2026', '10']);
  safe(f);
});
