import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fixture() {
  let modal, focused = 0;
  const cell = { dataset: { studentId: 'S1' }, innerHTML: '' };
  const button = { closest: () => cell, focus: () => { focused++; } };
  const root = { contains: node => !!node && [cell, button, modal].includes(node), appendChild: node => { modal = node; } };
  const context = { currentPage: 'students', sessionToken: 'synthetic', currentUser: { id: 1, role: 'crew' }, students: [{ student_id: 'S1', name: '<img>' }],
    document: { getElementById: id => id === 'content' ? root : modal,
      createElement: () => ({ innerHTML: '', querySelector: () => ({ focus() {} }), remove: () => { modal = null; } }) },
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('function actionPointStyle(')), context);
  const start = source.indexOf('function updateRedListDisplay(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  const result = { ratio: 0.3, rank: 'middle', total: 3, evaluated: 10, items: [{ label: '満足度', criterion: '<svg>', reason: '判定根拠', status: 'evaluated', point: 1 }] };
  context.updateRedListDisplay('S1', { action_points: result }, cell);
  return { context, cell, button, modal: () => modal, focused: () => focused };
}
test('student cell stays compact and opens cached details in a readable popup without fetching', () => {
  const f = fixture();
  assert.ok(f.cell.innerHTML.includes('data-action-point-detail-open')); assert.ok(!f.cell.innerHTML.includes('<details'));
  f.context.openStudentActionPointDetails(f.button);
  const html = f.modal().innerHTML;
  assert.ok(html.includes('role="dialog"')); assert.ok(html.includes('max-w-xl'));
  assert.ok(html.includes('text-sm leading-6')); assert.ok(html.includes('<details open'));
  assert.ok(html.includes('判定根拠')); assert.ok(html.includes('&lt;svg&gt;')); assert.ok(html.includes('&lt;img&gt;'));
  assert.ok(!html.includes('min-w-64'));
  f.context.closeStudentActionPointDetails(); assert.equal(f.modal(), null); assert.equal(f.focused(), 1);
});
test('details refuse a stale session, actor, page or rebound student cell', () => {
  for (const change of [f => { f.context.sessionToken = 'changed'; }, f => { f.context.currentUser.id = 2; },
    f => { f.context.currentUser.role = 'leader'; }, f => { f.context.currentPage = 'tutors'; }, f => { f.cell.dataset.studentId = 'OTHER'; }]) {
    const f = fixture(); change(f); f.context.openStudentActionPointDetails(f.button); assert.equal(f.modal(), undefined);
  }
});
