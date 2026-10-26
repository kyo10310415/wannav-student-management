import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';

const marker = 'SYNTHETIC_TUTOR_RED_PRIVATE';
const headers = { Authorization: `Bearer ${'a'.repeat(64)}` };
const request = (body, method = 'POST') => ({ method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, config: { token: marker } });
let sequence = 0;
async function fixture({ query = async () => ({ rows: [] }), internalFail = false, skillFail = false, install = false, role = 'admin' } = {}) {
  const logs = [], queries = [], internal = [], skills = [];
  const deps = { Hono, process: { env: { TUTOR_SKILL_SHEET_ID: marker } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (...args) => { queries.push(args); return query(...args); },
    fetchTutorSkillScores: async id => { skills.push(id); if (skillFail) throw failure(); return new Map([[marker + '-high', 209], [marker + '-low', 209], [marker + '-middle', 210], [marker + '-remove', 210]]); },
    internalApi: { get: async path => {
      internal.push(path); if (internalFail) throw failure();
      if (path.includes('monthly-stats')) return { data: { success: true, data: { byEmployeeId: { [marker + '-high']: { helperRequestCount: 1 }, [marker + '-middle']: { helperRequestCount: 4 } } } } };
      if (path.includes('absence-stats')) return { data: { success: true, data: { stats: [{ tutor_name: marker + '-high', attendance_rate: 70 }] } } };
      return { data: { success: true, data: { [marker + '-high']: { '2026/10': { average: 9 } } } } };
    } },
  };
  const source = (await readFile(new URL('../src/routes/tutorRedList.js', import.meta.url), 'utf8'))
    .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'tutorRedPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let routes;
  try { routes = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const app = new Hono();
  if (install) installApiAccess(app, { db: async () => ({ rows: [{ id: 1, role, email: 'fixture@example.test', must_change_password: false }] }), integrationKey: () => '' });
  app.route('/api/tutor-red-list', routes);
  return { app, logs, queries, internal, skills };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all route DB errors and skill provider errors return fixed responses without raw logs', async () => {
  const f = await fixture({ query: async () => { throw failure(); } });
  for (const [path, options] of [['?year=2026&month=10'], ['/recalc', request({ year: 2026, month: 10 })],
    ['/fixture/status', request({ notes: marker }, 'PATCH')], ['/fixture', { method: 'DELETE' }]]) {
    const response = await f.app.request('/api/tutor-red-list' + path, options); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Tutor red list operation failed' });
  }
  safe(f);
  const skill = await fixture({ skillFail: true });
  assert.equal((await skill.app.request('/api/tutor-red-list?year=2026&month=10')).status, 500); safe(skill);
});

test('list success preserves real-time enrichment and internal request parameters', async () => {
  const f = await fixture({ query: async () => ({ rows: [{ tutor_id: marker + '-high', tutor_name: marker + '-high', rank: 'High' }] }) });
  const response = await f.app.request('/api/tutor-red-list?year=2026&month=10');
  assert.deepEqual(await response.json(), { success: true, year: 2026, month: 10, data: [{ tutor_id: marker + '-high', tutor_name: marker + '-high', rank: 'High',
    current_satisfaction: 90, current_helper_request_count: 1, current_attendance_rate: 70, skill_total_score: 209, year: 2026, month: 10 }] });
  assert.deepEqual(f.skills, [marker]);
  assert.ok(f.internal.includes('/api/tutors/monthly-stats/2026/10')); assert.ok(f.internal.includes('/api/schedules/absence-stats?year=2026&month=10')); safe(f);
});

test('internal data failures retain empty fallbacks and successful list response', async () => {
  const f = await fixture({ internalFail: true, query: async () => ({ rows: [{ tutor_id: marker, tutor_name: marker }] }) });
  const response = await f.app.request('/api/tutor-red-list?year=2026&month=10'); assert.equal(response.status, 200);
  const row = (await response.json()).data[0]; assert.equal(row.current_satisfaction, null); assert.equal(row.current_helper_request_count, 0); assert.equal(row.current_attendance_rate, null);
  assert.equal(f.internal.length, 3); safe(f);
});

test('recalculation preserves rank thresholds, score contributions, counts and deletion condition', async () => {
  const f = await fixture({ query: async (sql, params) => {
    if (sql.includes('SELECT * FROM tutors')) return { rows: ['high', 'low', 'middle', 'remove'].map(suffix => ({ employee_id: marker + '-' + suffix, tutor_name: marker + '-' + suffix, team: marker })) };
    if (sql.includes('SELECT id FROM tutor_red_list')) return { rows: params[0].endsWith('middle') ? [{ id: 1 }] : [] };
    if (sql.startsWith('DELETE')) return { rows: [{ id: 1 }] }; return { rows: [] };
  } });
  const response = await f.app.request('/api/tutor-red-list/recalc', request({ year: 2026, month: 10 }));
  assert.deepEqual(await response.json(), { success: true, message: '再計算完了: 新規2件, 更新1件, 除外1件', added: 2, updated: 1, removed: 1, year: 2026, month: 10 });
  const inserts = f.queries.filter(([sql]) => sql.includes('INSERT INTO tutor_red_list'));
  assert.deepEqual(inserts.map(([, params]) => params.slice(2, 6)), [['High', 7, 1, 3], ['Low', 3, 0, 0]]);
  const update = f.queries.find(([sql]) => sql.includes('SET rank = $1')); assert.deepEqual(update[1].slice(0, 4), ['Middle', 4, 4, 0]);
  const deletion = f.queries.find(([sql]) => sql.startsWith('DELETE')); assert.ok(deletion[0].includes('AND correspondence_status = $2'));
  assert.deepEqual(deletion[1], [marker + '-remove', '未対応']); safe(f);
});

test('status updates and deletion preserve field binding, messages and missing-record validation', async () => {
  const f = await fixture({ query: async () => ({ rows: [{ id: 1, notes: marker }] }) });
  const response = await f.app.request('/api/tutor-red-list/fixture/status', request({ correspondence_status: '対応中', assigned_to: marker, notes: marker }, 'PATCH'));
  assert.deepEqual(await response.json(), { success: true, data: { id: 1, notes: marker } });
  assert.deepEqual(f.queries[0][1], ['対応中', marker, marker, 'fixture']);
  assert.equal((await (await f.app.request('/api/tutor-red-list/fixture', { method: 'DELETE' })).json()).message, 'レッドリストから削除しました');
  const empty = await fixture();
  assert.equal((await empty.app.request('/api/tutor-red-list/fixture/status', request({}, 'PATCH'))).status, 400); assert.equal(empty.queries.length, 0);
  assert.equal((await empty.app.request('/api/tutor-red-list/fixture/status', request({ notes: '' }, 'PATCH'))).status, 404);
  assert.equal((await empty.app.request('/api/tutor-red-list/fixture', { method: 'DELETE' })).status, 404); safe(f); safe(empty);
});

test('existing global admin-only boundary continues rejecting crew and leader before any work', async () => {
  for (const role of ['crew', 'leader']) {
    const f = await fixture({ install: true, role });
    for (const [path, options] of [['/', { headers }], ['/recalc', request({})], ['/fixture/status', request({ notes: marker }, 'PATCH')], ['/fixture', { method: 'DELETE', headers }]]) {
      assert.equal((await f.app.request('/api/tutor-red-list' + path, options)).status, 403);
    }
    assert.equal(f.queries.length, 0); assert.equal(f.internal.length, 0); assert.equal(f.skills.length, 0); safe(f);
  }
});
