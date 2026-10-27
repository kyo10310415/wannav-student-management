import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
let sequence = 0;
const token = 'a'.repeat(64), marker = 'SYNTHETIC_DIAGNOSTIC_PRIVATE';
const headers = { Authorization: 'Bearer ' + token };
async function fixture(role = 'crew', expired = false) {
  const queries = [], cacheReads = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: sql.includes('FROM students') ? [{ student_id: 'fixture', name: marker, status: 'アクティブ', continued_months: 6, lesson_start_date: '2026-01-01', result_overall: marker }] : [] }; } };
  const deps = { Hono, getPool: () => pool, getExtensionPool: () => pool, queryExtension: pool.query, process: { env: { GOOGLE_CACHE_SHEET_ID: 'fixture' } }, console: { log() {}, warn() {}, error() {} },
    fetchSurveyResponsesFromCache: async () => { cacheReads.push('counts'); return { FIXTURE: 6 }; },
    fetchCurrentMonthSurveyResponses: async () => { cacheReads.push('current'); return new Set(['FIXTURE']); },
    fetchMonthlyResponseHistory: async () => { cacheReads.push('history'); return new Map(); },
    fetchExtensionResultsFromCache: async () => { cacheReads.push('extension'); return { FIXTURE: '延長' }; },
    checkStampRallyAchievements: async () => { throw Error('Unexpected notification'); }, axios: { post: async () => { throw Error('Unexpected delivery'); } } };
  const source = (await readFile(new URL('../src/routes/survey.js', import.meta.url), 'utf8'))
    .replace(/import \{[\s\S]*?\} from '[^']+';\r?\n/g, '')
    .replace("await import('../services/stampRallyService.js')", 'deps').replace("(await import('axios')).default", 'deps.axios');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'surveyDiagnosticAccess' + sequence++;
  globalThis[key] = deps; let route;
  try { route = (await import('data:text/javascript;base64,' + Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { Hono, getPool, getExtensionPool, queryExtension, process, console, fetchSurveyResponsesFromCache, fetchCurrentMonthSurveyResponses, fetchMonthlyResponseHistory, fetchExtensionResultsFromCache } = deps;\n${source}`).toString('base64'))).default; }
  finally { delete globalThis[key]; }
  const app = new Hono(); installApiAccess(app, { db: async () => ({ rows: expired ? [] : [{ id: 1, email: 'fixture@example.invalid', role }] }), integrationKey: () => 'b'.repeat(64) }); app.route('/api/survey', route);
  return { app, queries, cacheReads };
}
test('crew and leader diagnostic GET/HEAD requests are denied before any data source is touched', async () => {
  for (const role of ['crew', 'leader']) for (const method of ['GET', 'HEAD']) {
    const f = await fixture(role);
    const response = await f.app.request('/api/survey/debug/fixture?role=admin', { method, headers: { ...headers, 'X-User-Role': 'admin' } });
    assert.equal(response.status, 403); assert.equal(f.queries.length + f.cacheReads.length, 0);
    assert.equal((await response.text()).includes(marker), false);
  }
});
test('administrator diagnostic response retains the existing business fields and query binding', async () => {
  const f = await fixture('admin'); const response = await f.app.request('/api/survey/debug/fixture', { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json(); assert.equal(body.debug.student_info.name, marker); assert.equal(body.debug.student_info.result_overall, marker);
  assert.equal(body.debug.extension_data.extension_result, '延長');
  assert.equal(f.queries.find(x => x.sql.includes('FROM students')).params[0], 'fixture');
  assert.equal(f.cacheReads.length > 0, true);
});
test('crew and leader normal survey reads retain access', async () => {
  for (const role of ['crew', 'leader']) for (const path of ['/responses/fixture', '/stats/fixture']) {
    const f = await fixture(role); const response = await f.app.request('/api/survey' + path, { headers });
    assert.equal(response.status, 200, role + path); assert.equal(f.queries.length > 0, true);
  }
});
test('anonymous expired and machine credentials cannot enter administrator diagnostics', async () => {
  for (const options of [{ headers: {} }, { expired: true, headers }, { headers: { 'X-Sync-API-Key': 'b'.repeat(64) } }, { headers: { 'X-Internal-Request': 'fake' } }]) {
    const f = await fixture('admin', options.expired); const response = await f.app.request('/api/survey/debug/fixture', { headers: options.headers });
    assert.equal([401, 403].includes(response.status), true); assert.equal(f.queries.length + f.cacheReads.length, 0);
  }
});
