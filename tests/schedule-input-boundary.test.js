import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess, SCHEDULE_REQUEST_MAX_BYTES } from '../src/security/apiAccess.js';

const headers = { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' };
let sequence = 0;
async function fixture(role = 'leader', storedRows = []) {
  const state = { queries: [], parses: 0, sheets: 0, notifications: 0 };
  const deps = {
    Hono, console: { log(){}, warn(){}, error(){} }, process: { env: {} },
    query: async (sql, params) => {
      state.queries.push({ sql, params });
      if (sql.includes('SELECT * FROM absence_requests')) return { rows: [{ id: 7, status: 'pending', tutor_name: 'Synthetic', tutor_email: 'own@example.test' }] };
      if (sql.includes('SELECT absence_type')) return { rows: [{ absence_type: 'cancel' }] };
      if (sql.includes('FROM absence_requests')) return { rows: storedRows };
      return { rows: sql.includes('INSERT INTO absence_requests') ? [{ id: 7 }] : [] };
    },
    fetchSchedulesFromSheet: async () => { state.sheets++; return []; },
    fetchIndividualWebhooks: async () => { state.sheets++; return {}; },
    fetchTutorWebhooks: async () => { state.sheets++; return {}; },
    notifyAbsenceRequest: async () => { state.notifications++; return { success: true }; },
    notifyAbsenceApproval: async () => { state.notifications++; return { success: true }; }
  };
  let source = await readFile(new URL('../src/routes/schedules.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '')
    .replaceAll("await import('../services/sheetsService.js')", 'deps')
    .replaceAll("await import('../services/discordService.js')", 'deps');
  assert.equal(source.includes('import('), false);
  const key = 'scheduleBoundary' + sequence++; globalThis[key] = deps;
  let routes;
  try { routes = (await import('data:text/javascript;base64,' + Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const {Hono,query,console,process,fetchSchedulesFromSheet,fetchIndividualWebhooks,fetchTutorWebhooks,notifyAbsenceRequest,notifyAbsenceApproval}=deps;\n` + source).toString('base64'))).default; }
  finally { delete globalThis[key]; }
  const app = new Hono();
  app.use('/api/*', async (c, next) => { const parse = c.req.json.bind(c.req); c.req.json = (...args) => { state.parses++; return parse(...args); }; return next(); });
  installApiAccess(app, { db: async () => ({ rows: [{ id: 7, role, email: 'own@example.test', tutor_name: 'Trusted', must_change_password: false }] }) });
  app.route('/api/schedules', routes);
  return { app, state };
}
function stream(parts) {
  let i = 0; const seen = { pulls: 0, canceled: false };
  return { seen, body: new ReadableStream({ pull(c){ seen.pulls++; if(i < parts.length)c.enqueue(parts[i++]);else c.close(); }, cancel(){ seen.canceled = true; } }, { highWaterMark: 0 }) };
}
const req = (path, body, extra = {}, method = 'POST') => new Request('http://fixture.invalid/api/schedules' + path, { method, headers: { ...headers, ...extra }, body, duplex: 'half' });
const valid = { event_id: 'synthetic/event', tutor_email: 'own@example.test', tutor_name: 'Synthetic', absence_type: 'cancel', reason: 'Synthetic reason', schedule_date: '2026/10/29', schedule_time: '12:00', schedule_title: 'Synthetic title', matched_keyword: 'Synthetic' };

test('absence create and approval have preparse byte bounds after authentication and role checks', async () => {
  assert.equal(SCHEDULE_REQUEST_MAX_BYTES, 262144);
  for (const path of ['/absence', '/absence/7/approve', '/absence/%2F/approve']) {
    const a = await fixture(), anon = stream([new Uint8Array(1)]);
    assert.equal((await a.app.request(new Request('http://fixture.invalid/api/schedules' + path, { method: 'POST', body: anon.body, duplex: 'half' }))).status, 401);
    assert.equal(anon.seen.pulls, 0);
    const f = await fixture(), s = stream([new Uint8Array(1)]);
    assert.equal((await f.app.request(req(path, s.body, { 'Content-Length': '262145' }))).status, 413);
    assert.equal(s.seen.pulls, 0); assert.equal(f.state.parses, 0); assert.equal(f.state.queries.length, 0);
    for (const declared of [undefined, '1']) {
      const g = await fixture(), actual = stream([new Uint8Array(131072), new Uint8Array(131073)]);
      assert.equal((await g.app.request(req(path, actual.body, declared ? { 'Content-Length': declared } : {}))).status, 413);
      assert.equal(actual.seen.canceled, true); assert.equal(g.state.parses, 0); assert.equal(g.state.queries.length, 0);
    }
  }
  const crew = await fixture('crew'), own = stream([new Uint8Array(262145)]);
  assert.equal((await crew.app.request(req('/absence', own.body))).status, 413); assert.equal(crew.state.parses, 0);
  for (const path of ['/absence/7/approve', '/absence/%2F/approve']) {
    const f = await fixture('crew'), s = stream([new Uint8Array(1)]);
    assert.equal((await f.app.request(req(path, s.body, { 'Content-Length': '262145' }))).status, 403); assert.equal(s.seen.pulls, 0);
  }
});

test('unshaped absence JSON and invalid required or optional strings fail before business SQL or notifications', async () => {
  const f = await fixture();
  for (const raw of ['{', 'null', '[]', '1', '"text"']) assert.equal((await f.app.request(req('/absence', raw))).status, 400);
  for (const key of ['event_id','tutor_email','tutor_name','absence_type','reason']) for(const value of [null, 1, false, {}, [], '', ' ', '\u0000']) {
    assert.equal((await f.app.request(req('/absence', JSON.stringify({ ...valid, [key]: value })))).status, 400, key);
  }
  for (const key of ['schedule_date','schedule_time','schedule_title','matched_keyword','leader_email']) for(const value of [1, false, {}, [], '\u0000']) {
    assert.equal((await f.app.request(req('/absence', JSON.stringify({ ...valid, [key]: value })))).status, 400, key);
  }
  assert.equal(f.state.queries.length, 0); assert.equal(f.state.sheets, 0); assert.equal(f.state.notifications, 0);
});

test('normal exact-limit own creation and trusted leader approval keep existing saved values', async () => {
  const f = await fixture('crew'), body = { ...valid, padding: '' };
  body.padding = 'x'.repeat(262144 - Buffer.byteLength(JSON.stringify(body)));
  assert.equal((await f.app.request(req('/absence', JSON.stringify(body)))).status, 200);
  const insert = f.state.queries.find(row => row.sql.includes('INSERT INTO absence_requests'));
  assert.deepEqual(insert.params, [valid.event_id, valid.tutor_email, valid.tutor_name, 'cancel', valid.reason, 2026, 10, valid.schedule_date, valid.schedule_time, valid.schedule_title, valid.matched_keyword]);
  const foreign = await fixture('crew'); assert.equal((await foreign.app.request(req('/absence', JSON.stringify({ ...valid, tutor_email: 'other@example.test' })))).status, 403); assert.equal(foreign.state.queries.length, 0);
  const g = await fixture(); assert.equal((await g.app.request(req('/absence/7/approve', JSON.stringify({ leader_email: 'untrusted@example.test' })))).status, 200);
  assert.deepEqual(g.state.queries.find(row => row.sql.includes("SET status = 'approved'")).params, ['own@example.test', '7']);
});

test('approval serial IDs and object JSON reject malformed input before queries', async () => {
  const f = await fixture();
  for (const id of ['0','01','-1','1.0','2147483648','x','%2F']) assert.equal((await f.app.request(req('/absence/' + id + '/approve', '{}'))).status, 400);
  for (const raw of ['{','null','[]','1','"text"']) assert.equal((await f.app.request(req('/absence/7/approve', raw))).status, 400);
  const broken = new ReadableStream({ pull(c){ c.error(Error('PRIVATE_SENTINEL')); } });
  const response = await f.app.request(req('/absence', broken)); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));
  assert.equal(f.state.queries.length, 0); assert.equal(f.state.notifications, 0);
});

test('monthly reads reject invalid periods before SQL or Sheets and accept defaults and padded months', async () => {
  for (const path of ['/absence-stats','/absence-requests','/absence-requests/pending']) {
    const f = await fixture();
    for (const query of ['year=0','year=10000','year=2026x','year=1e3','year=-1','month=0','month=13','month=1.5','month=x']) assert.equal((await f.app.request('http://fixture.invalid/api/schedules' + path + '?' + query, { headers })).status, 400);
    assert.equal(f.state.queries.length, 0); assert.equal(f.state.sheets, 0);
    for (const query of ['', '?year=2026&month=01']) assert.equal((await f.app.request('http://fixture.invalid/api/schedules' + path + query, { headers })).status, 200);
  }
  const f = await fixture(); assert.equal((await f.app.request(req('/absence/synthetic%00/own%40example.test', undefined, {}, 'DELETE'))).status, 400); assert.equal(f.state.queries.length, 0);
  assert.equal((await f.app.request(req('/absence/synthetic%2Fevent/own%40example.test', undefined, {}, 'DELETE'))).status, 200);
});

test('stored prototype-like event and email keys remain data without mutating object prototypes', async () => {
  const email = 'synthetic-prototype@example.test';
  assert.equal(Object.hasOwn(Object.prototype, email), false);
  for (const event_id of ['__proto__','constructor','toString']) {
    const f = await fixture('leader', [{ event_id, tutor_email: email, tutor_name: 'Synthetic', absence_type: 'cancel', count: '1', id: 7, reason: 'Synthetic' }]);
    const approved = await f.app.request('http://fixture.invalid/api/schedules/absence-requests?year=2026&month=10', { headers });
    assert.equal(approved.status, 200); assert.equal((await approved.json()).data.requests[event_id][0].tutor_email, email);
    const pending = await f.app.request('http://fixture.invalid/api/schedules/absence-requests/pending?year=2026&month=10', { headers });
    assert.equal(pending.status, 200); assert.equal((await pending.json()).data.pendingRequests[0].event_id, event_id);
    assert.equal(Object.hasOwn(Object.prototype, email), false);
  }
  for (const tutor_email of ['__proto__','constructor']) {
    const f = await fixture('leader', [{ tutor_email, tutor_name: 'Synthetic', absence_type: 'cancel', count: '1' }]);
    const response = await f.app.request('http://fixture.invalid/api/schedules/absence-stats?year=2026&month=10', { headers });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.stats[0].tutor_email, tutor_email);
  }
});
