import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { buildStudentTextTypeMap } from '../src/services/studentTextTypeService.js';

const marker = 'SYNTHETIC_SHEETS_PRIVATE';
let sequence = 0;
const privateError = () => Object.assign(new Error(marker), { config: { headers: { Authorization: marker } }, response: { data: marker } });
async function fixture({ rows = [], valueRanges = [], fail = false, credentials = '{}', initFail = false, queryFail = false } = {}) {
  const logs = [], calls = [], queries = [];
  const invoke = async (method, params) => {
    calls.push({ method, params });
    if (fail) throw privateError();
    return { data: { values: rows, valueRanges } };
  };
  const deps = {
    process: { env: { GOOGLE_CREDENTIALS_JSON: credentials, GOOGLE_SHEET_ID: marker, STUDENT_INFO_SPREADSHEET_ID: marker } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    buildStudentTextTypeMap,
    google: { auth: { GoogleAuth: class { constructor() { if (initFail) throw privateError(); } } },
      sheets: () => ({ spreadsheets: { values: Object.fromEntries(['get', 'batchGet', 'update', 'batchUpdate'].map(method => [method, params => invoke(method, params)])) } }) },
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryFail) throw privateError();
      return { rows: sql.includes('FROM students') ? [{ student_id: marker, homeroom_tutor: marker }] : [{ notion_name: marker, tutor_name: marker + '-tutor' }] };
    },
  };
  let source = await readFile(new URL('../src/services/sheetsService.js', import.meta.url), 'utf8');
  source = source.replace("import { google } from 'googleapis';", 'const google = deps.google;')
    .replace("import { buildStudentTextTypeMap } from './studentTextTypeService.js';", 'const buildStudentTextTypeMap = deps.buildStudentTextTypeMap;')
    .replace("await import('../db/connection.js')", '({ query: deps.query })');
  assert.equal(source.includes('import('), false);
  const key = 'sheetsPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try {
    api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const process = deps.process; const console = deps.console;\n${source}`).toString('base64')}`);
  } finally { delete globalThis[key]; }
  return { api, logs, calls, queries };
}
function safe(f) { assert.equal(f.logs.join('\n').includes(marker), false); }
const throwing = ['fetchStudentTextTypeMap', 'fetchLessonsFromSheet', 'fetchLessonsForTomorrow', 'fetchSchedulesFromSheet',
  'fetchIndividualWebhooks', 'fetchTutorWebhooks', 'fetchSuspensionData', 'fetchStudentBroadcastInfo', 'fetchVQDiagnosisResults',
  'updateVQDiagnosisEmailStatus', 'batchUpdateVQDiagnosisEmailStatus', 'fetchVQDiagnosisByStudentId'];

test('all rejecting Sheets operations replace raw provider errors with fixed exceptions', async () => {
  for (const name of throwing) {
    const f = await fixture({ fail: true });
    const args = name === 'batchUpdateVQDiagnosisEmailStatus' ? [[{ rowNumber: 2, value: marker }]] : [marker];
    await assert.rejects(() => f.api[name](...args), error => {
      assert.equal(error.message, `[Sheets] ${name} failed`);
      assert.equal(error.cause, undefined);
      assert.equal(error.config, undefined);
      return true;
    });
    safe(f);
  }
});

test('credential parsing and client initialization never expose credential contents', async () => {
  for (const options of [{ credentials: `{"private_key":"${marker}"` }, { credentials: '' }, { initFail: true }]) {
    const f = await fixture(options);
    assert.throws(() => f.api.getSheets(), { message: '[Sheets] getSheets failed' });
    safe(f);
  }
  const f = await fixture({ credentials: Buffer.from('{}').toString('base64') });
  assert.equal(f.api.getSheets(), f.api.getSheets());
});

test('existing null, zero and empty fallback values remain unchanged on provider failures', async () => {
  for (const [name, expected] of [['getLastSyncTime', null], ['fetchAllWanamiUsageCounts', {}], ['fetchWanamiUsageCount', 0],
    ['fetchWanamiUsageHistory', []], ['fetchSuspensionMonthsMap', {}]]) {
    const f = await fixture({ fail: true });
    assert.deepEqual(await f.api[name](marker), expected);
    safe(f);
  }
});

test('metadata and empty source results preserve their existing contracts', async () => {
  const f = await fixture({ rows: [['2026-10-20T03:00:00Z', '12', '10']] });
  assert.deepEqual(await f.api.getLastSyncTime(marker), { lastSync: new Date('2026-10-20T03:00:00Z'), totalEvents: 12, validEvents: 10 });
  assert.equal(f.calls[0].params.spreadsheetId, marker);
  assert.equal(f.calls[0].params.range, '同期メタ情報!A2:C2');
  safe(f);
  const empty = await fixture();
  assert.equal(await empty.api.getLastSyncTime(marker), null);
  assert.deepEqual(await empty.api.fetchVQDiagnosisResults(4), { results: [], lastRow: 3 });
  await assert.rejects(() => empty.api.fetchStudentTextTypeMap(), { message: '[Sheets] fetchStudentTextTypeMap failed' });
  safe(empty);
});

