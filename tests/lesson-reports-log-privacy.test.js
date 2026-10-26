import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { formatLessonLabel, resolveLessonReference } from '../src/services/lessonReferenceService.js';

const marker = 'SYNTHETIC_LESSON_REPORT_PRIVATE';
const report = { student_id: marker, lesson_date: '2026-10-26', lesson_result: '実施済み', lesson_number: '1' };
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const rawError = () => Object.assign(new Error(marker), { config: { password: marker }, detail: marker });
let sequence = 0;
async function fixture(query, role = 'crew') {
  const logs = [], queries = [];
  const deps = { Hono, formatLessonLabel, resolveLessonReference,
    query: async (...args) => { queries.push(args); return query(...args); },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/lessonReports.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace(/import \{\s*formatLessonLabel,\s*resolveLessonReference\s*\} from '..\/services\/lessonReferenceService.js';/, 'const { formatLessonLabel, resolveLessonReference } = deps;');
  const key = 'lessonReportPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const root = new Hono();
  root.use('*', async (c, next) => { c.set('authenticatedUser', { email: marker, tutor_name: marker, role }); return next(); });
  root.route('/', app);
  return { app: root, logs, queries };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all lesson report failures and a post-upsert minutes failure return fixed private errors', async () => {
  const f = await fixture(async () => { throw rawError(); });
  for (const [path, options] of [['/', post(report)], ['/by-date/2026-10-26'], ['/fixture/2026-10-26'], ['/'], ['/42', { method: 'DELETE' }]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Lesson report operation failed' });
  }
  safe(f);
  const minutes = await fixture(async sql => { if (sql.includes('UPDATE minutes')) throw rawError(); return { rows: [report] }; });
  assert.equal((await minutes.app.request('/', post(report))).status, 500);
  assert.equal(minutes.queries.length, 2);
  safe(minutes);
});

test('successful reports preserve trusted reporter, crew tutor identity, PRO reference and minutes update', async () => {
  for (const [role, data, expectedKey] of [['crew', report, '1'], ['leader', { ...report, lesson_number: 'PROプラン', pro_curriculum: 'バズコンテンツ量産術', pro_text_number: '1' }, 'Pro_バズ_1']]) {
    const f = await fixture(async () => ({ rows: [data] }), role);
    const response = await f.app.request('/', post({ ...data, reported_by: 'forged', tutor_name: 'supplied' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data });
    assert.equal(f.queries[0][1][6], marker);
    assert.equal(f.queries[0][1][7], role === 'crew' ? marker : 'supplied');
    assert.match(f.queries[0][0], /ON CONFLICT \(student_id, lesson_date\)/);
    assert.deepEqual(f.queries[1][1], [expectedKey, expectedKey === '1' ? '1回目' : expectedKey, marker, '2026-10-26']);
    safe(f);
  }
  const skipped = await fixture(async () => ({ rows: [{ ...report, lesson_result: '無断キャンセル' }] }));
  assert.equal((await skipped.app.request('/', post({ ...report, lesson_result: '無断キャンセル' }))).status, 200);
  assert.equal(skipped.queries.length, 1);
  safe(skipped);
});

test('read contracts and filtered pagination preserve data, parameter binding and totals', async () => {
  const f = await fixture(async sql => ({ rows: sql.includes('COUNT(*)') ? [{ total: '12' }] : [report] }));
  const response = await f.app.request('/?start_date=2026-10-01&end_date=2026-10-31&student_id=fixture&tutor_name=fixture&lesson_result=実施済み&limit=10&offset=2');
  assert.deepEqual(await response.json(), { success: true, data: [report], count: 1, total: 12, limit: 10, offset: 2 });
  const filters = ['2026-10-01', '2026-10-31', '%fixture%', '%fixture%', '実施済み'];
  assert.deepEqual(f.queries[0][1], [...filters, '10', '2']);
  assert.deepEqual(f.queries[1][1], filters);
  assert.match(f.queries[0][0], /LIMIT \$6 OFFSET \$7/);
  assert.deepEqual(await (await f.app.request('/by-date/2026-10-26')).json(), { success: true, data: [report], count: 1 });
  assert.deepEqual(await (await f.app.request('/fixture/2026-10-26')).json(), { success: true, data: report });
  safe(f);
});

test('validation and missing report responses retain status and avoid invalid writes', async () => {
  const f = await fixture(async () => ({ rows: [] }));
  for (const data of [{}, { ...report, lesson_result: 'invalid' }, { ...report, lesson_number: 'PROプラン' }]) {
    assert.equal((await f.app.request('/', post(data))).status, 400);
  }
  assert.equal(f.queries.length, 0);
  assert.equal((await f.app.request('/fixture/2026-10-26')).status, 404);
  assert.equal((await f.app.request('/42', { method: 'DELETE' })).status, 404);
  safe(f);
});

test('successful report deletion retains returned row and SQL without identifying logs', async () => {
  const f = await fixture(async () => ({ rows: [report] }));
  const response = await f.app.request('/' + marker, { method: 'DELETE' });
  assert.deepEqual(await response.json(), { success: true, data: report });
  assert.equal(f.queries[0][0], 'DELETE FROM lesson_reports WHERE id = $1 RETURNING *');
  assert.deepEqual(f.queries[0][1], [marker]);
  safe(f);
});
