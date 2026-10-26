import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_TUTOR_EXPORT_PRIVATE';
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, config: { credentials: marker } });
let sequence = 0;
async function fixture({ sourceFail = false, dbFail = false, dbWriteFail = false, completionFail = false, credentials = '{}', googleFail,
  missingMonth = false, duplicate = false, empty = false } = {}) {
  const logs = [], queries = [], requests = [], completions = [], metricsCalls = [];
  let sheetTitles = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-27T06:00:00Z'])); }
    getFullYear() { return this.getUTCFullYear(); } getMonth() { return this.getUTCMonth(); } getDate() { return this.getUTCDate(); }
    getTimezoneOffset() { return 0; }
  }
  const metric = { denominator: 2, satisfactionCount: 1, satisfactionValue: 90, collectionRate: 50, satisfactionScore: 45 };
  const invoke = async (method, params) => {
    requests.push({ method, params }); if (googleFail === method) throw failure();
    if (method === 'metadata') return { data: { sheets: duplicate ? sheetTitles.map(title => ({ properties: { title, sheetId: 1 } })) : [] } };
    if (method === 'batch') return { data: { replies: [{ addSheet: { properties: { sheetId: 1 } } }] } };
    if (method === 'read') return { data: { values: [['Tutor名', '項目', '2026/10', '10/27']] } };
    return { data: {} };
  };
  const deps = { Date: FixedDate, process: { env: { GOOGLE_CACHE_SHEET_ID: marker, GOOGLE_CREDENTIALS_JSON: credentials, TUTOR_SATISFACTION_SHEET_ID: marker } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (...args) => {
      queries.push(args); if (dbFail || (dbWriteFail && args[0].includes('INSERT INTO'))) throw failure();
      return { rows: args[0].includes('FROM tutors') ? [{ notion_name: marker, tutor_name: marker, employee_id: marker }] : [{ student_id: marker }] };
    },
    fetchSatisfactionFromCache: async () => { if (sourceFail) throw failure(); return empty ? [] : [{ student_id: marker }]; },
    getCompletedStudentIdsForMonth: async month => { completions.push(month); if (completionFail) throw failure(); return { completedStudentIds: [marker] }; },
    aggregateSatisfactionByTutorMonth: rows => rows,
    getTutorSatisfactionMonthData: () => missingMonth ? null : { average: 9, count: 1 },
    calculateSatisfactionMetricVariants: args => { metricsCalls.push(args); return { legacy: metric, lessonAdjusted: { ...metric, denominator: 1, collectionRate: 100, satisfactionScore: 90 } }; },
    isLessonCompletionFilterActive: () => true,
    google: { auth: { GoogleAuth: class { async getClient() { if (googleFail === 'auth') throw failure(); return {}; } } },
      sheets: () => ({ spreadsheets: { get: params => invoke('metadata', params), batchUpdate: params => invoke('batch', params),
        values: { get: params => invoke('read', params), update: params => invoke('write', params) } } }) },
  };
  const key = 'tutorExportPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  const apis = [];
  try {
    for (const name of ['tutorSatisfactionExport.js', 'tutorWeeklySnapshot.js']) {
      const source = (await readFile(new URL('../src/jobs/' + name, import.meta.url), 'utf8'))
        .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
      assert.equal(/\bimport(?:\s|\()/.test(source), false);
      apis.push(await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process, Date } = deps;\n${source}`).toString('base64')}`));
    }
  } finally { delete globalThis[key]; }
  sheetTitles = [...Object.values(apis[0].MONTHLY_SATISFACTION_SHEET_NAMES), ...Object.values(apis[1].SNAPSHOT_SHEET_NAMES.weekly), ...Object.values(apis[1].SNAPSHOT_SHEET_NAMES.monthly)];
  return { monthly: apis[0].monthlyTutorSatisfactionExport, weekly: apis[1].weeklyTutorSnapshot, snapshot: apis[1].monthlyTutorSnapshot,
    logs, queries, requests, completions, metricsCalls, snapshotNames: apis[1].SNAPSHOT_SHEET_NAMES };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('top-level source and DB failures retain false returns with fixed private errors', async () => {
  for (const options of [{ sourceFail: true }, { dbFail: true }]) {
    for (const name of ['monthly', 'weekly', 'snapshot']) {
      const f = await fixture(options); assert.deepEqual(await f[name](), { success: false, error: name === 'monthly' ? 'Tutor satisfaction export failed' : 'Tutor snapshot export failed' }); safe(f);
    }
  }
});

