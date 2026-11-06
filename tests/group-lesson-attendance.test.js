import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendanceTimestamp, parseGroupLessonSurvey, fetchGroupLessonAttendance } from '../src/services/groupLessonAttendanceService.js';

const now = new Date('2026-11-06T12:00:00Z');
const ranges = rows => [{ values: [['タイムスタンプ'], ...rows.map(row => [row[0]])] }, { values: [['学籍番号'], ...rows.map(row => [row[1]])] }];
test('formatted and Sheets serial timestamps respect JST month/year boundaries', () => {
  assert.equal(parseAttendanceTimestamp('2026/11/01 00:00:00').toISOString(), '2026-10-31T15:00:00.000Z');
  const serial = (Date.UTC(2026, 10, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(parseAttendanceTimestamp(serial).toISOString(), '2026-10-31T15:00:00.000Z');
  assert.equal(parseAttendanceTimestamp('2026/02/30 10:00:00'), null);
  const result = parseGroupLessonSurvey(ranges([['2026/10/31 23:59:59', 'OLD'], ['2026/11/01 00:00:00', 'CURRENT'], ['2026/12/01 00:00:00', 'NEXT'], ['2026/11/30 10:00:00', 'FUTURE']]), '2026-11', now);
  assert.deepEqual([...result.attended], ['CURRENT']);
});
test('empty response sheets are valid, normalize IDs, deduplicate responses and never match by name', () => {
  assert.equal(parseGroupLessonSurvey(ranges([]), '2026-11', now).attended.size, 0);
  const result = parseGroupLessonSurvey(ranges([['2026/11/05 10:00:00', ' ｏｌｔｓ１２３－ａｂ '], ['2026/11/05 11:00:00', 'OLTS123-AB'], ['2026/11/05 12:00:00', ''], ['invalid', 'UNKNOWN']]), '2026-11', now);
  assert.deepEqual([...result.attended], ['OLTS123-AB']); assert.equal(result.attended.has('UNKNOWN'), false);
  assert.throws(() => parseGroupLessonSurvey([{ values: [['wrong']] }], '2026-11', now));
});
test('both sources are fetched once with only date/ID columns; an unanswered new form does not hide other attendance', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: { batchGet: async params => {
    calls.push(params);
    return { data: { valueRanges: calls.length === 1 ? ranges([['2026/11/05 10:00:00', 'S1']]) : ranges([]) } };
  } } } };
  const result = await fetchGroupLessonAttendance('2026-11', now, sheets);
  assert.equal(result.complete, true); assert.deepEqual([...result.attended], ['S1']); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].ranges, ["'フォームの回答 1'!A1:A", "'フォームの回答 1'!F1:F"]);
  assert.deepEqual(calls[1].ranges, ["'フォームの回答 1'!A1:A", "'フォームの回答 1'!D1:D"]);
});
test('one failed source marks completeness false but preserves attendance from the other source', async () => {
  let requests = 0;
  const sheets = { spreadsheets: { values: { batchGet: async () => {
    if (++requests === 1) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
    return { data: { valueRanges: ranges([['2026/11/05 10:00:00', 'S1']]) } };
  } } } };
  const result = await fetchGroupLessonAttendance('2026-11', now, sheets);
  assert.equal(result.complete, false); assert.deepEqual([...result.attended], ['S1']);
});

test('missing current-month records remain a valid empty attendance set despite old or undated ID rows', async () => {
  const sheets = { spreadsheets: { values: { batchGet: async () => ({ data: { valueRanges: ranges([['2026/10/05 10:00:00', 'S1'], ['', 'S1']]) } }) } } };
  const result = await fetchGroupLessonAttendance('2026-11', now, sheets);
  assert.equal(result.complete, true); assert.equal(result.attended.has('S1'), false); assert.deepEqual(result.failures, []);
});
test('permission and header failures give fixed actionable source messages without exposing errors', async () => {
  let calls = 0;
  const sheets = { spreadsheets: { values: { batchGet: async () => {
    if (++calls === 1) throw Object.assign(new Error('SYNTHETIC_PRIVATE_SECRET'), { response: { status: 403 } });
    return { data: { valueRanges: [{ values: [['wrong header']] }] } };
  } } } };
  const result = await fetchGroupLessonAttendance('2026-11', now, sheets);
  assert.equal(result.complete, false); assert.ok(result.failures[0].includes('閲覧権限'));
  assert.ok(result.failures[1].includes('ヘッダー')); assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SECRET'));
});
