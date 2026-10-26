import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
const marker = 'SYNTHETIC_NOTION_PRIVATE';
let sequence = 0;
async function fixture({ query, fallback = false } = {}) {
  const configs = [], queries = [], logs = [], waits = [];
  const deps = { Client: class { constructor(options) {
    const index = configs.length; configs.push(options);
    this.databases = { query: async input => { queries.push({ index, input }); return query ? query(index, input) : { results: [], has_more: false, next_cursor: null }; } };
  } }, process: { env: { NOTION_API_TOKEN: marker + '-fallback', ...(!fallback ? { NOTION_STUDENT_API_TOKEN: marker + '-student', NOTION_TUTOR_API_TOKEN: marker + '-tutor' } : {}),
    NOTION_STUDENT_DB_ID: marker + '-student-db', NOTION_TUTOR_DB_ID: marker + '-tutor-db' } },
    setTimeout: (resolve, ms) => { waits.push(ms); resolve(); },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/services/notionService.js', import.meta.url), 'utf8')).replace("import { Client } from '@notionhq/client';", '');
  const key = 'notionPrivacyFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const { Client, process, setTimeout, console } = globalThis[${JSON.stringify(key)}];\n`;
    return { module: await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`), configs, queries, logs, waits };
  } finally { delete globalThis[key]; }
}
const title = value => ({ type: 'title', title: [{ plain_text: value }] });
const rich = value => ({ type: 'rich_text', rich_text: [{ plain_text: value }] });
const select = value => ({ type: 'select', select: { name: value } });
const student = { id: marker, properties: { 学籍番号: rich(marker), 名前: title(marker), ステータス: select('アクティブ'), 契約プラン: select(marker), キャラクター名: rich(marker), 担任Tutor: { type: 'people', people: [{ name: marker }] } } };
const tutor = { id: marker, properties: { 従業員ID: rich(marker), 名前: title(marker), Tutor名: rich(marker), メールアドレス: { type: 'email', email: 'Tutor@Example.Invalid' },
  所属チーム: { type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] }, Notion名: { type: 'people', people: [{ name: marker }] }, 職種: select('Tutor'), ステータス: select('アクティブ'), 月の業務可能時間: { type: 'number', number: 40 } } };
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('student pagination retains query shape, cursor order, record mapping and every-third-page pacing', async () => {
  let page = 0;
  const f = await fixture({ query: async index => { assert.equal(index, 0); page++; return { results: [student], has_more: page < 4, next_cursor: 'synthetic-cursor-' + page }; } });
  const result = await f.module.fetchStudents(); assert.equal(result.length, 4);
  assert.deepEqual(result[0], { notion_page_id: marker, student_id: marker, name: marker, status: 'アクティブ', contract_plan: marker, character_name: marker, homeroom_tutor: marker });
  assert.deepEqual(f.queries.map(q => q.input.start_cursor), [undefined, 'synthetic-cursor-1', 'synthetic-cursor-2', 'synthetic-cursor-3']);
  for (const { input } of f.queries) { assert.equal(input.database_id, marker + '-student-db'); assert.equal(input.page_size, 100); }
  assert.deepEqual(f.waits, [1000]); safe(f);
});

test('Tutor mapping preserves lowercase email, people, multi-select and numeric properties', async () => {
  const f = await fixture({ query: async index => { assert.equal(index, 1); return { results: [tutor], has_more: false, next_cursor: null }; } });
  assert.deepEqual(await f.module.fetchTutors(), [{ notion_page_id: marker, employee_id: marker, name: marker, tutor_name: marker, email: 'tutor@example.invalid', team: 'A, B',
    notion_name: marker, job_type: 'Tutor', status: 'アクティブ', monthly_available_hours: 40 }]);
  assert.deepEqual(f.queries[0].input, { database_id: marker + '-tutor-db', start_cursor: undefined, page_size: 100 }); safe(f);
});

test('all client configurations suppress SDK logging while keeping credentials, read timeout and lazy cache', async () => {
  for (const fallback of [false, true]) {
    const f = await fixture({ fallback });
    assert.equal(f.configs.length, 2);
    assert.equal(f.configs[0].auth, marker + (fallback ? '-fallback' : '-student'));
    assert.equal(f.configs[1].auth, marker + (fallback ? '-fallback' : '-tutor'));
    const reader = f.module.getStudentNotionReadClient(); assert.equal(reader, f.module.getStudentNotionReadClient());
    assert.equal(f.configs.length, 3); assert.equal(f.configs[2].timeoutMs, 15000); assert.equal(f.configs[2].auth, f.configs[0].auth);
    for (const config of f.configs) { assert.equal(typeof config.logger, 'function'); config.logger('warn', marker, { body: marker }); }
    assert.equal(f.logs.length, 0);
  }
});

test('exhausted retries retain original exception identity and retry metadata without logging them', async () => {
  for (const fn of ['fetchStudents', 'fetchTutors']) {
    const error = Object.assign(new Error(marker), { code: marker, status: 429, headers: { 'retry-after': '2' }, body: marker });
    const f = await fixture({ query: async () => { throw error; } });
    await assert.rejects(() => f.module[fn](), caught => caught === error);
    assert.equal(f.queries.length, 3); assert.deepEqual(f.waits, [1000, 2000]); safe(f);
  }
});

test('transient retries preserve successful empty result and original backoff order', async () => {
  let attempts = 0;
  const f = await fixture({ query: async () => { if (++attempts < 3) throw new Error(marker); return { results: [], has_more: false, next_cursor: null }; } });
  assert.deepEqual(await f.module.fetchStudents(), []); assert.deepEqual(f.waits, [1000, 2000]); assert.equal(f.queries.length, 3); safe(f);
});

test('mapping failures still reject rather than returning partial data and do not log raw exceptions', async () => {
  const f = await fixture({ query: async () => ({ results: [{ id: marker }], has_more: false, next_cursor: null }) });
  await assert.rejects(() => f.module.fetchStudents(), TypeError);
  await assert.rejects(() => f.module.fetchTutors(), TypeError); safe(f);
});
