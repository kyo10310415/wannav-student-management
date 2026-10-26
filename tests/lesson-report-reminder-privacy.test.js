import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_LESSON_REPORT_PRIVATE';
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, config: { url: marker } });
const lesson = { student_id: marker, student_name: marker, lesson_date: '2026-10-25', lesson_time: '12:00',
  homeroom_tutor: marker, tutor_name: marker, tutor_email: marker + '@example.test', team: marker };
const tutor = { email: lesson.tutor_email.toLowerCase(), discord_webhook_url: marker + '-tutor-hook', discord_user_id: marker,
  tutor_name: marker, notion_name: marker, team: marker, status: marker, has_webhook: true, user_role: 'crew' };
const leader = { ...tutor, email: marker + '-leader@example.test', discord_webhook_url: marker + '-leader-hook', role: 'leader' };
let sequence = 0;
async function fixture({ configured = true, empty = false, report = false, dbReportFail = false, completion = new Map(),
  sheetsFail = false, queryFail = false, sendFail = false, missingTutor = false, triggerThrow = false } = {}) {
  const logs = [], queries = [], posts = [], sheets = [], waits = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-26T06:00:00Z'])); }
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getDate() { return this.getUTCDate(); }
    setDate(value) { return this.setUTCDate(value); }
  }
  const deps = { Hono, Date: FixedDate, process: { env: configured ? { PROGRESS_SPREADSHEET_ID: marker } : {} },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    setTimeout: (resolve, delay) => { waits.push(delay); resolve(); },
    query: async (sql, params) => {
      queries.push({ sql, params }); if (queryFail) throw failure();
      if (sql.includes('SELECT id FROM lesson_reports')) { if (dbReportFail) throw failure(); return { rows: report ? [{ id: 1 }] : [] }; }
      if (sql.includes('FROM lessons l')) return { rows: empty ? [] : [lesson] };
      if (sql.includes('FROM tutors t')) return { rows: [tutor] };
      if (sql.includes("u.role IN ('admin', 'leader')")) return { rows: [leader, tutor, { ...leader, team: marker + '-other' }] };
      if (sql.includes('FROM users u')) return { rows: missingTutor ? [] : [tutor] };
      throw new Error('Unexpected fixture SQL');
    },
    fetchLessonCompletionStatus: async id => { sheets.push(id); if (sheetsFail) throw failure(); return completion; },
    axios: { post: async (url, body) => { posts.push({ url, body }); if (sendFail) throw failure(); return { data: {} }; } },
  };
  let source = (await readFile(new URL('../src/jobs/lessonReportReminder.js', import.meta.url), 'utf8'))
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace("import { fetchLessonCompletionStatus } from '../services/cacheService.js';", 'const { fetchLessonCompletionStatus } = deps;')
    .replace("import axios from 'axios';", 'const { axios } = deps;');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'lessonReportPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let run, app;
  try {
    const prefix = `const deps = globalThis[${JSON.stringify(key)}]; const { console, process, Date, setTimeout } = deps;\n`;
    run = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    deps.sendLessonReportReminder = triggerThrow ? async () => { throw failure(); } : run;
    source = (await readFile(new URL('../src/routes/lessonReportReminder.js', import.meta.url), 'utf8'))
      .replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
      .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
      .replace("import sendLessonReportReminder from '../jobs/lessonReportReminder.js';", 'const { sendLessonReportReminder } = deps;');
    assert.equal(/\bimport(?:\s|\()/.test(source), false);
    app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  return { run, app, logs, queries, posts, sheets, waits };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('unreported lesson preserves tutor/leader routing, duplicate exclusion, payloads and pacing', async () => {
  const f = await fixture();
  assert.equal(await f.run(), undefined);
  assert.deepEqual(f.posts.map(item => item.url), [marker + '-tutor-hook', marker + '-leader-hook']);
  for (const { body } of f.posts) {
    assert.equal(body.content, `<@${marker}>`);
    assert.deepEqual(body.embeds[0].fields.map(field => field.value), ['2026/10/25', '12:00', marker, marker, marker, marker]);
  }
  assert.equal(f.posts[0].body.embeds[0].title, 'レッスン報告未提出のお知らせ');
  assert.equal(f.posts[1].body.embeds[0].title, '【チームリーダー通知】レッスン報告未提出のお知らせ');
  assert.deepEqual(f.queries[0].params, ['2026-10-25']);
  assert.deepEqual(f.queries.at(-1).params, [marker, '2026-10-25']);
  assert.deepEqual(f.sheets, [marker]);
  assert.deepEqual(f.waits, [500]); safe(f);
});

test('database and spreadsheet reports retain submission skips including all three fallback dates', async () => {
  const db = await fixture({ report: true }); await db.run();
  assert.equal(db.posts.length, 0); assert.deepEqual(db.waits, []); safe(db);
  for (let offset = 0; offset <= 2; offset++) {
    const f = await fixture({ dbReportFail: true, completion: new Map([[`${marker}_2026-10-${25 + offset}`, { completed: false, lessonResult: marker }]]) });
    await f.run(); assert.equal(f.posts.length, 0); assert.deepEqual(f.waits, []); safe(f);
  }
});

test('missing configuration, empty lessons and missing tutor preserve skip behavior', async () => {
  for (const options of [{ configured: false }, { empty: true }, { missingTutor: true }]) {
    const f = await fixture(options); await f.run(); assert.equal(f.posts.length, 0);
    assert.deepEqual(f.waits, options.missingTutor ? [500] : []);
    if (!options.configured && !options.empty && !options.missingTutor) assert.equal(f.queries.length, 0);
    safe(f);
  }
});

test('provider, DB and send failures remain swallowed privately with original continuation', async () => {
  for (const options of [{ sheetsFail: true }, { queryFail: true }, { sendFail: true }, { dbReportFail: true }]) {
    const f = await fixture(options);
    assert.equal(await f.run(), undefined);
    assert.equal(f.posts.length, options.sendFail || options.dbReportFail ? 2 : 0);
    assert.deepEqual(f.waits, options.sendFail || options.dbReportFail ? [500] : []); safe(f);
  }
});

test('mapping route preserves private business response and summary with original date parameter', async () => {
  const f = await fixture();
  const response = await f.app.request('/check-mapping'); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.success, true);
  assert.equal(body.data.summary.total_active_tutors, 1);
  assert.equal(body.data.summary.total_leaders, 3);
  assert.equal(body.data.summary.yesterday_date, '2026-10-25');
  assert.deepEqual(body.data.summary.yesterday_lessons, [lesson]);
  assert.equal(body.data.tutor_mapping[0].email, tutor.email);
  assert.equal(body.data.tutor_mapping[0].team_leaders.length, 2);
  assert.equal(body.data.tutor_mapping[0].discord_user_id, marker);
  assert.deepEqual(f.queries.at(-1).params, ['2026-10-25']); safe(f);
});

test('API failures expose only fixed errors while trigger success contract remains unchanged', async () => {
  const failed = await fixture({ queryFail: true, triggerThrow: true });
  for (const [path, options] of [['/check-mapping'], ['/trigger', { method: 'POST' }]]) {
    const response = await failed.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Lesson report reminder operation failed' });
  }
  safe(failed);
  const success = await fixture({ empty: true });
  assert.deepEqual(await (await success.app.request('/trigger', { method: 'POST' })).json(),
    { success: true, message: 'Lesson report reminder job executed successfully' }); safe(success);
});
