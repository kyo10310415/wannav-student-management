import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_CALENDAR_PRIVATE_DATA';
const credentials = { private_key: marker, client_email: 'fixture@example.test' };
let sequence = 0;
function event(overrides = {}) {
  return { id: 'fixture-event-' + marker, summary: `WannaVレッスン予約（${marker}）`,
    description: `学籍番号: OLTS000001-AA\n${marker}\nhttps://meet.google.com/aaa-bbbb-ccc`,
    start: { dateTime: '2026-10-28T12:00:00+09:00' }, ...overrides };
}
async function fixture({ env = {}, rows = [{ email: 'fixture@example.test' }], queryError, list, factoryError } = {}) {
  const logs = [], requests = [], auth = [], queries = [];
  const environment = { GOOGLE_CREDENTIALS_JSON: JSON.stringify(credentials), GOOGLE_CALENDAR_ID: marker, ...env };
  const dependencies = {
    process: { env: environment }, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async sql => { queries.push(sql); if (queryError) throw queryError; return { rows }; },
    google: { auth: { GoogleAuth: class { constructor(options) { auth.push(options); if (factoryError) throw factoryError; } } },
      calendar: () => ({ events: { list: async options => { requests.push(options); return { data: { items: list ? await list(options) : [event()] } }; } } }) },
  };
  let source = await readFile(new URL('../src/services/calendarService.js', import.meta.url), 'utf8');
  source = source.replace("import { google } from 'googleapis';", 'const google = deps.google;')
    .replace("import { query } from '../db/connection.js';", 'const query = deps.query;');
  const key = 'calendarPrivacyFixture' + sequence++;
  globalThis[key] = dependencies;
  let mod;
  try {
    mod = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const process = deps.process; const console = deps.console;\n${source}`).toString('base64')}`);
  } finally { delete globalThis[key]; }
  return { mod, logs, requests, auth, queries, env: environment };
}
function assertPrivate(f) {
  assert.equal(f.logs.join('\n').includes(marker), false);
  assert.equal(f.logs.join('\n').includes('fixture@example.test'), false);
  assert.equal(f.logs.join('\n').includes('OLTS000001-AA'), false);
  assert.equal(f.logs.join('\n').includes('meet.google.com'), false);
}

test('JSON/base64 credentials remain usable and cached without being logged', async () => {
  for (const value of [JSON.stringify(credentials), Buffer.from(JSON.stringify(credentials)).toString('base64')]) {
    const f = await fixture({ env: { GOOGLE_CREDENTIALS_JSON: value } });
    assert.equal(f.auth.length, 0);
    const lessons = await f.mod.fetchLessonsForMonth(2026, 10);
    assert.equal(lessons[0].student_id, 'OLTS000001-AA');
    assert.equal(lessons[0].tutor_name, marker);
    await f.mod.fetchLessonsForTomorrow();
    assert.equal(f.auth.length, 1);
    assert.deepEqual(f.auth[0].credentials, credentials);
    assert.deepEqual(f.auth[0].scopes, ['https://www.googleapis.com/auth/calendar.readonly']);
    assertPrivate(f);
    assert.equal(f.logs.join('\n').includes(value), false);
  }
});

test('monthly conversion, deduplication, source calendar and all-day events are preserved', async () => {
  const first = marker + '-one', second = marker + '-two';
  const allDay = event({ id: 'fixture-all-day', description: '学籍番号: OLTS000002-BB', start: { date: '2026-10-29' } });
  const f = await fixture({ env: { GOOGLE_CALENDAR_IDS: `${first}, ${second}` },
    list: async options => options.calendarId === first ? [event(), event({ id: 'fixture-no-student', description: marker })] : [event(), allDay] });
  const lessons = await f.mod.fetchLessonsForMonth(2026, 10);
  assert.equal(lessons.length, 2);
  assert.deepEqual(lessons[0], { calendar_event_id: event().id, student_id: 'OLTS000001-AA', tutor_name: marker,
    tutor_calendar_id: first, lesson_date: event().start.dateTime, title: event().summary,
    description: event().description, meet_link: 'https://meet.google.com/aaa-bbbb-ccc' });
  assert.equal(lessons[1].lesson_date, '2026-10-29');
  assert.ok(f.requests.every(request => request.singleEvents === true && request.maxResults === 2500 && request.orderBy === 'startTime'));
  assert.equal(f.queries.length, 0);
  assertPrivate(f);
});