test('lesson and tomorrow mapping keeps private payloads in return values only', async () => {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  const date = `${jst.getFullYear()}/${jst.getMonth() + 1}/${jst.getDate()} 10:00:00`;
  const row = [marker, marker, marker, marker, date, marker + 'レッスン', marker, marker, '', '10:00'];
  const f = await fixture({ rows: [row, [marker, '', marker]] });
  const lessons = await f.api.fetchLessonsFromSheet(marker);
  assert.equal(lessons.length, 1);
  assert.deepEqual(lessons[0], { calendar_event_id: marker, student_id: marker, tutor_name: marker, tutor_email: marker,
    lesson_date: date, lesson_date_raw: date, title: marker + 'レッスン', description: marker, meet_link: marker, lesson_time: '10:00' });
  assert.equal((await f.api.fetchLessonsForTomorrow())[0].tutor_name, marker + '-tutor');
  assert.equal(f.queries.length, 2);
  safe(f);
  const failed = await fixture({ rows: [row], queryFail: true });
  await assert.rejects(() => failed.api.fetchLessonsForTomorrow(), { message: '[Sheets] fetchLessonsForTomorrow failed' });
  safe(failed);
});

test('webhook, broadcast and student text mapping success data is preserved without logging it', async () => {
  const email = marker.toLowerCase();
  const f = await fixture({ rows: [[` ${email} `, marker, marker, '', marker, marker, marker, marker, marker, '', '', marker]],
    valueRanges: [{ values: [[marker]] }, { values: [['キャラ選択']] }] });
  assert.deepEqual(await f.api.fetchIndividualWebhooks(marker), { [email]: { webhook: marker, discordUserId: marker } });
  assert.deepEqual(await f.api.fetchTutorWebhooks(marker), { [email]: { webhook: marker, discordUserId: marker } });
  assert.deepEqual(await f.api.fetchStudentBroadcastInfo(), [{ studentId: email, discordId: marker, noticeWebhook: marker,
    tipsWebhook: marker, ankenWebhook: marker, chatUrl: marker }]);
  assert.deepEqual(await f.api.fetchStudentTextTypeMap(), new Map([[marker, '新']]));
  safe(f);
});

test('usage counts and history retain grouping and cache behavior', async () => {
  const row = Array(15).fill(''); row[0] = '2026-10-20T10:00:00Z'; row[14] = marker;
  const f = await fixture({ rows: [row, row, []] });
  assert.deepEqual(await f.api.fetchAllWanamiUsageCounts(2026, 10), { [marker]: 2 });
  assert.deepEqual(await f.api.fetchAllWanamiUsageCounts(2026, 10), { [marker]: 2 });
  assert.equal(f.calls.length, 1);
  assert.equal(await f.api.fetchWanamiUsageCount(marker, 2026, 10), 2);
  assert.deepEqual(await f.api.fetchWanamiUsageHistory(marker), [{ year: 2026, month: 10, count: 2 }]);
  safe(f);
});

test('diagnosis filtering, private details and update request contracts are preserved', async () => {
  const row = Array(21).fill('');
  Object.assign(row, { 0: '2026/10/20 12:00:00', 1: marker, 2: marker, 6: '1', 8: '2', 10: '3', 15: marker, 18: marker, 19: marker });
  const sent = [...row]; sent[17] = '完了';
  const incomplete = [...row]; incomplete[15] = '';
  const f = await fixture({ rows: [row, sent, incomplete, []] });
  const result = await f.api.fetchVQDiagnosisResults(2, 5);
  assert.equal(result.lastRow, 5);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].totalScore, 6);
  assert.equal(result.results[0].overview, marker);
  assert.equal(result.results[0].details, marker);
  assert.equal((await f.api.fetchVQDiagnosisResults(2, null, true)).results.length, 2);
  assert.equal((await f.api.fetchVQDiagnosisByStudentId(marker)).length, 2);
  await f.api.updateVQDiagnosisEmailStatus(7, marker);
  await f.api.batchUpdateVQDiagnosisEmailStatus([{ rowNumber: 8, value: marker }, { rowNumber: 9 }]);
  const update = f.calls.find(call => call.method === 'update').params;
  assert.equal(update.range, '診断結果!R7');
  assert.equal(update.valueInputOption, 'RAW');
  assert.deepEqual(update.requestBody.values, [[marker]]);
  const batch = f.calls.find(call => call.method === 'batchUpdate').params.requestBody;
  assert.deepEqual(batch, { valueInputOption: 'RAW', data: [{ range: '診断結果!R8', values: [[marker]] }, { range: '診断結果!R9', values: [['完了']] }] });
  safe(f);
});

test('schedule conversion and suspension date failures keep success and partial results private', async () => {
  const f = await fixture({ rows: [[marker, marker, marker, marker, '2026/10/20 12:00', '', marker, marker, marker, marker]] });
  const schedules = await f.api.fetchSchedulesFromSheet();
  assert.equal(schedules[0].start_time.toISOString(), '2026-10-20T03:00:00.000Z');
  assert.equal(schedules[0].account, marker);
  assert.equal(schedules[0].schedule_date, '2026/10/20');
  assert.equal(schedules[0].schedule_time, '12:00');
  safe(f);
  const suspension = await fixture({ rows: [[marker, marker, '', '', '2', '2026-10-01'], [marker, marker, '', '', '1', marker]] });
  const result = await suspension.api.fetchSuspensionData();
  assert.equal(result[0].suspensionEndDate, '2026-11-30');
  assert.equal(result[1].suspensionEndDate, null);
  assert.deepEqual(await suspension.api.fetchSuspensionMonthsMap(), { [marker]: 3 });
  safe(suspension);
});