test('Google authentication, metadata and write failures remain private in nested sheet results', async () => {
  for (const googleFail of ['auth', 'metadata', 'write']) {
    for (const name of ['monthly', 'weekly', 'snapshot']) {
      const f = await fixture({ googleFail }); const result = await f[name](); assert.equal(result.success, false);
      assert.equal(JSON.stringify(result).includes('credentials'), false);
      if (result.sheets) {
        const expected = name === 'monthly' ? 'Tutor satisfaction export failed' : 'Tutor snapshot export failed';
        assert.equal(result.sheets.legacy.error, expected); assert.equal(result.sheets.lessonAdjusted.error, expected);
      } else assert.equal(result.error, 'Tutor satisfaction export failed');
      safe(f);
    }
  }
});

test('monthly export preserves Google requests, row payloads, month and successful output links', async () => {
  const f = await fixture(); const result = await f.monthly(); assert.equal(result.success, true); assert.equal(result.month, '2026/10'); assert.equal(result.tutorCount, 1);
  assert.equal(result.spreadsheetUrl.includes(marker), true);
  const writes = f.requests.filter(call => call.method === 'write'); assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].params.resource.values, [['Tutor名', '項目', '2026/10'], [marker, 'レッスン満足度', '90.00'], ['', '全体回収率', '50.00'], ['', '全体満足度スコア', '45.00']]);
  assert.equal(writes[0].params.valueInputOption, 'USER_ENTERED'); assert.equal(writes[0].params.spreadsheetId, marker);
  assert.deepEqual(f.completions, ['2026-10']); safe(f);
});

test('weekly/monthly snapshots retain date, legacy/adjusted sheet output and weekly-only DB persistence', async () => {
  for (const name of ['weekly', 'snapshot']) {
    const f = await fixture(); const result = await f[name](); assert.equal(result.success, true); assert.equal(result.snapshotDate, '2026-10-27');
    const inserts = f.queries.filter(([sql]) => sql.includes('INSERT INTO tutor_weekly_snapshots'));
    assert.equal(inserts.length, name === 'weekly' ? 1 : 0);
    if (inserts.length) assert.deepEqual(inserts[0][1].slice(0, 3), ['2026-10-27', marker, '2026/10']);
    assert.equal(f.requests.filter(call => call.method === 'write').length, 2);
    const values = f.requests.find(call => call.method === 'write').params.resource.values;
    assert.equal(values[1][0], marker); assert.ok(values.some(row => row[0] === '全体')); safe(f);
  }
});

test('completion and per-tutor DB failures preserve skipped counts and legacy-only fallback', async () => {
  const f = await fixture({ completionFail: true }); const result = await f.weekly();
  assert.equal(result.success, false); assert.equal(result.savedCount, 0); assert.equal(result.skippedCount, 1);
  assert.equal(f.queries.some(([sql]) => sql.includes('INSERT INTO')), false); assert.equal(f.requests.filter(call => call.method === 'write').length, 1); safe(f);
  const monthly = await fixture({ completionFail: true }); const monthResult = await monthly.monthly(); assert.equal(monthResult.success, false);
  assert.equal(monthly.requests.filter(call => call.method === 'write').length, 1); safe(monthly);
  const db = await fixture({ dbWriteFail: true }); const dbResult = await db.weekly(); assert.equal(dbResult.savedCount, 0); assert.equal(dbResult.skippedCount, 1);
  assert.equal(dbResult.success, true); safe(db);
});

test('missing Tutor month and credential parsing keep existing empty/failure contracts without names or secrets', async () => {
  const missing = await fixture({ missingMonth: true }); const result = await missing.monthly(); assert.equal(result.success, true);
  assert.equal(missing.requests.find(call => call.method === 'write').params.resource.values[1][2], ''); safe(missing);
  for (const name of ['monthly', 'weekly', 'snapshot']) {
    const invalid = await fixture({ credentials: `{"private_key":"${marker}"` }); const response = await invalid[name](); assert.equal(response.success, false);
    assert.equal(invalid.requests.length, 0); safe(invalid);
  }
  const empty = await fixture({ empty: true }); assert.deepEqual(await empty.monthly(), { success: false, error: 'No satisfaction data' }); safe(empty);
});

test('existing export columns remain idempotent and do not perform duplicate Google writes', async () => {
  for (const name of ['monthly', 'weekly', 'snapshot']) {
    const f = await fixture({ duplicate: true }); const result = await f[name](); assert.equal(result.success, true);
    if (name === 'monthly') { assert.equal(result.sheets.legacy.skipped, true); assert.equal(result.sheets.lessonAdjusted.skipped, true); }
    assert.equal(f.requests.some(call => ['write', 'batch'].includes(call.method)), false); safe(f);
  }
});
