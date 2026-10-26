import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
let sequence = 0;
async function fixture({ databaseFails = false, cacheFails = false } = {}) {
  const logs = [], reads = [];
  const deps = { process: { env: { PROGRESS_SPREADSHEET_ID: 'fixture' } }, console: { error: (...args) => logs.push(inspect(args)) }, query: async () => { if (databaseFails) throw Error('SYNTHETIC_COMPLETION_PRIVATE'); return { rows: [{ student_id: 'fixture', lesson_date: '2026-10-27', lesson_result: '実施済み', reported_at: 'fixture-time' }] }; }, fetchLessonCompletionStatus: async id => { reads.push(id); if (cacheFails) throw Error('SYNTHETIC_COMPLETION_PRIVATE'); return new Map([['fixture_2026-10-27', { completed: true, lessonResult: '実施済み', timestamp: 'sheet-time' }]]); }, normalizeStudentId: id => id };
  const source = (await readFile(new URL('../src/services/lessonCompletionService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'completionServicePrivacy' + sequence++;
  globalThis[key] = deps;
  try { return { module: await import('data:text/javascript;base64,' + Buffer.from(`const { process, console, query, fetchLessonCompletionStatus, normalizeStudentId } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')), logs, reads }; }
  finally { delete globalThis[key]; }
}
const items = [{ studentId: 'fixture', lessonDate: '2026-10-27' }];
test('completion database failure retains spreadsheet fallback without leaking provider messages', async () => {
  const f = await fixture({ databaseFails: true }); const result = await f.module.resolveLessonCompletionItems(items);
  assert.equal(result[0].source, 'spreadsheet'); assert.equal(result[0].completed, true);
  assert.equal(f.logs.join('\n').includes('SYNTHETIC_COMPLETION_PRIVATE'), false);
});
test('completion cache failure retains authoritative database results and both failures retain none result', async () => {
  const f = await fixture({ cacheFails: true }); const result = await f.module.resolveLessonCompletionItems(items);
  assert.equal(result[0].source, 'database'); assert.equal(result[0].timestamp, 'fixture-time');
  const both = await fixture({ databaseFails: true, cacheFails: true }); const missing = await both.module.resolveLessonCompletionItems(items);
  assert.equal(missing[0].source, 'none'); assert.equal(missing[0].completed, false);
  assert.equal([...f.logs, ...both.logs].join('\n').includes('SYNTHETIC_COMPLETION_PRIVATE'), false);
});
