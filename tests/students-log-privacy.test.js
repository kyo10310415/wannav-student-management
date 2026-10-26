import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { normalizeStudentTextTypeStudentId } from '../src/services/studentTextTypeService.js';

const marker = 'SYNTHETIC_STUDENT_PRIVATE';
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, config: { password: marker }, detail: marker });
let sequence = 0;
const student = { student_id: marker, name: marker, notion_page_id: marker, status: marker, pro_plan_start_date: '2026-10-01',
  lesson_start_date: '2026-01-01', lesson_progress: 2, absence_count: 4 };
async function fixture({ query = async () => ({ rows: [student] }), students = [student], configured = true, fail = [] } = {}) {
  const logs = [], queries = [], calls = [], dates = [];
  const wrap = (name, result) => async (...args) => { calls.push({ name, args }); if (fail.includes(name)) throw failure(); return result; };
  const deps = { Hono, process: { env: configured ? { GOOGLE_CACHE_SHEET_ID: marker } : {} },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (sql, params) => { queries.push({ sql, params }); return query(sql, params); },
    fetchStudents: wrap('notion', []), fetchStudentsFromCache: wrap('students', students), fetchProgressFromCache: wrap('progress', { [marker]: 7 }),
    getCacheSyncTime: wrap('metadata', { lastSync: marker, privateDetail: marker }), getSpreadsheetMetadata: wrap('spreadsheet', { title: marker }),
    fetchWanamiUsageCount: wrap('usage', 3), fetchWanamiUsageHistory: wrap('history', [{ year: 2026, month: 10, count: 3 }]),
    fetchAllWanamiUsageCounts: wrap('allUsage', { [marker]: 3 }), fetchSuspensionMonthsMap: wrap('suspension', { [marker]: 2 }),
    fetchStudentTextTypeMap: wrap('text', new Map([[marker, '新']])), normalizeStudentTextTypeStudentId,
    fetchLessonStartDates: wrap('dates', { [marker]: '2025-12-01' }), calculateContinuedMonths: date => { dates.push(date); return 8; },
    calculateStudentLessonStats: wrap('stats', { [marker]: { lesson_progress: 9, absence_count: 1 } }),
  };
  let source = await readFile(new URL('../src/routes/students.js', import.meta.url), 'utf8');
  source = source.replace(/^import \{ ([^\n]+) \} from '[^']+';/gm, (_, names) => `const { ${names} } = deps;`);
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'studentsPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries, calls, dates };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
const patch = body => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('read and PRO API failures expose only a fixed error', async () => {
  const f = await fixture({ query: async () => { throw failure(); }, fail: ['allUsage', 'usage', 'history'] });
  for (const [path, options] of [['/'], ['/tutor/' + marker], ['/' + marker], ['/wanami-usage-all'],
    ['/' + marker + '/wanami-usage'], ['/' + marker + '/wanami-history'], ['/' + marker + '/pro-plan', patch({ proPlanStartDate: null })]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Student operation failed' });
  }
  safe(f);
});

test('read and usage success data and provider arguments remain available without personal logs', async () => {
  const f = await fixture();
  const list = await (await f.app.request('/')).json();
  assert.equal(list.success, true); assert.equal(list.count, 1);
  assert.equal(list.data[0].student_id, marker); assert.equal(list.data[0].lesson_progress, 9); assert.equal(list.data[0].absence_count, 1);
  assert.deepEqual(await (await f.app.request('/' + marker)).json(), { success: true, data: student });
  const usage = await (await f.app.request('/' + marker + '/wanami-usage?year=2026&month=10')).json();
  assert.deepEqual(usage.data, { student_id: marker, year: 2026, month: 10, count: 3 });
  assert.deepEqual(f.calls.find(call => call.name === 'usage').args, [marker, 2026, 10]);
  const history = await (await f.app.request('/' + marker + '/wanami-history')).json();
  assert.deepEqual(history.data.history, [{ year: 2026, month: 10, count: 3 }]); safe(f);
});

test('sync preserves partial counts, preferred stats/date fields, text mapping and never deletes or overwrites manual PRO dates', async () => {
  const f = await fixture({ students: [student, { ...student, student_id: marker + '-failed' }, { name: marker }], query: async (sql, params) => {
    if (sql.includes('INSERT INTO students') && params[0] === marker + '-failed') throw failure();
    return { rows: [{ student_id: marker }, { student_id: marker + '-missing' }] };
  } });
  const response = await f.app.request('/sync');
  assert.deepEqual(await response.json(), { success: true, message: 'Synced 1 students from cache (1 errors, 1 skipped, 0 deleted)',
    count: 1, errors: 1, skipped: 1, deleted: 0, lastCacheSync: marker });
  const insert = f.queries.find(call => call.sql.includes('INSERT INTO students'));
  assert.equal(insert.params[6], 9); assert.equal(insert.params[21], 1);
  assert.equal(insert.params[22], '2026-01-01'); assert.equal(insert.params[23], 6); assert.equal(insert.params[24], 2);
  assert.equal(insert.params[27], '新');
  assert.equal(insert.sql.includes('pro_plan_start_date'), false);
  assert.ok(insert.sql.includes('text_type = COALESCE($28, students.text_type)'));
  assert.equal(f.queries.some(call => /DELETE\s+FROM/i.test(call.sql)), false);
  assert.equal(f.dates[0], '2026-01-01'); safe(f);
});

test('optional provider and missing-record-check failures preserve fallback upserts privately', async () => {
  const f = await fixture({ students: [{ ...student, lesson_start_date: null }], fail: ['metadata', 'progress', 'text', 'stats'],
    query: async sql => { if (sql === 'SELECT student_id FROM students') throw failure(); return { rows: [] }; } });
  const body = await (await f.app.request('/sync')).json();
  assert.equal(body.success, true); assert.equal(body.count, 1); assert.equal(body.deleted, 0);
  const insert = f.queries.find(call => call.sql.includes('INSERT INTO students'));
  assert.equal(insert.params[6], null); assert.equal(insert.params[21], 4);
  assert.equal(insert.params[22], '2025-12-01'); assert.equal(insert.params[27], null); safe(f);
  const datesFailed = await fixture({ fail: ['dates'] }); assert.equal((await (await datesFailed.app.request('/sync')).json()).success, true); safe(datesFailed);
  const outer = await fixture({ fail: ['suspension'] });
  const response = await outer.app.request('/sync'); assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'Student operation failed' }); safe(outer);
});

