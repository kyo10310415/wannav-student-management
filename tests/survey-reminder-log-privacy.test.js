import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_REMINDER_PRIVATE';
let sequence = 0;
const failure = () => Object.assign(new Error(marker), { config: { url: marker, headers: { Authorization: marker } }, response: { data: marker } });
const student = { student_id: marker, name: marker, discord_user_id: marker };
async function fixture({ enabled = true, students = [student], responded = false, already = false, webhook = true,
  googleFail = false, credentials = '{}', sendFail = false, sentRecordFail = false, failureRecordFail = false, outerFail = false } = {}) {
  const logs = [], queries = [], posts = [], sheets = [], auth = [], timers = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-26T06:00:00Z'])); } }
  const deps = { Date: FixedDate, process: { env: { GOOGLE_SERVICE_ACCOUNT_KEY: credentials, SATISFACTION_SPREADSHEET_ID: marker,
    ...(webhook ? { DISCORD_WEBHOOK_URL: marker } : {}) } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    setTimeout: (resolve, ms) => { timers.push(ms); resolve(); },
    getPool: () => ({ query: async (sql, params) => {
      queries.push({ sql, params });
      if (outerFail) throw failure();
      if (sql.includes('FROM system_settings')) return { rows: [{ setting_value: String(enabled) }] };
      if (sql.includes('FROM students')) return { rows: students };
      if (sql.includes('SELECT id FROM survey_reminder_notifications')) return { rows: already ? [{ id: 1 }] : [] };
      if (params?.[4] === 'sent' && sentRecordFail) throw failure();
      if (params?.[3] === 'failed' && failureRecordFail) throw failure();
      return { rows: [] };
    } }),
    axios: { post: async (url, body) => { posts.push({ url, body }); if (sendFail) throw failure(); return { data: { id: marker + '-message' } }; } },
    google: { auth: { GoogleAuth: class { constructor(options) { auth.push(options); } } }, sheets: () => ({ spreadsheets: { values: {
      get: async params => { sheets.push(params); if (googleFail) throw failure(); return { data: { values: responded ? [['2026-10-05', '', '', '', '', ' ' + marker.toLowerCase() + ' ']] : [] } }; }
    } } }) } };
  const source = (await readFile(new URL('../src/jobs/surveyReminderNotification.js', import.meta.url), 'utf8'))
    .replace("import { getPool } from '../db/connection.js';", 'const { getPool } = deps;')
    .replace("import axios from 'axios';", 'const { axios } = deps;')
    .replace("import { google } from 'googleapis';", 'const { google } = deps;');
  const key = 'reminderPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process, Date, setTimeout } = deps;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { run: api.sendSurveyReminderNotifications, logs, queries, posts, sheets, auth, timers };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('reminder success preserves target date, notification payload, history and pacing without personal logs', async () => {
  const f = await fixture();
  await f.run();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].url, marker);
  assert.match(f.posts[0].body.content, new RegExp(`<@${marker}>`));
  assert.match(f.posts[0].body.content, /24時間以内/);
  assert.equal(f.posts[0].body.username, 'WannaV アンケートリマインド');
  assert.deepEqual(f.queries[1].params, ['2026-10-26']);
  assert.deepEqual(f.queries.at(-1).params, [marker, '2026-10-26', 'survey_reminder_12h', marker + '-message', 'sent']);
  assert.deepEqual(f.timers, [1000]);
  assert.deepEqual(f.sheets[0], { spreadsheetId: marker, range: '生徒様満足度アンケート!A2:G' });
  safe(f);
});

test('disabled, responded, duplicate, no webhook and empty cases preserve skips without sends', async () => {
  for (const options of [{ enabled: false }, { responded: true }, { already: true }, { webhook: false }, { students: [] }]) {
    const f = await fixture(options);
    await f.run();
    assert.equal(f.posts.length, 0);
    assert.deepEqual(f.timers, []);
    if (options.enabled === false) assert.equal(f.queries.length, 1);
    if (options.responded) assert.equal(f.queries.length, 2);
    safe(f);
  }
});

test('notification failure stores a fixed error while retaining recipient and history conflict logic', async () => {
  const f = await fixture({ sendFail: true });
  await f.run();
  const recorded = f.queries.at(-1);
  assert.deepEqual(recorded.params, [marker, '2026-10-26', 'survey_reminder_12h', 'failed', 'Survey reminder failed']);
  assert.match(recorded.sql, /ON CONFLICT \(student_id, lesson_date, notification_type\)/);
  assert.match(recorded.sql, /error_message = EXCLUDED.error_message/);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.timers, []);
  safe(f);
});

test('post-send history failure and failure-record failure remain private without retrying delivery', async () => {
  for (const options of [{ sentRecordFail: true }, { sendFail: true, failureRecordFail: true }]) {
    const f = await fixture(options);
    await f.run();
    assert.equal(f.posts.length, 1);
    assert.equal(f.queries.at(-1).params.at(-1), 'Survey reminder failed');
    assert.deepEqual(f.timers, []);
    safe(f);
  }
});

test('provider and credential-parse failures retain the existing empty responder fallback privately', async () => {
  for (const options of [{ googleFail: true }, { credentials: marker }]) {
    const f = await fixture(options);
    await f.run();
    assert.equal(f.posts.length, 1);
    safe(f);
  }
});

test('top-level database failures stay swallowed and private without notification', async () => {
  const f = await fixture({ outerFail: true });
  assert.equal(await f.run(), undefined);
  assert.equal(f.posts.length, 0);
  safe(f);
});
