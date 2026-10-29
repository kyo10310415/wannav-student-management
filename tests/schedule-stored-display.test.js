import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf('function ' + name + '('); return source.slice(start, source.indexOf('\n}', start) + 2); };
const marker = '<b data-synthetic="display">fixture</b>';
const escapeHtml = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(role = 'admin') {
  const calls = [], listeners = [], root = { contains: node => node.root === root };
  const request = { id: 42, tutor_name: marker, tutor_email: 'own@example.test', absence_type: 'cancel', reason: marker, created_at: '2026-10-29T00:00:00Z' };
  const schedule = { event_id: "event'\"<fixture>", title: marker, matched_keyword: marker, leader_name: marker, schedule_date: marker, schedule_time: marker, attendee_names: [marker], absence_requests: [request] };
  const context = { escapeHtml, getFilteredSchedules: () => [schedule], currentTutorEmail: request.tutor_email, currentUser: { role }, sessionToken: 'synthetic', currentPage: 'schedules', pendingRequests: [{ matched_keyword: marker, schedule_title: marker, schedule_date: marker, schedule_time: marker, requests: [request] }], document: { getElementById: () => root, addEventListener: (...args) => listeners.push(args) }, approveAbsenceRequest: (...args) => calls.push(['approve', ...args]), cancelAbsenceRequest: (...args) => calls.push(['cancel', ...args]) };
  vm.createContext(context);
  vm.runInContext(['renderSchedulesList', 'renderPendingRequests', 'handleAbsenceActionClick'].map(extract).join('\n'), context);
  const button = dataset => { const node = { dataset, root, disabled: false }; node.closest = () => node; return node; };
  return { context, request, schedule, calls, button };
}
test('real shared list and pending renderers display stored benign tags literally', () => {
  const f = fixture();
  for (const html of [f.context.renderSchedulesList(), f.context.renderPendingRequests()]) {
    assert.equal(html.includes(marker), false); assert.ok(html.includes('&lt;b data-synthetic='));
    assert.equal(/onclick="(?:cancel|approve)AbsenceRequest/.test(html), false);
  }
  assert.ok(f.context.renderSchedulesList().includes('data-absence-event-key="event\'&quot;&lt;fixture&gt;"'));
  assert.ok(f.context.renderPendingRequests().includes('data-absence-request-id="42"'));
  f.context.currentUser.role = 'crew'; assert.equal(f.context.renderPendingRequests().includes('data-absence-action="approve"'), false);
  f.context.currentUser.role = 'admin'; f.request.id = 'invalid'; assert.equal(f.context.renderPendingRequests().includes('data-absence-action="approve"'), false);
});
test('fixed actions use cached values and preserve manager approval and own cancellation', () => {
  const f = fixture();
  const approve = f.button({ absenceAction: 'approve', absenceRequestId: '42' });
  const cancel = f.button({ absenceAction: 'cancel', absenceEventKey: f.schedule.event_id, absenceEmail: f.request.tutor_email });
  f.context.handleAbsenceActionClick({ target: approve }); f.context.currentUser.role = 'crew';
  f.context.handleAbsenceActionClick({ target: cancel }); f.context.handleAbsenceActionClick({ target: approve });
  assert.deepEqual(f.calls, [['approve', 42, marker], ['cancel', f.schedule.event_id, f.request.tutor_email]]);
  f.calls.length = 0;
  for (const change of [() => cancel.disabled = true, () => { cancel.disabled = false; cancel.root = {}; }, () => { cancel.root = f.button({}).root; f.context.currentPage = 'students'; }, () => { f.context.currentPage = 'schedules'; f.context.sessionToken = ''; }]) { change(); f.context.handleAbsenceActionClick({ target: cancel }); }
  assert.equal(f.calls.length, 0);
  f.context.sessionToken = 'synthetic'; f.context.currentUser.role = 'admin';
  for (const id of ['0','01','42.0','9007199254740992','43']) f.context.handleAbsenceActionClick({ target: f.button({ absenceAction: 'approve', absenceRequestId: id }) });
  f.context.handleAbsenceActionClick({ target: f.button({ absenceAction: 'cancel', absenceEventKey: f.schedule.event_id, absenceEmail: 'other@example.test' }) });
  assert.equal(f.calls.length, 0);
});
test('real crew access middleware and mocked SQL prove own stored payload and reject foreign email', async () => {
  const queries = [], sends = [], token = 'a'.repeat(64);
  const deps = { Hono, console: { log(){}, warn(){}, error(){} }, process: { env: {} }, query: async (sql, params) => { queries.push([sql,params]); return { rows: sql.includes('INSERT INTO absence_requests') ? [{ id: 42 }] : [] }; }, fetchSchedulesFromSheet: async () => [], fetchIndividualWebhooks: async () => ({}), fetchTutorWebhooks: async () => ({}), notifyAbsenceRequest: async () => sends.push('request'), notifyAbsenceApproval: async () => sends.push('approval') };
  let route = await readFile(new URL('../src/routes/schedules.js', import.meta.url), 'utf8');
  route = route.replace("import { Hono } from 'hono';", 'const { Hono } = deps;').replace("import { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } from '../services/sheetsService.js';", 'const { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } = deps;').replace("import { query } from '../db/connection.js';", 'const { query } = deps;').replace("import { notifyAbsenceRequest, notifyAbsenceApproval } from '../services/discordService.js';", 'const { notifyAbsenceRequest, notifyAbsenceApproval } = deps;').replaceAll("await import('../services/sheetsService.js')", 'deps').replaceAll("await import('../services/discordService.js')", 'deps');
  assert.equal(route.includes('import('), false);
  globalThis.absenceDisplayFixture = deps;
  let routes; try { routes = (await import('data:text/javascript;base64,' + Buffer.from('const deps = globalThis.absenceDisplayFixture; const { console, process } = deps;\n' + route).toString('base64'))).default; } finally { delete globalThis.absenceDisplayFixture; }
  const app = new Hono();
  installApiAccess(app, { db: async sql => { assert.ok(sql.includes('FROM sessions')); return { rows: [{ id: 7, email: 'own@example.test', role: 'crew', tutor_name: 'Trusted Fixture', must_change_password: false }] }; } });
  app.route('/api/schedules', routes);
  const body = { event_id: 'fixture', tutor_email: 'own@example.test', tutor_name: marker, reason: marker, schedule_title: marker, matched_keyword: marker, absence_type: 'cancel', schedule_date: '2026/10/29', schedule_time: '12:00' };
  const post = value => ({ method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await app.request('/api/schedules/absence', post(body))).status, 200);
  const insert = queries.find(([sql]) => sql.includes('INSERT INTO absence_requests'));
  assert.ok(insert); for (const index of [2,4,9,10]) assert.equal(insert[1][index], marker);
  queries.length = 0;
  assert.equal((await app.request('/api/schedules/absence', post({ ...body, tutor_email: 'other@example.test' }))).status, 403);
  assert.equal(queries.length, 0); assert.equal(sends.length, 0);
});
