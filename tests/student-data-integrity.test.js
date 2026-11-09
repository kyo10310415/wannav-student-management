import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

for (const path of ['src/services/notionService.js', 'gas-notion-cache-sync.js',
  'docs/gas-cache-full-modified.gs', 'docs/gas-notion-cache-updated.js']) {
  test(`${path}: preserve text after formatting boundaries without adding separators`, async () => {
    const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    const context = vm.createContext({});
    vm.runInContext(extractFunction(source, 'getPropertyValue'), context);
    const read = property => path.endsWith('gas-notion-cache-updated.js')
      ? context.getPropertyValue({ value: property }, 'value', property.type)
      : context.getPropertyValue(property);
    for (const type of ['title', 'rich_text']) {
      assert.equal(read({ type, [type]: [{ plain_text: 'nare_' }, { plain_text: 'ta_' }] }), 'nare_ta_');
      assert.equal(read({ type, [type]: [{ plain_text: ' ' }, { plain_text: 'suffix' }] }), ' suffix');
      assert.equal(read({ type, [type]: [{ plain_text: '名' }, { plain_text: '（読み）' }] }), '名（読み）');
      assert.equal(read({ type, [type]: [] }) || null, null);
    }
  });
}

for (const path of ['gas-notion-cache-sync.js', 'docs/gas-cache-full-modified.gs']) {
  test(`${path}: fetched page identity overrides the editable Notion URL`, async () => {
    const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    const page = { id: '11111111-1111-1111-1111-111111111111', url: 'https://www.notion.so/11111111111111111111111111111111',
      properties: { 'Notion URL': { type: 'url', url: 'https://www.notion.so/22222222222222222222222222222222' } } };
    const context = vm.createContext({ NOTION_STUDENT_DB_ID: 'synthetic', NOTION_STUDENT_API_TOKEN: 'synthetic',
      UrlFetchApp: { fetch: () => ({ getContentText: () => JSON.stringify({ results: [page], has_more: false }) }) },
      Logger: { log() {} }, Utilities: { sleep() {} } });
    vm.runInContext(extractFunction(source, 'getPropertyValue') + '\n' + extractFunction(source, 'fetchStudentsFromNotion'), context);
    assert.equal(context.fetchStudentsFromNotion()[0].notion_url, page.url);
    delete page.url;
    assert.equal(context.fetchStudentsFromNotion()[0].notion_url, 'https://www.notion.so/11111111111111111111111111111111');
  });
}

for (const path of ['gas-notion-cache-sync.js', 'docs/gas-cache-full-modified.gs']) {
  for (const name of ['fetchStudentsFromNotion', 'fetchTutorsFromNotion']) {
    test(`${path}: ${name} rejects failed or incomplete pagination before cache replacement`, async () => {
      const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
      for (const secondPage of [{ object: 'error', message: 'synthetic failure' },
        { results: [], has_more: true }, { has_more: false }, { results: [] }, new Error('synthetic network failure')]) {
        let requests = 0;
        const context = vm.createContext({ NOTION_STUDENT_DB_ID: 'synthetic', NOTION_STUDENT_API_TOKEN: 'synthetic',
          NOTION_TUTOR_DB_ID: 'synthetic', NOTION_TUTOR_API_TOKEN: 'synthetic', Logger: { log() {} }, Utilities: { sleep() {} },
          UrlFetchApp: { fetch: () => {
            const page = ++requests === 1 ? { results: [{ id: 'synthetic', properties: {} }], has_more: true, next_cursor: 'cursor' } : secondPage;
            if (page instanceof Error) throw page;
            return { getContentText: () => JSON.stringify(page) };
          } } });
        vm.runInContext(extractFunction(source, 'getPropertyValue') + '\n' + extractFunction(source, name), context);
        assert.throws(() => context[name](), /全件取得できなかった/);
        assert.equal(requests, 2);
      }
    });
  }
}

async function syncFixture(students) {
  const writes = [];
  const deps = { Hono, process: { env: { GOOGLE_CACHE_SHEET_ID: 'synthetic' } }, console: { log() {}, warn() {}, error() {} },
    query: async (sql, params) => { writes.push({ sql, params }); return { rows: [] }; },
    getCacheSyncTime: async () => ({}), fetchStudentsFromCache: async () => students,
    fetchProgressFromCache: async () => ({}), fetchLessonStartDates: async () => ({}),
    fetchSuspensionMonthsMap: async () => ({}), fetchStudentTextTypeMap: async () => new Map(),
    calculateStudentLessonStats: async () => ({}), calculateContinuedMonths: () => 0,
    normalizeStudentTextTypeStudentId: id => id };
  const source = (await readFile(new URL('../src/routes/students.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  globalThis.studentIntegrityFixture = deps;
  try {
    const prefix = `const {${Object.keys(deps).join(',')}} = globalThis.studentIntegrityFixture;\n`;
    // A unique URL creates independent route state for each test fixture.
    const module = await import('data:text/javascript;base64,' + Buffer.from(prefix + source + `\n// ${Math.random()}`).toString('base64'));
    const response = await module.default.request('/sync');
    return { response, result: await response.json(), writes };
  } finally { delete globalThis.studentIntegrityFixture; }
}

test('duplicated student IDs never choose a page or status based on cache order', async () => {
  const duplicates = [
    { student_id: 'SYNTHETIC-DUPLICATE', notion_page_id: '11111111111111111111111111111111', status: '正規退会' },
    { student_id: 'SYNTHETIC-DUPLICATE', notion_page_id: '22222222222222222222222222222222', status: 'アクティブ' },
  ];
  for (const rows of [duplicates, [...duplicates].reverse()]) {
    const f = await syncFixture([...rows, { student_id: 'SYNTHETIC-UNIQUE', name: 'Synthetic' }]);
    assert.equal(f.response.status, 200);
    assert.equal(f.result.duplicateStudentIds, 1);
    assert.equal(f.result.skipped, 2);
    assert.equal(f.result.count, 1);
    const upserts = f.writes.filter(w => w.sql.includes('INSERT INTO students'));
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].params[0], 'SYNTHETIC-UNIQUE');
    assert.ok(!f.writes.some(w => /DELETE FROM students/.test(w.sql)));
  }
});

test('DB sync repairs a stale cached URL using its Notion page ID and keeps manual fields', async () => {
  const f = await syncFixture([{ student_id: 'SYNTHETIC', notion_page_id: '11111111-1111-1111-1111-111111111111',
    notion_url: 'https://www.notion.so/22222222222222222222222222222222' }]);
  const upsert = f.writes.find(w => w.sql.includes('INSERT INTO students'));
  assert.equal(upsert.params[8], 'https://www.notion.so/11111111111111111111111111111111');
  assert.doesNotMatch(upsert.sql, /pro_plan_start_date\s*=/);
  assert.equal(f.result.count, 1);
});
