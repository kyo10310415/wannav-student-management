import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createActionPointService } from '../src/services/actionPointService.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../public/red-list-read-events.js', import.meta.url), 'utf8');
const rows = [
  { student_id: 'A', status: 'アクティブ', contract_plan: 'スタンダードプラン' },
  { student_id: 'B', status: 'アクティブ', contract_plan: '永久会員' },
  { student_id: 'C', status: '休会', contract_plan: 'スタンダードプラン' },
  { student_id: 'D', status: '退会', contract_plan: '永久会員' },
  { student_id: 'E', status: 'アクティブ', contract_plan: '' }
];
function fixture() {
  const controls = { 'action-point-status-filter': { value: 'アクティブ' }, 'action-point-plan-filter': { value: 'non-lifetime' } };
  const context = { document: { getElementById: id => controls[id] }, currentRedListData: rows, historyRedListData: [],
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(context); vm.runInContext(app.slice(app.indexOf('function getFilteredActionPointData(')), context);
  return { context, controls, ids: () => Array.from(context.getFilteredActionPointData(rows), row => row.student_id) };
}
test('default filters are active and non-lifetime; all and exact plans/statuses can be selected', () => {
  const f = fixture(); assert.deepEqual(f.ids(), ['A', 'E']);
  f.controls['action-point-plan-filter'].value = 'all'; assert.deepEqual(f.ids(), ['A', 'B', 'E']);
  f.controls['action-point-status-filter'].value = 'all'; assert.deepEqual(f.ids(), ['A', 'B', 'C', 'D', 'E']);
  f.controls['action-point-plan-filter'].value = '永久会員'; assert.deepEqual(f.ids(), ['B', 'D']);
  f.controls['action-point-status-filter'].value = '退会'; assert.deepEqual(f.ids(), ['D']);
});
test('refresh preserves selected filters and escapes imported option values', () => {
  const f = fixture(); f.controls['action-point-status-filter'].value = '休会';
  f.context.currentRedListData = [...rows, { status: '<svg>', contract_plan: '\"><img>' }];
  f.context.populateActionPointFilters();
  assert.equal(f.controls['action-point-status-filter'].value, '休会');
  assert.equal(f.controls['action-point-plan-filter'].value, 'non-lifetime');
  assert.ok(!f.controls['action-point-plan-filter'].innerHTML.includes('<img>'));
  assert.ok(f.controls['action-point-plan-filter'].innerHTML.includes('&quot;&gt;&lt;img&gt;'));
});
test('read API exposes filter metadata/all statuses while evaluation remains active only', async () => {
  const sql = [];
  const service = createActionPointService({ query: async statement => { sql.push(statement); return { rows }; } });
  const result = await service.getAll('2026-11');
  assert.equal(result.length, 5); assert.equal(result[2].status, '休会');
  assert.match(sql[0], /s.status, s.contract_plan/); assert.doesNotMatch(sql[0], /WHERE s.status='アクティブ'/);
  const source = await readFile(new URL('../src/services/actionPointService.js', import.meta.url), 'utf8');
  assert.match(source, /FROM students WHERE status = 'アクティブ'/);
});
test('filter delegation is read-only and rejects stale/unauthenticated/forged selections', () => {
  const calls = [];
  const select = { id: 'action-point-status-filter', value: 'アクティブ', options: [{ value: 'アクティブ' }], closest() { return this; } };
  const context = { sessionToken: 'synthetic', currentUser: { role: 'crew' }, currentPage: 'red-list', currentRedListTab: 'current',
    document: { addEventListener() {}, getElementById: () => ({ contains: node => node === select }) },
    renderRedListCurrentList: () => calls.push('current'), renderRedListHistoryList: () => calls.push('history'), updateRedListStats: () => calls.push('stats') };
  vm.createContext(context); vm.runInContext(events, context);
  context.handleActionPointFilterChange({ target: select }); assert.deepEqual(calls, ['current', 'stats']);
  select.value = 'forged'; context.handleActionPointFilterChange({ target: select });
  select.value = 'アクティブ'; context.sessionToken = ''; context.handleActionPointFilterChange({ target: select });
  assert.equal(calls.length, 2);
});
