import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { createActionPointHistoryService } from '../src/services/actionPointHistoryService.js';

test('month-end captures current saved evaluations without external reads and never overwrites a frozen month', async () => {
  const calls = []; let ready = 0;
  const service = createActionPointHistoryService({ ensure: async () => { ready++; }, db: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 3 }; } });
  assert.deepEqual(await service.snapshot(new Date('2026-11-05T12:00:00Z')), { saved: 0 }); assert.equal(ready, 0);
  const date = new Date('2026-11-30T14:59:00Z');
  assert.deepEqual(await service.snapshot(date), { saved: 3 });
  assert.equal(calls[0].params[0], '2026-11'); assert.equal(calls[0].params[1], date);
  assert.equal(calls[0].params[2].ratio, null); assert.equal(calls[0].params[2].items.length, 15);
  assert.match(calls[0].sql, /ON CONFLICT \(student_id,year_month\) DO NOTHING/);
  assert.match(calls[0].sql, /s.name,s.status,s.contract_plan,s.homeroom_tutor/);
  assert.doesNotMatch(calls[0].sql, /\b(?:DELETE|UPDATE)\b/);
  await service.snapshot(date); assert.equal(calls.length, 2);
  await service.snapshot(new Date('2026-11-30T15:00:00Z')); assert.equal(calls.length, 2);
});
test('student history binds the ID, prioritizes frozen months, preserves missing records and sorts by month', async () => {
  const rows = [{ year_month: '2026-11', source: 'latest_saved' }, { year_month: '2026-10', source: 'snapshot' }];
  const service = createActionPointHistoryService({ ensure: async () => {}, db: async (sql, params) => {
    assert.deepEqual(params, ["S'1"]); assert.ok(!sql.includes("S'1"));
    assert.match(sql, /NOT EXISTS/); assert.match(sql, /ORDER BY year_month DESC/);
    return { rows };
  } });
  assert.equal(await service.studentHistory("S'1"), rows);
});
test('monthly history SQL uses immutable cohort metadata and returns all new-style colors', async () => {
  const source = await readFile(new URL('../src/routes/redList.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf("app.get('/history'"), source.indexOf('// ▼▼▼'));
  assert.match(block, /'status',m.status,'contract_plan',m.contract_plan/);
  assert.match(block, /action_point_monthly_snapshots m WHERE m.year_month=\$1/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('input type="month" id="redlist-history-month"'));
  assert.match(app, /item.action_points \|\| item.final_rank/);
  // The trend button must survive replacing the asynchronous score cell.
  assert.match(app, /class="red-list-loading[^]*?fa-spinner[^]*?<\/div>\s*<button data-action-point-trend-student/);
});

test('student history API requires a real user session and validates input without triggering evaluation', async () => {
  const original = await readFile(new URL('../src/routes/redList.js', import.meta.url), 'utf8');
  const start = original.indexOf("app.get('/student-history/:studentId'");
  const end = original.indexOf('\n});', start) + 4;
  const calls = [];
  const routes = new Hono();
  vm.runInNewContext(original.slice(start, end), { app: routes, validRedListStudentId: id => !!id && id.length <= 50 && !/[\u0000-\u001f\u007f]/.test(id),
    getStudentActionPointHistory: async id => { calls.push(id); return []; }, console });
  const app = new Hono();
  installApiAccess(app, { db: async () => ({ rows: [{ id: 1, role: 'crew', email: 'synthetic@example.test', must_change_password: false }] }) });
  app.route('/api/red-list', routes);
  assert.equal((await app.request('/api/red-list/student-history/S1')).status, 401);
  const options = { headers: { Authorization: `Bearer ${'a'.repeat(64)}` } };
  assert.equal((await app.request('/api/red-list/student-history/S1', options)).status, 200);
  assert.deepEqual(calls, ['S1']);
  assert.equal((await app.request('/api/red-list/student-history/' + 'S'.repeat(51), options)).status, 400);
  assert.equal(calls.length, 1);
});

test('trend popup escapes student/month labels and ignores responses after navigating away', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const setup = () => {
    let resolve;
    const request = new Promise(done => { resolve = done; });
    let modal;
    const root = { contains: node => node === modal, appendChild: node => { modal = node; } };
    const c = { currentPage: 'students', sessionToken: 'synthetic', currentUser: { id: 1, role: 'crew' }, students: [{ student_id: 'S1', name: '<img>' }], API_BASE: '',
      document: { getElementById: id => id === 'content' ? root : modal, createElement: () => ({ innerHTML: '', remove() { modal = null; } }) },
      axios: { get: () => request }, renderActionPointSummary: () => '0Pt / 5', escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
    vm.createContext(c); vm.runInContext(source.slice(source.indexOf('let actionPointTrendGeneration =')), c);
    return { c, resolve, modal: () => modal };
  };
  const f = setup(); const pending = f.c.openStudentActionPointTrend('S1');
  f.resolve({ data: { success: true, data: [{ year_month: '<svg>', action_points: {}, source: 'snapshot' }] } }); await pending;
  assert.ok(f.modal().innerHTML.includes('&lt;img&gt;')); assert.ok(f.modal().innerHTML.includes('&lt;svg&gt;')); assert.ok(f.modal().innerHTML.includes('月末固定'));
  const stale = setup(); const old = stale.c.openStudentActionPointTrend('S1'); stale.c.currentPage = 'tutors';
  stale.resolve({ data: { success: true, data: [{ year_month: 'PRIVATE_NEW_MONTH' }] } }); await old;
  assert.ok(!stale.modal().innerHTML.includes('PRIVATE_NEW_MONTH'));
});