test('tomorrow lessons and partial calendar failure preserve results without identifiers in logs', async () => {
  const f = await fixture({ env: { GOOGLE_CALENDAR_IDS: `${marker}-ok,${marker}-failed` }, list: async options => {
    if (options.calendarId.endsWith('-failed')) throw Object.assign(new Error(marker), { config: { headers: { Authorization: marker } } });
    return [event(), event(), event({ id: 'fixture-unmatched', description: marker })];
  } });
  const lessons = await f.mod.fetchLessonsForTomorrow();
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].title, event().summary);
  assert.equal(lessons[0].meet_link, 'https://meet.google.com/aaa-bbbb-ccc');
  assert.ok(f.requests.every(request => new Date(request.timeMax) - new Date(request.timeMin) === 86400000));
  assertPrivate(f);
  assert.equal((await f.mod.fetchLessonsForMonth(2026, 10)).length, 1);
  assertPrivate(f);
});

test('tutor fallback and empty results do not disclose tutor emails', async () => {
  const f = await fixture({ env: { GOOGLE_CALENDAR_ID: '', GOOGLE_CALENDAR_IDS: '' }, list: async () => [] });
  assert.deepEqual(await f.mod.fetchLessonsForMonth(2026, 10), []);
  assert.equal(f.queries.length, 1);
  assert.equal(f.requests[0].calendarId, 'fixture@example.test');
  assertPrivate(f);
});

test('invalid credentials, DB failures and malformed events surface only fixed errors', async () => {
  for (const value of ['', '{' + marker, Buffer.from('{' + marker).toString('base64')]) {
    const f = await fixture({ env: { GOOGLE_CREDENTIALS_JSON: value } });
    await assert.rejects(f.mod.fetchLessonsForTomorrow(), error => error.message === 'Tomorrow calendar lessons could not be loaded' && !error.cause);
    assert.deepEqual(await f.mod.fetchLessonsForMonth(2026, 10), []);
    assert.equal(f.requests.length, 0);
    assertPrivate(f);
    if (value) assert.equal(f.logs.join('\n').includes(value), false);
  }
  const failed = await fixture({ env: { GOOGLE_CALENDAR_ID: '' }, queryError: new Error(marker) });
  await assert.rejects(failed.mod.fetchLessonsForMonth(2026, 10), { message: 'Monthly calendar lessons could not be loaded' });
  assertPrivate(failed);
  const noTutors = await fixture({ env: { GOOGLE_CALENDAR_ID: '' }, rows: [] });
  await assert.rejects(noTutors.mod.fetchLessonsForMonth(2026, 10), { message: 'Monthly calendar lessons could not be loaded' });
  assertPrivate(noTutors);
  const authFailure = await fixture({ factoryError: new Error(marker) });
  await assert.rejects(authFailure.mod.fetchLessonsForTomorrow(), { message: 'Tomorrow calendar lessons could not be loaded' });
  assertPrivate(authFailure);
  const broken = await fixture({ list: async () => [event({ start: undefined })] });
  await assert.rejects(broken.mod.fetchLessonsForTomorrow(), { message: 'Tomorrow calendar lessons could not be loaded' });
  await assert.rejects(broken.mod.fetchLessonsForMonth(2026, 10), { message: 'Monthly calendar lessons could not be loaded' });
  assertPrivate(broken);
});
