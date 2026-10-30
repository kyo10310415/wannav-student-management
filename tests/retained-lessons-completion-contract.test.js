import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
let sequence = 0;
const scheduled = [
  { student_id: 'SYN-CANCEL', lesson_date: '2026-10-29' },
  { student_id: 'SYN-UNREPORTED', lesson_date: '2026-10-30' },
  { student_id: 'SYN-DONE', lesson_date: '2026-10-28' }
];
async function fixture({ fallback = false, databaseFails = false } = {}) {
  const calls = [];
  const deps = { process: { env: { PROGRESS_SPREADSHEET_ID: 'synthetic' } }, console: { error(){} },
    normalizeStudentId: value => String(value).trim(),
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM lessons')) return { rows: scheduled };
      if (sql.includes('FROM lesson_reports')) {
        if (databaseFails) throw Error('SYNTHETIC_PRIVATE');
        return { rows: [
          { ...scheduled[0], lesson_result: '生徒様都合でリスケ' },
          { ...scheduled[2], lesson_result: '実施済み' }
        ] };
      }
      throw Error('Unexpected query');
    },
    fetchLessonCompletionStatus: async () => new Map([
      ['SYN-CANCEL_2026-10-29', { completed: true, lessonResult: '実施済み' }],
      ...(fallback ? [['SYN-UNREPORTED_2026-10-31', { completed: true, lessonResult: '実施済み' }]] : [])
    ])
  };
  const source = (await readFile(new URL('../src/services/lessonCompletionService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'retainedCompletion' + sequence++; globalThis[key] = deps;
  try { return { module: await import('data:text/javascript;base64,' + Buffer.from(`const {process,console,normalizeStudentId,query,fetchLessonCompletionStatus}=globalThis[${JSON.stringify(key)}];\n` + source).toString('base64')), calls }; }
  finally { delete globalThis[key]; }
}
test('retained scheduled rows are not automatically completed and DB reschedule overrides Sheets', async () => {
  const f = await fixture(); const result = await f.module.getCompletedStudentIdsForMonth('2026-10');
  assert.deepEqual(result.completedStudentIds, ['SYN-DONE']);
  assert.deepEqual(result.scheduledStudentIds, scheduled.map(row => row.student_id));
  assert.equal(result.checkedLessonCount, 3);
  assert.deepEqual(f.calls[0].params, ['2026-10-01', '2026-11-01']);
});
test('unreported retained rows still follow existing plus-two-day Sheets fallback', async () => {
  const f = await fixture({ fallback: true }); const result = await f.module.getCompletedStudentIdsForMonth('2026-10');
  assert.deepEqual(result.completedStudentIds, ['SYN-UNREPORTED', 'SYN-DONE']);
  assert.equal(result.completedStudentIds.includes('SYN-CANCEL'), false);
});
test('DB failure keeps the documented Sheets fallback instead of inventing cancellation state', async () => {
  const f = await fixture({ databaseFails: true }); const result = await f.module.getCompletedStudentIdsForMonth('2026-10');
  assert.deepEqual(result.completedStudentIds, ['SYN-CANCEL']);
  assert.equal(result.checkedLessonCount, 3);
});
