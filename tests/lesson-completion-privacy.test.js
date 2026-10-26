import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_COMPLETION_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { detail: marker, config: { credentials: marker } });
let sequence = 0;
async function fixture({ rows = [], dbFail = false, cache = new Map(), cacheFail = false, resolve, completed } = {}) {
  const logs = [], queries = [], cacheCalls = [], batchCalls = [], monthCalls = [];
  let time = Date.parse('2026-10-26T03:00:00Z');
  class Clock extends Date { static now() { return time; } }
  const deps = { Hono, Date: Clock, process: { env: { PROGRESS_SPREADSHEET_ID: marker } },
    query: async (...args) => { queries.push(args); if (dbFail) throw rawError(); return { rows }; },
    fetchLessonCompletionStatus: async value => { cacheCalls.push(value); if (cacheFail || (typeof cache === 'function' && cacheCalls.length > 1)) throw rawError(); return typeof cache === 'function' ? cache() : cache; },
    resolveLessonCompletionItems: async items => { batchCalls.push(items); return resolve ? resolve(items) : items.map(item => ({ ...item, completed: true })); },
    getCompletedStudentIdsForMonth: async month => { monthCalls.push(month); return completed ? completed(month) : [marker]; },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/lessonCompletion.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'lessonCompletionPrivacyFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const { Hono, query, fetchLessonCompletionStatus, getCompletedStudentIdsForMonth, resolveLessonCompletionItems, process, console, Date } = globalThis[${JSON.stringify(key)}];\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, queries, cacheCalls, batchCalls, monthCalls, advance: ms => { time += ms; } };
  } finally { delete globalThis[key]; }
}
const target = '/check?studentId=' + marker + '&lessonDate=2026-10-01';
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('database results preserve completion decision, payload and priority over Sheets', async () => {
  for (const lesson_result of ['実施済み', '未実施']) {
    const f = await fixture({ rows: [{ lesson_result, reported_at: marker }] });
    assert.deepEqual(await (await f.app.request(target)).json(), { success: true, data: { studentId: marker, lessonDate: '2026-10-01', completed: lesson_result === '実施済み', lessonResult: lesson_result, timestamp: marker, source: 'database' } });
    assert.deepEqual(f.queries[0][1], [marker, '2026-10-01']); assert.equal(f.cacheCalls.length, 0); safe(f);
  }
});

test('database failure preserves normalized ID and plus-two-day completed Sheets fallback', async () => {
  const f = await fixture({ dbFail: true, cache: new Map([
    ['AB-12_2026-10-01', { completed: false, lessonResult: '未実施', timestamp: 'first' }],
    ['AB-12_2026-10-03', { completed: true, lessonResult: '実施済み', timestamp: marker }]
  ]) });
  const id = ' ab－12 ';
  const body = await (await f.app.request('/check?studentId=' + encodeURIComponent(id) + '&lessonDate=2026-10-01')).json();
  assert.deepEqual(body, { success: true, data: { studentId: id, lessonDate: '2026-10-01', completed: true, lessonResult: '実施済み', timestamp: marker, source: 'spreadsheet' } });
  assert.deepEqual(f.cacheCalls, [marker]); safe(f);
});

test('both upstream failures preserve successful none result without provider details', async () => {
  const f = await fixture({ dbFail: true, cacheFail: true });
  assert.deepEqual(await (await f.app.request(target)).json(), { success: true, data: { studentId: marker, lessonDate: '2026-10-01', completed: false, lessonResult: null, timestamp: null, source: 'none' } }); safe(f);
});

test('cache retains first incomplete result, one-hour lifetime and stale fallback on refresh failure', async () => {
  const cache = new Map([[marker + '_2026-10-01', { completed: false, lessonResult: '未実施', timestamp: marker }]]);
  const f = await fixture({ cache: () => cache });
  for (let i = 0; i < 2; i++) {
    const body = await (await f.app.request(target)).json(); assert.equal(body.data.source, 'spreadsheet'); assert.equal(body.data.completed, false);
  }
  assert.equal(f.cacheCalls.length, 1);
  f.advance(3600000);
  assert.equal((await (await f.app.request(target)).json()).data.timestamp, marker);
  assert.equal(f.cacheCalls.length, 2); safe(f);
});

test('all outer failure responses conceal upstream errors while retaining each existing status', async () => {
  const f = await fixture({ cache: { get() { throw rawError(); } }, dbFail: true,
    resolve: async () => { throw rawError(); }, completed: async () => { throw rawError(); } });
  for (const [path, options, status] of [[target, undefined, 500], ['/batch', post({ items: [{ studentId: marker, lessonDate: '2026-10-01' }] }), 500],
    ['/completed-students?yearMonth=2026-10', undefined, 400], ['/month?yearMonth=2026-10', undefined, 500]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { success: false, error: 'Lesson completion operation failed' });
  }
  safe(f);
});

test('batch, completed students and monthly results preserve service inputs and successful response shapes', async () => {
  const rows = [{ student_id: marker, lesson_date: '2026-10-01', lesson_result: '実施済み' }], items = [{ studentId: marker, lessonDate: '2026-10-01' }];
  const f = await fixture({ rows });
  assert.deepEqual(await (await f.app.request('/batch', post({ items }))).json(), { success: true, data: [{ ...items[0], completed: true }], count: 1 });
  assert.deepEqual(f.batchCalls, [items]);
  assert.deepEqual(await (await f.app.request('/completed-students?yearMonth=2026-10')).json(), { success: true, data: [marker] });
  assert.deepEqual(f.monthCalls, ['2026-10']);
  assert.deepEqual(await (await f.app.request('/month?yearMonth=2026-10')).json(), { success: true, data: rows, count: 1, source: 'database' });
  assert.deepEqual(f.queries.at(-1)[1], ['2026-10']); safe(f);
});

test('required-field validation and known service month validation keep their original 400 messages', async () => {
  const f = await fixture({ completed: async () => { throw new Error('yearMonth is required (format: YYYY-MM)'); } });
  for (const [path, options, error] of [['/check', undefined, 'studentId and lessonDate are required'], ['/batch', post({ items: {} }), 'items array is required'],
    ['/month', undefined, 'yearMonth is required (format: YYYY-MM)'], ['/completed-students', undefined, 'yearMonth is required (format: YYYY-MM)']]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error });
  }
  assert.equal(f.queries.length, 0); assert.equal(f.batchCalls.length, 0); safe(f);
});
