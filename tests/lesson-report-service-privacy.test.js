import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_LESSON_STAT_PRIVATE';
let sequence = 0;
async function fixture(rows = [], failure) {
  const logs = [], queries = [];
  const deps = { query: async (...args) => { queries.push(args); if (failure) throw failure; return { rows }; },
    console: { error: (...args) => logs.push(inspect(args)) } };
  const source = (await readFile(new URL('../src/services/lessonReportService.js', import.meta.url), 'utf8'))
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'lessonReportServiceFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { api, logs, queries };
}

test('all DB failures keep the original thrown object while logs omit error data and student ID', async () => {
  const error = Object.assign(new Error(marker), { detail: marker, query: marker, config: { password: marker } });
  const f = await fixture([], error);
  for (const [name, args] of [['calculateStudentLessonStats', []], ['getStudentLessonStats', [marker]],
    ['getLessonReportsByDateRange', [marker, marker]], ['getDailyLessonSummary', [marker]]]) {
    await assert.rejects(() => f.api[name](...args), thrown => thrown === error);
  }
  assert.equal(f.logs.length, 4); assert.equal(f.logs.join('\n').includes(marker), false);
});

test('batch statistics retain numeric conversion, PRO priority and empty progress defaults', async () => {
  const f = await fixture([
    { student_id: 'fixture-pro', has_pro_plan: '1', max_lesson_number: '9', absence_count: '2', completed_count: '3', total_reports: '5' },
    { student_id: 'fixture-regular', has_pro_plan: '0', max_lesson_number: '12', absence_count: '0', completed_count: '4', total_reports: '4' },
    { student_id: 'fixture-empty', has_pro_plan: null, max_lesson_number: null, absence_count: null, completed_count: null, total_reports: null },
  ]);
  assert.deepEqual(await f.api.calculateStudentLessonStats(), {
    'fixture-pro': { lesson_progress: 'Proプラン', absence_count: 2, completed_count: 3, total_reports: 5 },
    'fixture-regular': { lesson_progress: '12', absence_count: 0, completed_count: 4, total_reports: 4 },
    'fixture-empty': { lesson_progress: null, absence_count: 0, completed_count: 0, total_reports: 0 },
  });
  assert.match(f.queries[0][0], /GROUP BY student_id/); assert.equal(f.logs.length, 0);
});

test('single student statistics preserve parameter binding, PRO spelling and no-record zeros', async () => {
  const f = await fixture([{ has_pro_plan: '1', max_lesson_number: '9', absence_count: '2', completed_count: '3', total_reports: '5' }]);
  assert.deepEqual(await f.api.getStudentLessonStats(marker), { lesson_progress: 'PROプラン', absence_count: 2, completed_count: 3, total_reports: 5 });
  assert.deepEqual(f.queries[0][1], [marker]); assert.match(f.queries[0][0], /WHERE student_id = \$1/);
  const empty = await fixture(); assert.deepEqual(await empty.api.getStudentLessonStats(marker), { lesson_progress: null, absence_count: 0, completed_count: 0, total_reports: 0 });
});

test('date-range results preserve business payload and inclusive SQL date bounds', async () => {
  const rows = [{ student_id: marker, student_name: marker, homeroom_tutor: marker }]; const f = await fixture(rows);
  assert.equal(await f.api.getLessonReportsByDateRange('2026-10-01', '2026-10-31'), rows);
  assert.deepEqual(f.queries[0][1], ['2026-10-01', '2026-10-31']); assert.match(f.queries[0][0], /lr.lesson_date >= \$1 AND lr.lesson_date <= \$2/);
  assert.equal(f.logs.length, 0);
});

test('daily summary retains all result categories and counts unrecognized rows only in total', async () => {
  const f = await fixture([{ lesson_result: '実施済み', count: '2' }, { lesson_result: '生徒様都合でリスケ', count: '3' },
    { lesson_result: 'Tutor都合でリスケ', count: '4' }, { lesson_result: '無断キャンセル', count: '5' }, { lesson_result: 'fixture-other', count: '1' }]);
  assert.deepEqual(await f.api.getDailyLessonSummary('2026-10-27'), { total: 15, completed: 2, student_reschedule: 3, tutor_reschedule: 4, no_show: 5 });
  assert.deepEqual(f.queries[0][1], ['2026-10-27']); assert.equal(f.logs.length, 0);
  const empty = await fixture(); assert.deepEqual(await empty.api.getDailyLessonSummary('2026-10-27'), { total: 0, completed: 0, student_reschedule: 0, tutor_reschedule: 0, no_show: 0 });
});