test('unavailable, empty and unconfigured caches keep current status and skip all database writes', async () => {
  const unavailable = await fixture({ fail: ['students'] });
  assert.deepEqual(await (await unavailable.app.request('/sync')).json(), { success: true,
    message: 'Cache unavailable (Google API error) — using existing DB data', count: 0, errors: 0, skipped: 0, cache_error: true });
  assert.equal(unavailable.queries.length, 0); safe(unavailable);
  for (const options of [{ students: [] }, { configured: false }]) {
    const f = await fixture(options); assert.equal((await f.app.request('/sync')).status, 400);
    assert.equal(f.queries.length, 0); safe(f);
  }
});

test('PRO updates preserve explicit-clear validation and month normalization', async () => {
  const f = await fixture();
  for (const value of [undefined, '', '2026-02-30']) {
    assert.equal((await f.app.request('/' + marker + '/pro-plan', patch({ proPlanStartDate: value }))).status, 400);
  }
  assert.equal(f.queries.length, 0);
  assert.equal((await f.app.request('/' + marker + '/pro-plan', patch({ proPlanStartDate: '2026-10-20' }))).status, 200);
  assert.deepEqual(f.queries.at(-1).params, ['2026-10-01', marker]);
  assert.equal((await f.app.request('/' + marker + '/pro-plan', patch({ proPlanStartDate: null }))).status, 200);
  assert.deepEqual(f.queries.at(-1).params, [null, marker]); safe(f);
});

test('debug handler success contract remains intact and its failure omits stack and upstream data', async () => {
  // The existing /:id route precedes /debug-sheets. Mount its exact exported handler separately to exercise it without changing routing.
  for (const fail of [[], ['spreadsheet']]) {
    const f = await fixture({ fail });
    const debug = new Hono(); debug.get('/debug-sheets', f.app.routes.find(route => route.path === '/debug-sheets').handler);
    const response = await debug.request('/debug-sheets');
    if (fail.length) {
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { success: false, error: 'Student operation failed' });
    } else {
      assert.deepEqual(await response.json(), { success: true, spreadsheetId: marker, usingCache: true, metadata: { title: marker } });
    }
    safe(f);
  }
});
