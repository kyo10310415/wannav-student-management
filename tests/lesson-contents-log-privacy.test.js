import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { deriveLessonContentKey, resolveLessonReference } from '../src/services/lessonReferenceService.js';

const marker = 'SYNTHETIC_LESSON_CONTENT_PRIVATE';
const item = { lesson_number: '1', title: marker, content: marker };
const request = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const rawError = () => Object.assign(new Error(marker), { config: { password: marker }, detail: marker });
let sequence = 0;
async function fixture(query) {
  const logs = [], queries = [];
  const deps = { Hono, deriveLessonContentKey, resolveLessonReference,
    query: async (...args) => { queries.push(args); return query(...args); },
    console: { error: (...args) => logs.push(inspect(args)) } };
  const source = (await readFile(new URL('../src/routes/lessonContents.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace(/import \{\s*deriveLessonContentKey,\s*resolveLessonReference\s*\} from '..\/services\/lessonReferenceService.js';/, 'const { deriveLessonContentKey, resolveLessonReference } = deps;');
  const key = 'lessonContentPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all lesson content failures including a partial bulk failure return fixed private errors', async () => {
  const f = await fixture(async () => { throw rawError(); });
  for (const [path, options] of [['/'], ['/', request(item)], ['/1', request(item, 'PUT')], ['/1', { method: 'DELETE' }], ['/bulk', request({ items: [item] })]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Lesson content operation failed' });
  }
  safe(f);
  let count = 0;
  const partial = await fixture(async () => { if (++count === 2) throw rawError(); return { rows: [] }; });
  assert.equal((await partial.app.request('/bulk', request({ items: [item, { ...item, lesson_number: '2' }] }))).status, 500);
  assert.equal(partial.queries.length, 2);
  safe(partial);
});

test('content CRUD success preserves rows, normalized keys, empty updates and parameter binding', async () => {
  const f = await fixture(async () => ({ rows: [item] }));
  assert.deepEqual(await (await f.app.request('/')).json(), { success: true, data: [item] });
  assert.deepEqual(await (await f.app.request('/', request({ ...item, lesson_number: '01' }))).json(), { success: true, data: item });
  assert.deepEqual(f.queries[1][1], ['1', marker, marker]);
  assert.match(f.queries[1][0], /ON CONFLICT \(lesson_number\)/);
  assert.deepEqual(await (await f.app.request('/Pro_バズ_1', request({ title: '', content: '' }, 'PUT'))).json(), { success: true, data: item });
  assert.deepEqual(f.queries[2][1], ['', '', 'Pro_バズ_1']);
  assert.deepEqual(await (await f.app.request('/1', { method: 'DELETE' })).json(), { success: true, message: '削除しました' });
  assert.deepEqual(f.queries[3][1], ['1']);
  safe(f);
});

test('bulk success retains valid rows, normalization and invalid-row skips', async () => {
  const f = await fixture(async () => ({ rows: [] }));
  const response = await f.app.request('/bulk', request({ items: [{ title: marker }, { lesson_number: 'invalid' }, item, { ...item, lesson_number: 'Pro_バズ_1' }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: '2件を登録しました' });
  assert.deepEqual(f.queries.map(([, params]) => params), [['1', marker, marker], ['Pro_バズ_1', marker, marker]]);
  safe(f);
});

test('missing and invalid content input retains 400 before database access', async () => {
  const f = await fixture(async () => ({ rows: [] }));
  for (const [path, body] of [['/', {}], ['/', { lesson_number: 'invalid' }], ['/bulk', {}], ['/bulk', { items: [] }]]) {
    assert.equal((await f.app.request(path, request(body))).status, 400);
  }
  assert.equal(f.queries.length, 0);
  safe(f);
});

test('missing update retains 404 and null fields without touching other columns', async () => {
  const f = await fixture(async () => ({ rows: [] }));
  const response = await f.app.request('/1', request({}, 'PUT'));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'レッスン内容が見つかりません');
  assert.deepEqual(f.queries[0][1], [null, null, '1']);
  safe(f);
});
