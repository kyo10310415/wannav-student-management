import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHandoverExport, buildHandoverExportLists, HANDOVER_EXPORT_HEADER } from '../src/services/handoverExportService.js';

const student = id => ({ student_id: id, name: id, homeroom_tutor: '送り元', handover_tutor_name: '受取先' });
test('three export categories exclude PRO overlap and deduplicate the PRO cohort', () => {
  const pro = { ...student('P'), desired_curricula: ['配信', '動画'] };
  const rows = classifyHandoverExport([student('H'), student('P')], [student('N'), student('P')], [pro, pro, { student_id: 'UNASSIGNED' }]);
  assert.deepEqual(rows.map(s => [s.student_id, s.type]), [['H', '引き継ぎ'], ['N', '新規'], ['P', 'PROプラン']]);
  const lists = buildHandoverExportLists(rows);
  assert.deepEqual(lists.sectionRows.map(i => lists.values[i][0]), ['引き継ぎ', '新規', 'PROプラン']);
  assert.equal(lists.headerRows.length, 3);
  lists.headerRows.forEach(i => assert.deepEqual(lists.values[i], HANDOVER_EXPORT_HEADER));
  assert.equal(lists.values.at(-1).at(-1), '配信\n動画');
  assert.equal(lists.values.filter(r => r[5] === 'P').length, 1);
});
test('empty categories remain labeled, and each Tutor direction keeps its own three lists', () => {
  const rows = classifyHandoverExport([student('H')], [student('N')], [student('P')]);
  for (const selected of [rows.filter(s => s.handover_tutor_name === '受取先'), rows.filter(s => s.homeroom_tutor === '送り元')]) {
    assert.equal(buildHandoverExportLists(selected).sectionRows.length, 3);
  }
  const empty = buildHandoverExportLists([]);
  assert.equal(empty.values.filter(r => r[0] === '該当なし').length, 3);
});
