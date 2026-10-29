import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_LESSON_PRIVATE_DATA';
let sequence = 0;
async function fixture({ query = async () => ({ rows: [] }), calendar = async () => [], sheet = async () => [],
  metadata = async () => ({ lastSync: 'fixture-sync' }), configured = true } = {}) {
  const logs = [], queries = [];
  const deps = { Hono, process: { env: configured ? { GOOGLE_SHEET_ID: marker } : {} },
    console: Object.fromEntries(['log', 'error', 'warn'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (sql, params) => { queries.push({ sql, params }); return query(sql, params); },
    fetchLessonsForMonth: calendar, fetchLessonsFromSheet: sheet, getLastSyncTime: metadata };
  let source = await readFile(new URL('../src/routes/lessons.js', import.meta.url), 'utf8');
  source = source.replace("import { Hono } from 'hono';", 'const Hono = deps.Hono;')
    .replace("import { query } from '../db/connection.js';", 'const query = deps.query;')
    .replace("import { fetchLessonsForMonth } from '../services/calendarService.js';", 'const fetchLessonsForMonth = deps.fetchLessonsForMonth;')
    .replace("import { fetchLessonsFromSheet, getLastSyncTime } from '../services/sheetsService.js';", 'const { fetchLessonsFromSheet, getLastSyncTime } = deps;');
  const key = 'lessonPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try {
    app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const process = deps.process; const console = deps.console;\n${source}`).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  return { app, logs, queries };
}
function secretError() { return Object.assign(new Error(marker), { detail: marker, query: marker, config: { password: marker } }); }
function privateLogs(f) { assert.equal(f.logs.join('\n').includes(marker), false); }
const lesson = (suffix, student, email) => ({ calendar_event_id: marker + '-' + suffix, student_id: student,
  student_name: marker, tutor_calendar_id: email, tutor_email: email, tutor_name: marker,
  lesson_date: '2026-10-26', title: marker, description: marker, meet_link: marker, lesson_time: marker });
function syncData() {
  const email = marker + '@example.test';
  return { email, lessons: [lesson('valid', 'fixture-valid', email), lesson('unmatched', 'fixture-unmatched', email),
    lesson('mismatch', 'fixture-mismatch', marker + '-other@example.test'), lesson('failed', 'fixture-failed', email)],
  mapping: ['fixture-valid', 'fixture-mismatch', 'fixture-failed'].map(student_id => ({ student_id, tutor_email: email, tutor_notion_name: marker })) };
}

test('read endpoints retain business data while upstream failures disclose only fixed messages', async () => {
  const paths = [['/', 'Failed to fetch lessons'], ['/month/2026/10', 'Failed to fetch monthly lessons'],
    ['/student/fixture', 'Failed to fetch student lessons'], ['/stats/2026/10', 'Failed to fetch lesson statistics']];
  const success = await fixture({ query: async () => ({ rows: [{ student_id: marker, name: marker }] }) });
  for (const [path] of paths) {
    const response = await success.app.request(path);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, [{ student_id: marker, name: marker }]);
    assert.equal(body.count, 1);
  }
  privateLogs(success);
  const failed = await fixture({ query: async () => { throw secretError(); } });
  for (const [path, message] of paths) {
    const response = await failed.app.request(path);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: message });
  }
  privateLogs(failed);
});

test('Calendar sync preserves matching, upsert parameters and partial failure counts without personal logs', async () => {
  const data = syncData();
  const f = await fixture({ calendar: async () => data.lessons, query: async (sql, params) => {
    if (sql.includes('FROM students s')) return { rows: data.mapping };
    if (sql.includes('SELECT email, notion_name')) return { rows: [{ email: data.email, notion_name: marker }] };
    if (sql.includes('INSERT INTO lessons') && params[0].endsWith('-failed')) throw secretError();
    return { rows: [] };
  } });
  const response = await f.app.request('/sync/2026/10');
  assert.deepEqual(await response.json(), { success: true, message: 'Synced 1 lessons for 2026/10 (1 unmatched, 1 tutor mismatches)', count: 1, skipped: 2, errors: 1 });
  const inserts = f.queries.filter(call => call.sql.includes('INSERT INTO lessons'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, [data.lessons[0].calendar_event_id, 'fixture-valid', marker, '2026-10-26', marker, marker, marker, marker]);
  privateLogs(f);
  const failed = await fixture({ calendar: async () => { throw secretError(); } });
  assert.deepEqual(await (await failed.app.request('/sync/2026/10')).json(), { success: false, error: 'Failed to sync lessons' });
  privateLogs(failed);
});

test('Sheet sync keeps all sheet IDs, deletion batching and success metadata without logging individual records', async () => {
  const data = syncData();
  const stale = Array.from({ length: 205 }, (_, i) => marker + '-stale-' + i);
  const f = await fixture({ sheet: async () => data.lessons, metadata: async () => ({ lastSync: marker, extra: marker }), query: async (sql, params) => {
    if (sql.includes('FROM students s')) return { rows: data.mapping };
    if (sql.includes('INSERT INTO lessons') && params[0].endsWith('-failed')) throw secretError();
    if (sql === 'SELECT calendar_event_id FROM lessons') return { rows: [...data.lessons.map(item => item.calendar_event_id), ...stale].map(calendar_event_id => ({ calendar_event_id })) };
    return { rows: [] };
  } });
  const response = await f.app.request('/sync-from-sheet');
  assert.deepEqual(await response.json(), { success: true, message: 'Synced 1 lessons from Google Sheets', count: 1, skipped: 2, errors: 1, deleted: 205, lastGasSync: marker, totalEventsInSheet: 4 });
  const deletions = f.queries.filter(call => call.sql.startsWith('DELETE FROM lessons'));
  assert.deepEqual(deletions.map(call => call.params.length), [100, 100, 5]);
  assert.deepEqual(deletions.flatMap(call => call.params), stale);
  assert.ok(deletions[0].sql.endsWith('$100)'));
  privateLogs(f);
});

test('Sheet provider failure keeps the existing cache response and performs no DB writes', async () => {
  const f = await fixture({ metadata: async () => { throw secretError(); }, sheet: async () => { throw secretError(); } });
  assert.deepEqual(await (await f.app.request('/sync-from-sheet')).json(), { success: true,
    message: 'Google Sheets unavailable (Google API error) — using existing DB data', synced: 0, errors: 0, cache_error: true });
  assert.equal(f.queries.length, 0);
  privateLogs(f);
});

test('Sheet mapping and deletion failures never expose provider errors while preserving partial-success behavior', async () => {
  const sheet = async () => [lesson('valid-source', 'fixture-valid', 'synthetic@example.test')];
  const failed = await fixture({ sheet, query: async () => { throw secretError(); } });
  const response = await failed.app.request('/sync-from-sheet');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'Failed to sync lessons from sheet' });
  privateLogs(failed);
  const cleanup = await fixture({ sheet, query: async sql => {
    if (sql === 'SELECT calendar_event_id FROM lessons') throw secretError();
    return { rows: [] };
  } });
  const body = await (await cleanup.app.request('/sync-from-sheet')).json();
  assert.equal(body.success, true);
  assert.equal(body.deleted, 0);
  privateLogs(cleanup);
});

test('validation rejects invalid dates or missing sheet configuration before providers run', async () => {
  let providerCalls = 0;
  const f = await fixture({ configured: false, query: async () => { providerCalls++; return { rows: [] }; },
    calendar: async () => { providerCalls++; return []; }, sheet: async () => { providerCalls++; return []; } });
  for (const path of ['/sync/2026/13', '/month/2026/13', '/stats/2026/13', '/sync-from-sheet']) {
    assert.equal((await f.app.request(path)).status, 400);
  }
  assert.equal(providerCalls, 0);
});
