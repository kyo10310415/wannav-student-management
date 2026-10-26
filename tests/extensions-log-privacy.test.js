import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_EXTENSION_PRIVATE';
const paths = ['/stats', '/by-tutor', '/by-team'];
let sequence = 0;
const students = [4, 5, 10, 11, 11].map((months, i) => ({ student_id: marker + i, continued_months: months,
  homeroom_tutor: marker, team: marker, status: 'アクティブ', contract_plan: 'fixture' }));
const extensions = students.map((student, i) => ({ student_id: student.student_id,
  extension_certainty_1: '高', extension_certainty_2: i === 2 ? '対象外' : '中', hearing_status_1: false,
  hearing_status_2: true, examination_result_1: i === 1 ? '延長' : null, examination_result_2: i === 3 ? '退会' : null }));
async function fixture({ configured = true, fail, empty = false } = {}) {
  const logs = [], calls = [];
  const failAt = stage => { if (stage === fail) throw Object.assign(new Error(marker), { detail: marker, query: marker, config: { password: marker } }); };
  const deps = { Hono, console: Object.fromEntries(['log', 'error', 'warn'].map(level => [level, (...args) => logs.push(inspect(args))])),
    process: { env: { NODE_ENV: 'development' } },
    getExtensionPool: () => { failAt('extension-pool'); return configured ? {} : null; },
    queryExtension: async sql => { calls.push({ stage: 'extension', sql }); failAt('extension-query'); return { rows: empty ? [] : extensions }; },
    getPool: () => { failAt('main-pool'); return { query: async sql => { calls.push({ stage: 'main', sql }); failAt('main-query'); return { rows: empty ? [] : students }; } }; } };
  const source = (await readFile(new URL('../src/routes/extensions.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const Hono = deps.Hono;')
    .replace("import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';", 'const { queryExtension, getExtensionPool } = deps;')
    .replace("import { getPool } from '../db/connection.js';", 'const getPool = deps.getPool;');
  const key = 'extensionsPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console; const process = deps.process;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, calls };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('extension aggregate statistics preserve cycle, rates and SQL filters without student logs', async () => {
  const f = await fixture();
  const response = await f.app.request('/stats');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: {
    targetCount: 3, certaintyFilledCount: 1, extensionCount: 1, withdrawalCount: 1, extensionRate: 33.3,
    extensionRateVsResult: 50, remainingCount: 1, resultToldCount: 2,
    exam1st: { targetCount: 1, extensionCount: 1, extensionRate: 100 }, exam2nd: { targetCount: 2, extensionCount: 0, extensionRate: 0 }
  } });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].sql, /WHERE status = 'アクティブ'/);
  assert.match(f.calls[1].sql, /contract_plan NOT IN \('永久会員', '在籍プラン'\)/);
  safe(f);
});

test('tutor and team successes preserve identifiable response data while keeping logs private', async () => {
  const f = await fixture();
  const tutor = await (await f.app.request('/by-tutor')).json();
  assert.deepEqual(tutor.data, [{ tutorName: marker, hearingTargetCount: 2, examTargetCount: 3, hearingIncompleteCount: 1, examIncompleteCount: 1 }]);
  const team = await (await f.app.request('/by-team')).json();
  assert.deepEqual(team.data, [{ teamName: marker, targetCount: 3, extensionCount: 1, withdrawalCount: 1, extensionRate: 33.3,
    exam1stTargetCount: 1, exam1stExtensionCount: 1, exam1stExtensionRate: 100, exam2ndTargetCount: 2, exam2ndExtensionCount: 0, exam2ndExtensionRate: 0 }]);
  assert.match(f.calls[3].sql, /LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name/);
  safe(f);
});

test('all extension upstream failures return fixed 500 without development stack or provider content', async () => {
  for (const fail of ['extension-pool', 'extension-query', 'main-pool', 'main-query']) {
    const f = await fixture({ fail });
    for (const path of paths) {
      const response = await f.app.request(path);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.success, false);
      assert.match(body.error, /^Extension (?:tutor |team )?statistics could not be loaded$/);
      assert.equal(Object.hasOwn(body, 'details'), false);
      assert.equal(JSON.stringify(body).includes(marker), false);
    }
    safe(f);
  }
});

test('unconfigured extension DB retains 503 without querying either database', async () => {
  const f = await fixture({ configured: false });
  for (const path of paths) assert.equal((await f.app.request(path)).status, 503);
  assert.equal(f.calls.length, 0);
  safe(f);
});

test('empty extension data retains successful zero statistics and empty group lists', async () => {
  const f = await fixture({ empty: true });
  const stats = await (await f.app.request('/stats')).json();
  assert.equal(stats.data.targetCount, 0);
  assert.equal(stats.data.extensionRate, 0);
  for (const path of ['/by-tutor', '/by-team']) assert.deepEqual((await (await f.app.request(path)).json()).data, []);
  safe(f);
});
