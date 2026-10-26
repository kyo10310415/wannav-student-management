import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_REMINDER_PRIVATE';
let sequence = 0;
async function fixture({ fail = false, rows = [], lessons = [] } = {}) {
  const logs = [], calls = [];
  const provider = async value => { if (fail) throw Object.assign(new Error(marker), { response: { data: { error: marker } } }); return value; };
  const deps = { Hono,
    sendDailyReminders: async () => provider([{ success: true }, { success: false }]),
    testReminder: async id => { calls.push(id); return provider(); },
    sendDailyStatsReport: async () => provider(),
    createWebhookTestHandler: () => c => c.json({ success: false }, 403),
    query: async () => { throw Error('Unexpected database call'); }, axios: { post: async () => { throw Error('Unexpected delivery'); } },
    getSheets: () => ({ spreadsheets: { values: { get: async options => { calls.push(options); return provider({ data: { values: rows } }); } } } }),
    fetchLessonsForTomorrow: async () => provider(lessons),
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/reminders.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll("await import('../services/sheetsService.js')", 'deps');
  const key = 'remindersPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const app = (await import('data:text/javascript;base64,' + Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { Hono, sendDailyReminders, testReminder, sendDailyStatsReport, createWebhookTestHandler, query, axios, console } = deps;\n${source}`).toString('base64'))).default;
    return { app, logs, calls };
  } finally { delete globalThis[key]; }
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
test('all five reminder error boundaries hide upstream diagnostics', async () => {
  const f = await fixture({ fail: true });
  for (const [path, options] of [['/send', post({})], ['/test', post({ studentId: marker })], ['/test-student-info/' + marker], ['/test-lesson-data'], ['/send-stats-report', post({})]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Reminder operation failed');
    assert.equal(JSON.stringify(body).includes(marker), false);
    assert.equal('stack' in body, false);
    if (path.startsWith('/test-student-info/')) assert.equal(body.details, null);
  }
  safe(f);
});
test('manual reminder and statistics success and required student validation are preserved', async () => {
  const f = await fixture();
  const result = await (await f.app.request('/send', post({}))).json();
  assert.equal(result.message, 'Sent 1 reminders successfully, 1 failed');
  assert.equal(result.results.length, 2);
  assert.equal((await f.app.request('/test', post({}))).status, 400);
  assert.equal((await f.app.request('/test', post({ studentId: marker }))).status, 200);
  assert.deepEqual(f.calls, [marker]);
  assert.equal((await f.app.request('/send-stats-report', post({}))).status, 200);
  safe(f);
});
test('student sheet column mapping and trimming remain intact without logging delivery identifiers', async () => {
  const row = Array(12).fill(''); row[0] = marker; row[5] = ' ' + marker + ' '; row[11] = ' ' + marker + ' ';
  const f = await fixture({ rows: [row] });
  const body = await (await f.app.request('/test-student-info/' + marker)).json();
  assert.deepEqual(body.data, { studentId: marker, chatUrl: marker, discordId: marker, hasDiscordId: true, hasChatUrl: true });
  assert.equal(f.calls[0].range.endsWith('!B2:M'), true);
  safe(f);
});
test('missing and empty student delivery information retain existing responses', async () => {
  const f = await fixture({ rows: [[marker]] });
  const found = await (await f.app.request('/test-student-info/' + marker)).json();
  assert.equal(found.data.discordId, null); assert.equal(found.data.chatUrl, null);
  const missing = await f.app.request('/test-student-info/absent');
  assert.equal(missing.status, 404); assert.equal((await missing.json()).totalRecords, 1);
  safe(f);
});
test('lesson diagnostics preserve business payloads and Tokyo dates without sample logs', async () => {
  const lesson = { student_id: marker, tutor_name: marker, tutor_email: marker, lesson_date: '2026-10-26T00:00:00Z', title: marker, description: marker, meet_link: marker };
  const f = await fixture({ lessons: [lesson, {}] });
  const body = await (await f.app.request('/test-lesson-data')).json();
  assert.equal(body.data.totalLessons, 2);
  assert.equal(body.data.lessons[0].description, marker);
  assert.equal(body.data.lessons[0].has_meet_link, true);
  assert.equal(body.data.lessons[0].lesson_date_parsed, new Date(lesson.lesson_date).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  assert.equal(body.data.lessons[1].lesson_date_parsed, null);
  safe(f);
});
