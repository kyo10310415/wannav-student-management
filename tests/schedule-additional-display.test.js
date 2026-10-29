import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf('function ' + name + '('); return source.slice(start, source.indexOf('\n}', start) + 2); };
const marker = '<b data-synthetic="display">fixture</b>';
const escapeHtml = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
test('leader and attendee option text and values escape external names while preserving selected raw values', () => {
  const value = '" ' + marker;
  const context = { escapeHtml, schedules: [{ leader_name: value, attendee_names: [value, 'Normal'] }], selectedLeader: value, selectedAttendee: value };
  vm.createContext(context);
  vm.runInContext(['renderLeaderFilterOptions', 'renderAttendeeFilterOptions'].map(extract).join('\n'), context);
  for (const html of [context.renderLeaderFilterOptions(), context.renderAttendeeFilterOptions()]) {
    assert.equal(html.includes(marker), false);
    assert.ok(html.includes('value="&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;" selected'));
    assert.ok(html.includes('すべての'));
  }
  assert.ok(context.renderAttendeeFilterOptions().includes('value="Normal" >Normal</option>'));
});
function fixture() {
  const container = { innerHTML: '' };
  const schedule = { start_time: '2026-10-15T12:00:00', title: '" ' + marker, matched_keyword: marker, schedule_time: marker, attendee_names: [marker] };
  const context = { escapeHtml, selectedScheduleYear: 2026, selectedScheduleMonth: 10, selectedStatsYear: 2026, selectedStatsMonth: 10, getFilteredSchedules: () => [schedule], currentUser: { role: 'admin' }, document: { getElementById: () => container }, absenceStats: { stats: [{ tutor_name: marker, scheduled_count: 4, cancel_count: 1, reschedule_count: 1, total_count: 2, attendance_rate: 50 }] } };
  vm.createContext(context); vm.runInContext(['renderSchedulesCalendar','renderAttendanceStatistics','renderAbsenceStatsSection'].map(extract).join('\n'), context);
  return { context, schedule, container };
}
test('calendar escapes Sheets text and quoted title attribute without changing calendar layout', () => {
  const f = fixture(), html = f.context.renderSchedulesCalendar();
  assert.equal(html.includes(marker), false); assert.ok(html.includes('title="&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  assert.ok(html.includes('grid-cols-7')); assert.ok(html.includes('&lt;b data-synthetic="display"&gt;fixture&lt;/b&gt;'));
  f.schedule.matched_keyword = '1on1'; f.schedule.schedule_time = '12:00';
  const normal = f.context.renderSchedulesCalendar(); assert.ok(normal.includes('bg-green-200 border-green-400')); assert.ok(normal.includes('12:00'));
});
test('attendance displays names literally, retains counts and handles property-like names as data', () => {
  const f = fixture(), html = f.context.renderAttendanceStatistics();
  assert.equal(html.includes(marker), false); assert.ok(html.includes('&lt;b data-synthetic="display"&gt;fixture&lt;/b&gt;')); assert.ok(html.includes('text-blue-600">1回'));
  f.schedule.attendee_names = ['__proto__', 'constructor']; f.schedule.matched_keyword = '1on1';
  const ordinaryNames = f.context.renderAttendanceStatistics(); assert.ok(ordinaryNames.includes('__proto__')); assert.ok(ordinaryNames.includes('constructor')); assert.equal((ordinaryNames.match(/text-blue-600">1回/g) || []).length, 2);
  f.schedule.attendee_names = []; assert.ok(f.context.renderAttendanceStatistics().includes('参加者データがありません'));
});
test('absence stats display stored names literally with unchanged counts, rate and manager guard', () => {
  const f = fixture(); f.context.renderAbsenceStatsSection();
  assert.equal(f.container.innerHTML.includes(marker), false); assert.ok(f.container.innerHTML.includes('&lt;b data-synthetic="display"&gt;fixture&lt;/b&gt;')); assert.ok(f.container.innerHTML.includes('50.0%')); assert.ok(f.container.innerHTML.includes('4回'));
  for (const role of ['crew', 'unknown']) { f.context.currentUser.role = role; f.container.innerHTML = 'unchanged'; f.context.renderAbsenceStatsSection(); assert.equal(f.container.innerHTML, 'unchanged'); }
  f.context.currentUser.role = 'leader'; f.context.absenceStats.stats = []; f.context.renderAbsenceStatsSection(); assert.ok(f.container.innerHTML.includes('2026年10月のデータがありません'));
});

test('unapproved own crew submission reaches manager absence statistics with stored name using real routes', async () => {
  let role = 'crew';
  const queries = [], sends = [], token = 'a'.repeat(64);
  const deps = { Hono, console: { log(){}, warn(){}, error(){} }, process: { env: {} }, query: async (sql, params) => { queries.push([sql,params]); return { rows: sql.includes('INSERT INTO absence_requests') ? [{ id: 42 }] : sql.includes('GROUP BY tutor_email, tutor_name, absence_type') ? [{ tutor_email: 'own@example.test', tutor_name: marker, absence_type: 'cancel', count: '1' }] : [] }; }, fetchSchedulesFromSheet: async () => [], fetchIndividualWebhooks: async () => ({}), fetchTutorWebhooks: async () => ({}), notifyAbsenceRequest: async () => sends.push('request'), notifyAbsenceApproval: async () => sends.push('approval') };
  let route = await readFile(new URL('../src/routes/schedules.js', import.meta.url), 'utf8');
  route = route.replace("import { Hono } from 'hono';", 'const { Hono } = deps;').replace("import { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } from '../services/sheetsService.js';", 'const { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } = deps;').replace("import { query } from '../db/connection.js';", 'const { query } = deps;').replace("import { notifyAbsenceRequest, notifyAbsenceApproval } from '../services/discordService.js';", 'const { notifyAbsenceRequest, notifyAbsenceApproval } = deps;').replaceAll("await import('../services/sheetsService.js')", 'deps').replaceAll("await import('../services/discordService.js')", 'deps');
  assert.equal(route.includes('import('), false);
  globalThis.absenceDisplayFixture = deps;
  let routes; try { routes = (await import('data:text/javascript;base64,' + Buffer.from('const deps = globalThis.absenceDisplayFixture; const { console, process } = deps;\n' + route).toString('base64'))).default; } finally { delete globalThis.absenceDisplayFixture; }
  const app = new Hono();
  installApiAccess(app, { db: async sql => { assert.ok(sql.includes('FROM sessions')); return { rows: [{ id: 7, email: 'own@example.test', role, tutor_name: 'Trusted Fixture', must_change_password: false }] }; } });
  app.route('/api/schedules', routes);
  const body = { event_id: 'fixture', tutor_email: 'own@example.test', tutor_name: marker, reason: marker, schedule_title: marker, matched_keyword: marker, absence_type: 'cancel', schedule_date: '2026/10/29', schedule_time: '12:00' };
  const post = value => ({ method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await app.request('/api/schedules/absence', post(body))).status, 200);
  const insert = queries.find(([sql]) => sql.includes('INSERT INTO absence_requests'));
  assert.ok(insert); for (const index of [2,4,9,10]) assert.equal(insert[1][index], marker);
  assert.ok(insert[0].includes("'pending'"));
  role = 'leader';
  const response = await app.request('/api/schedules/absence-stats?year=2026&month=10', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.stats[0].tutor_name, marker);
  const aggregate = queries.find(([sql]) => sql.includes('GROUP BY tutor_email, tutor_name, absence_type'))[0];
  assert.equal(/status\s*=/.test(aggregate), false);
  role = 'crew';
  assert.equal((await app.request('/api/schedules/absence-stats', { headers: { Authorization: 'Bearer ' + token } })).status, 403);
  queries.length = 0;
  assert.equal((await app.request('/api/schedules/absence', post({ ...body, tutor_email: 'other@example.test' }))).status, 403);
  assert.equal(queries.length, 0); assert.equal(sends.length, 0);
});
