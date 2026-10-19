import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';

function routes() {
  const records = new Map(Array.from({ length: 10 }, (_, i) => {
    const id = `TEST-${i}`;
    return [id, { student_id: id, pro_plan_start_date: '2026-06-01' }];
  }));
  const queries = [];
  let cache = [...records.values()].map(s => ({ student_id: s.student_id, name: 'Test' }));
  let unavailable = false;
  const context = {
    Hono, console: { log() {}, warn() {}, error() {} },
    process: { env: { GOOGLE_CACHE_SHEET_ID: 'test-only' } },
    getCacheSyncTime: async () => ({}),
    fetchStudentsFromCache: async () => {
      if (unavailable) throw new Error('Temporary failure');
      return cache;
    },
    fetchProgressFromCache: async () => ({}),
    fetchLessonStartDates: async () => ({}),
    fetchSuspensionMonthsMap: async () => ({}),
    fetchStudentTextTypeMap: async () => new Map(),
    calculateStudentLessonStats: async () => ({}),
    normalizeStudentTextTypeStudentId: id => id,
    calculateContinuedMonths: () => 0,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/DELETE FROM students/i.test(sql)) {
        records.delete(params[0]);
      } else if (/INSERT INTO students/.test(sql)) {
        // Model the SQL upsert: only explicitly assigned fields may change.
        assert.ok(!sql.includes('pro_plan_start_date'));
        if (!records.has(params[0])) records.set(params[0], { student_id: params[0], pro_plan_start_date: null });
        records.get(params[0]).name = params[1];
      } else if (/UPDATE students/.test(sql)) {
        const record = records.get(params[1]);
        if (!record) return { rows: [] };
        record.pro_plan_start_date = params[0];
        return { rows: [record] };
      }
      return { rows: [...records.values()] };
    }
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../src/routes/students.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default app;', 'globalThis.app = app;');
  vm.runInContext(source, context);
  return { app: context.app, records, queries, setCache(value) { cache = value; }, failCache() { unavailable = true; } };
}

test('sync preserves a missing student below the old 20% threshold and keeps PRO month when they return', async () => {
  const r = routes();
  const original = r.records.get('TEST-0');
  r.setCache([...r.records.values()].slice(1));
  const response = await r.app.request('/sync');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, 0);
  assert.equal(r.records.get('TEST-0'), original);
  r.setCache([{ student_id: 'TEST-0', name: 'Updated name', status: 'アクティブ' }]);
  assert.equal((await r.app.request('/sync')).status, 200);
  assert.equal(r.records.get('TEST-0').name, 'Updated name');
  assert.equal(r.records.get('TEST-0').pro_plan_start_date, '2026-06-01');
  assert.equal(r.records.size, 10);
  assert.ok(!r.queries.some(q => /DELETE FROM students/i.test(q.sql)));
});

test('empty or unavailable cache leaves all existing records unchanged', async () => {
  for (const unavailable of [false, true]) {
    const r = routes();
    if (unavailable) r.failCache(); else r.setCache([]);
    assert.equal((await r.app.request('/sync')).status, unavailable ? 200 : 400);
    assert.equal(r.queries.length, 0);
    assert.equal(r.records.get('TEST-0').pro_plan_start_date, '2026-06-01');
  }
});

const update = (app, body, id = 'TEST-0') => app.request(`/${id}/pro-plan`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('missing, empty and invalid PRO dates are rejected without touching saved month', async () => {
  const r = routes();
  for (const body of [{}, { proPlanStartDate: '' }, { proPlanStartDate: false },
    { proPlanStartDate: 'invalid' }, { proPlanStartDate: '2026-02-30' },
    { proPlanStartDate: '2026-13-01' }, { proPlanStartDate: '0000-01-01' }]) {
    assert.equal((await update(r.app, body)).status, 400);
  }
  assert.equal(r.queries.length, 0);
  assert.equal(r.records.get('TEST-0').pro_plan_start_date, '2026-06-01');
});

test('valid dates normalize to first day, explicit null still clears and unknown student returns 404', async () => {
  const r = routes();
  assert.equal((await update(r.app, { proPlanStartDate: '2024-02-29' })).status, 200);
  assert.equal(r.records.get('TEST-0').pro_plan_start_date, '2024-02-01');
  assert.equal((await update(r.app, { proPlanStartDate: null })).status, 200);
  assert.equal(r.records.get('TEST-0').pro_plan_start_date, null);
  assert.equal((await update(r.app, { proPlanStartDate: '2026-06-01' }, 'UNKNOWN')).status, 404);
});
