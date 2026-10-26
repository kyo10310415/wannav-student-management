import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_CACHE_PRIVATE';
const failure = () => Object.assign(new Error(marker), { config: { url: marker, headers: { Authorization: marker } }, response: { data: marker } });
let sequence = 0;
async function fixture({ rows = [], fail = false, clientFail = false } = {}) {
  const logs = [], calls = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-26T06:00:00Z'])); } }
  const get = async params => {
    calls.push(params); if (fail) throw failure();
    return { data: { values: rows, properties: { title: marker }, sheets: [{ properties: { title: marker, sheetId: 4, index: 0, gridProperties: { rowCount: 10, columnCount: 25 } } }] } };
  };
  const deps = { Date: FixedDate, getSheets: () => {
    if (clientFail) throw failure(); return { spreadsheets: { get, values: { get } } };
  }, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/services/cacheService.js', import.meta.url), 'utf8'))
    .replace("import { getSheets } from './sheetsService.js';", 'const { getSheets } = deps;');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'cachePrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, Date } = deps;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { api, logs, calls };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
const throwing = ['getSpreadsheetMetadata', 'fetchStudentsFromCache', 'fetchTutorsFromCache', 'fetchProgressFromCache',
  'fetchSatisfactionFromCache', 'fetchSurveyResponsesFromCache', 'fetchExtensionResultsFromCache'];
const fallback = [['fetchCurrentMonthSurveyResponses', new Set()], ['fetchMonthlyResponseHistory', new Map()],
  ['fetchLessonCompletionStatus', new Map()], ['fetchTutorSkillScores', new Map()], ['getCacheSyncTime', null]];

test('all rejecting operations replace provider and client errors with fixed exceptions', async () => {
  for (const options of [{ fail: true }, { clientFail: true }]) {
    for (const name of throwing) {
      const f = await fixture(options);
      await assert.rejects(() => f.api[name](marker), error => {
        assert.equal(error.message, `[Cache] ${name} failed`);
        assert.equal(error.config, undefined); assert.equal(error.cause, undefined);
        return true;
      });
      safe(f);
    }
  }
});

test('all fallback operations retain empty collections and null on upstream failures', async () => {
  for (const options of [{ fail: true }, { clientFail: true }]) {
    for (const [name, expected] of fallback) {
      const f = await fixture(options);
      assert.deepEqual(await f.api[name](marker), expected); safe(f);
    }
  }
});

test('student mappings retain all source columns and malformed JSON defaults without samples', async () => {
  const row = Array(25).fill(marker); row[11] = JSON.stringify({ last: marker + '-last', current: marker + '-current' });
  const malformed = [...row]; malformed[11] = marker;
  const f = await fixture({ rows: [row, malformed] });
  const students = await f.api.fetchStudentsFromCache(marker);
  assert.deepEqual(students[0], { notion_page_id: marker, student_id: marker, name: marker, status: marker, contract_plan: marker,
    character_name: marker, homeroom_tutor: marker, notion_url: marker, discord_url: marker, payment_status_last_month: marker,
    payment_status_current_month: marker, payment_year_month_last: marker + '-last', payment_year_month_current: marker + '-current',
    result_absence: marker, result_late: marker, result_mission: marker, result_payment: marker, result_active_listening: marker,
    result_understanding: marker, result_overall: marker, absence_count: marker, lesson_start_date: marker, suspension_months: marker,
    youtube_channel_id: marker, x_account_id: marker });
  assert.equal(students[1].payment_year_month_last, '');
  assert.equal(students[1].payment_year_month_current, '');
  assert.deepEqual(f.calls, [{ spreadsheetId: marker, range: '生徒データ!A2:Y' }]); safe(f);
  const empty = await fixture(); assert.deepEqual(await empty.api.fetchStudentsFromCache(marker), []); safe(empty);
});

test('tutor, progress and satisfaction contracts retain column mappings and Google ranges', async () => {
  const row = Array(12).fill(marker);
  const f = await fixture({ rows: [row] });
  assert.deepEqual(await f.api.fetchTutorsFromCache(marker), [{ notion_page_id: marker, employee_id: marker, name: marker,
    tutor_name: marker, email: marker.toLowerCase(), team: marker, notion_name: marker, job_type: marker, status: marker }]);
  assert.deepEqual(await f.api.fetchProgressFromCache(marker), { [marker]: marker });
  assert.deepEqual(await f.api.fetchSatisfactionFromCache(marker), [{ timestamp: marker, year_month: marker, student_name: marker,
    tutor_name: marker, satisfaction_score: marker, reason: marker, student_id: marker, empathy_score: marker, advice_score: marker,
    clarity_score: marker, approachability_score: marker, tutor_employee_id: marker }]);
  assert.deepEqual(f.calls.map(call => call.range), ['Tutorデータ!A2:I', 'レッスン進捗データ!A2:B', 'レッスン満足度データ!A2:L']); safe(f);
});

test('survey count, current month and history preserve normalization, duplicate and month rules', async () => {
  const id = ' ' + marker.toLowerCase().replaceAll('_', ' － ') + ' ';
  const normalized = marker.replaceAll('_', '-');
  const f = await fixture({ rows: [[marker, '2026/10', marker, marker, marker, marker, id],
    [marker, '2026/9', marker, marker, marker, marker, id], [marker, '2026/10', marker, marker, marker, marker, id], []] });
  assert.deepEqual(await f.api.fetchSurveyResponsesFromCache(marker), { [normalized]: 3 });
  assert.deepEqual(await f.api.fetchCurrentMonthSurveyResponses(marker), new Set([normalized]));
  assert.deepEqual(await f.api.fetchMonthlyResponseHistory(marker), new Map([[normalized, new Set(['2026/10', '2026/9'])]]));
  assert.ok(f.calls.every(call => call.spreadsheetId === marker && call.range === 'レッスン満足度データ!A2:G')); safe(f);
});

test('completion, extension and skill results retain filtering, duplicate overwrites and source columns', async () => {
  const completion = await fixture({ rows: [['2026/10/2 12:00', '', '', '', '', marker, '', '', '実施済み'],
    ['2026/10/2 15:00', '', '', '', '', marker, '', '', ''], [marker, '', '', '', '', marker]] });
  assert.deepEqual(await completion.api.fetchLessonCompletionStatus(marker), new Map([[marker + '_2026-10-02',
    { completed: false, lessonResult: '未記入', timestamp: '2026/10/2 15:00' }]]));
  assert.equal(completion.calls[0].range, '24_12_30_フォームの回答 2!A2:I'); safe(completion);
  const row = Array(23).fill(''); row[1] = marker.toLowerCase(); row[22] = marker;
  const extension = await fixture({ rows: [row, ['', marker + '-EMPTY']] });
  assert.deepEqual(await extension.api.fetchExtensionResultsFromCache(marker), { [marker]: marker, [marker + '-EMPTY']: null });
  assert.equal(extension.calls[0].range, '生徒データ!A2:W'); safe(extension);
  const score = Array(36).fill(''); score[4] = marker; score[6] = '10'; score[7] = 'invalid'; score[35] = '2.5';
  const skills = await fixture({ rows: [score, []] });
  assert.deepEqual(await skills.api.fetchTutorSkillScores(marker), new Map([[marker, 12.5]]));
  assert.equal(skills.calls[0].range, 'A2:AJ'); safe(skills);
});

test('metadata and sync timestamp keep successful return contracts and empty sync fallback', async () => {
  const f = await fixture({ rows: [['', marker]] });
  assert.deepEqual(await f.api.getSpreadsheetMetadata(marker), { title: marker,
    sheets: [{ title: marker, sheetId: 4, index: 0, gridProperties: { rowCount: 10, columnCount: 25 } }] });
  assert.deepEqual(await f.api.getCacheSyncTime(marker), { lastSync: marker });
  assert.deepEqual(f.calls, [{ spreadsheetId: marker }, { spreadsheetId: marker, range: 'データ同期メタ情報!A2:B2' }]); safe(f);
  const empty = await fixture(); assert.equal(await empty.api.getCacheSyncTime(marker), null); safe(empty);
});
