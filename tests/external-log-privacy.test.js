import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { differenceInMonths, parseISO } from 'date-fns';

const marker = 'SYNTHETIC_EXTERNAL_PRIVATE';
let sequence = 0;
async function fixture({ rows = [], fail = false } = {}) {
  const logs = [], queries = [];
  const deps = { Hono, differenceInMonths, parseISO,
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    queryExternal: async (...args) => { queries.push(args); if (fail) throw Object.assign(new Error(marker), { cause: new Error(marker), config: { password: marker } }); return { rows }; } };
  const service = (await readFile(new URL('../src/services/externalDbService.js', import.meta.url), 'utf8'))
    .replace("import { queryExternal } from '../db/externalConnection.js';", 'const { queryExternal } = deps;')
    .replace("import { differenceInMonths, parseISO } from 'date-fns';", 'const { differenceInMonths, parseISO } = deps;');
  const key = 'externalPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api, app;
  try {
    const prefix = `const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n`;
    api = await import(`data:text/javascript;base64,${Buffer.from(prefix + service).toString('base64')}`);
    deps.fetchLessonStartDates = api.fetchLessonStartDates;
    const route = (await readFile(new URL('../src/routes/external.js', import.meta.url), 'utf8'))
      .replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
      .replace("import { fetchLessonStartDates } from '../services/externalDbService.js';", 'const { fetchLessonStartDates } = deps;');
    app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + route).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  return { api, app, logs, queries };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('external success retains mapping, count and SQL without student logs', async () => {
  const f = await fixture({ rows: [{ student_id: marker, lesson_start_date: '2026-10-01' },
    { student_id: '', lesson_start_date: '2026-10-01' }, { student_id: marker + '-empty', lesson_start_date: null }] });
  const response = await f.app.request('/lesson-start-dates');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { [marker]: '2026-10-01' }, count: 1 });
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0][0], /FROM notion_students_cache/);
  assert.match(f.queries[0][0], /WHERE lesson_start_date IS NOT NULL/);
  assert.match(f.queries[0][0], /ORDER BY student_id/);
  safe(f);
});

test('external failure stays private at both service and HTTP boundaries', async () => {
  const f = await fixture({ fail: true });
  await assert.rejects(f.api.fetchLessonStartDates, error => {
    assert.equal(error.message, 'External lesson start dates could not be loaded');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(Object.hasOwn(error, 'config'), false);
    return true;
  });
  const response = await f.app.request('/lesson-start-dates');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'External lesson start dates could not be loaded' });
  safe(f);
});

test('external empty result and continued-month calculations preserve existing behavior', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/lesson-start-dates')).json(), { success: true, data: {}, count: 0 });
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  assert.equal(f.api.calculateContinuedMonths(start), 1);
  assert.equal(f.api.calculateContinuedMonths(start.replaceAll('-', '/')), 1);
  assert.equal(f.api.calculateContinuedMonths(null), 0);
  assert.equal(f.api.calculateContinuedMonths({ replace() { throw new Error(marker); } }), 0);
  safe(f);
});
