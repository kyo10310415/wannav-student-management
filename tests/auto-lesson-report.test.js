import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { createAutoLessonReportJob } from '../src/jobs/autoLessonReport.js';
import { validateAutoLessonAssessment } from '../src/services/autoLessonReportAI.js';
import { fetchAutoReportTranscript } from '../src/services/driveService.js';
import { formatLessonLabel, resolveLessonReference } from '../src/services/lessonReferenceService.js';
import { createAutoLessonReportSchemaInitializer } from '../src/services/autoLessonReportSchema.js';

const lesson = { student_id: 'S1', lesson_date: '2026-11-05', student_name: '生徒', tutor_name: '先生', calendar_event_id: 'event1' };
const transcript = '生徒: 配信の準備を進めてみました。\n先生: 今回はサムネイルの作り方を練習しましょう。\n生徒: デザインを少し変えてみました。\n' + '具体的な指導のやり取り。'.repeat(25);
const assessment = { lessonKey: null, evidence: { evaluator_version: 1 } };
function fixture({ source, assess = async () => assessment } = {}) {
  const reports = new Map(), calls = [], checks = new Map();
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('WITH single_days')) return { rows: [lesson] };
    if (sql.includes('FROM lesson_contents')) return { rows: [{ lesson_number: '1' }, { lesson_number: 'Pro_バズ_1' }] };
    if (sql.startsWith('INSERT INTO auto_lesson_report_state')) return { rows: [] };
    if (sql.startsWith('INSERT INTO auto_lesson_report_checks')) {
      const key = `${params[0]}:${params[1]}`, old = checks.get(key);
      if (old?.status === 'suppressed') return { rows: [] };
      checks.set(key, old || {}); return { rows: [{ source_hash: old?.source_hash }] };
    }
    if (sql.startsWith('UPDATE auto_lesson_report_checks')) { checks.set(`${params[0]}:${params[1]}`, { status: 'needs_review', source_hash: params[2] }); return { rows: [] }; }
    if (sql.includes('INSERT INTO lesson_reports')) {
      const key = `${params[0]}:${params[1]}`;
      if (sql.includes("'auto'")) {
        if (reports.has(key)) return { rows: [], rowCount: 0 };
        const report = { student_id: params[0], lesson_date: params[1], lesson_number: params[2], report_origin: 'auto', lesson_result: '実施済み' };
        reports.set(key, report); return { rows: [{ id: 1 }], rowCount: 1 };
      }
      assert.match(sql, /report_origin = 'manual'/);
      const report = { student_id: params[0], lesson_date: params[1], lesson_result: params[2], lesson_number: params[3], report_origin: 'manual' };
      reports.set(key, report); return { rows: [report] };
    }
    return { rows: [] };
  };
  const run = createAutoLessonReportJob({ db, ensure: async () => {}, enabled: () => true,
    fetch: async () => source === undefined ? { transcript, fileId: 'file', fileDate: lesson.lesson_date } : source, assess });
  return { run: () => run(new Date('2026-11-05T14:00:00Z')), db, reports, calls, checks };
}
let sequence = 0;
async function manualRoute(db) {
  const source = (await readFile(new URL('../src/routes/lessonReports.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = `autoManualRoute${sequence++}`;
  globalThis[key] = { query: db, Hono, formatLessonLabel, resolveLessonReference, ensureAutoLessonReportSchema: async () => {} };
  let routes;
  try { routes = (await import(`data:text/javascript;base64,${Buffer.from(`const {query,Hono,formatLessonLabel,resolveLessonReference,ensureAutoLessonReportSchema}=globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const app = new Hono(); app.use('*', async (c, next) => { c.set('authenticatedUser', { role: 'leader', email: 'synthetic@example.test' }); await next(); }); app.route('/', routes); return app;
}
const manualPost = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...lesson, lesson_result: '無断キャンセル', lesson_number: '2', report_origin: 'auto' }) };

test('automatic and real manual handlers converge to one manual report in either order', async () => {
  for (const autoFirst of [true, false]) {
    const f = fixture(), app = await manualRoute(f.db);
    if (autoFirst) await f.run();
    assert.equal((await app.request('/', manualPost)).status, 200);
    if (!autoFirst) await f.run();
    assert.equal(f.reports.size, 1);
    const report = [...f.reports.values()][0];
    assert.equal(report.report_origin, 'manual'); assert.equal(report.lesson_result, '無断キャンセル');
    assert.equal(report.lesson_number, '2');
  }
});
test('manual submission while AI is running wins without a duplicate', async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture({ assess: async () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const running = f.run(); await waiting;
  assert.deepEqual(await f.run(), { busy: true });
  const app = await manualRoute(f.db); await app.request('/', manualPost); release(assessment);
  assert.equal((await running).reported, 0); assert.equal(f.reports.size, 1);
  assert.equal([...f.reports.values()][0].report_origin, 'manual');
});
test('no/mismatched/short source and rejected AI remain unreported; unchanged rejected input is not charged again', async () => {
  for (const source of [null, { fileDate: '2026-11-04', transcript }, { fileDate: lesson.lesson_date, transcript: 'short' }]) {
    let evaluated = 0; const f = fixture({ source, assess: async () => { evaluated++; return assessment; } });
    assert.equal((await f.run()).reported, 0); assert.equal(evaluated, 0);
  }
  let evaluated = 0; const f = fixture({ assess: async () => { evaluated++; return null; } });
  await f.run(); await f.run(); assert.equal(evaluated, 1); assert.equal(f.reports.size, 0);
});
test('candidate query requires a single reservation/day and end grace; insert never updates an existing report', async () => {
  const f = fixture(); await f.run();
  const sql = f.calls.find(call => call.sql.includes('WITH single_days')).sql;
  assert.match(sql, /HAVING COUNT\(\*\)=1/); assert.match(sql, /INTERVAL '2 hours'/);
  assert.match(sql, /start_date/); assert.match(sql, /LIMIT 50/);
  const insert = f.calls.find(call => call.sql.includes('INSERT INTO lesson_reports'));
  assert.match(insert.sql, /ON CONFLICT \(student_id,lesson_date\) DO NOTHING/);
  assert.equal(insert.params[2], '未確認');
});
test('AI confirmation requires actual citations and distinct speakers; unknown/next lesson keys remain unconfirmed', () => {
  const value = { completed: true, confidence: 'high', student_speaker: '生徒', tutor_speaker: '先生',
    student_quote: '配信の準備を進めてみました。', tutor_quote: '今回はサムネイルの作り方を練習しましょう。', lesson_quote: 'デザインを少し変えてみました。', lesson_key: null };
  assert.equal(validateAutoLessonAssessment(value, transcript, ['1']).lessonKey, null);
  assert.equal(validateAutoLessonAssessment({ ...value, confidence: 'low' }, transcript, []), null);
  assert.equal(validateAutoLessonAssessment({ ...value, student_quote: '存在しない引用を捏造する' }, transcript, []), null);
  assert.equal(validateAutoLessonAssessment({ ...value, tutor_speaker: '生徒' }, transcript, []), null);
  const extra = transcript + '\n次回は7回目のレッスンを行います。';
  assert.equal(validateAutoLessonAssessment({ ...value, lesson_key: '7', lesson_key_quote: '次回は7回目のレッスンを行います。' }, extra, ['7']).lessonKey, null);
});
test('strict Drive lookup never borrows previous day or summary-only docs and rejects duplicate source documents', async () => {
  for (const mode of ['valid', 'previous', 'duplicate', 'summary']) {
    const file = { id: 'file', name: `WannaV - ${mode === 'previous' ? '2026/11/04' : '2026/11/05'} 20:00 JST` };
    let listCount = 0;
    const drive = { files: { list: async () => ({ data: { files: ++listCount === 1 ? [{ id: 'folder', name: 'S1' }] : mode === 'duplicate' ? [file, { ...file, id: 'other' }] : [file] } }) } };
    const docs = { documents: { get: async () => ({ data: { tabs: [{ tabProperties: { title: mode === 'summary' ? '概要' : '文字起こし' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: transcript } }] } }] } } }] } }) } };
    const result = await fetchAutoReportTranscript('S1', '2026-11-05', { drive, docs });
    if (mode === 'valid') { assert.equal(result.fileDate, '2026-11-05'); assert.equal(result.transcript, transcript); }
    else assert.equal(result, null);
  }
});
test('explicit current normal/PRO numbers are accepted; mismatching numbers and unregistered keys are not guessed', () => {
  const value = { completed: true, confidence: 'high', student_speaker: '生徒', tutor_speaker: '先生',
    student_quote: '配信の準備を進めてみました。', tutor_quote: '今回はサムネイルの作り方を練習しましょう。', lesson_quote: 'デザインを少し変えてみました。' };
  const quote = '今回はバズの1番の教材を進めます。';
  assert.equal(validateAutoLessonAssessment({ ...value, lesson_key: 'Pro_バズ_1', lesson_key_quote: quote }, transcript + quote, ['Pro_バズ_1']).lessonKey, 'Pro_バズ_1');
  assert.equal(validateAutoLessonAssessment({ ...value, lesson_key: '7', lesson_key_quote: quote }, transcript + quote, ['7']).lessonKey, null);
  assert.equal(validateAutoLessonAssessment({ ...value, lesson_key: 'Pro_バズ_1', lesson_key_quote: quote }, transcript + quote, []).lessonKey, null);
});
test('disabled mode never touches DB or APIs; failure releases the run lock for the next attempt', async () => {
  const disabled = createAutoLessonReportJob({ enabled: () => false, db: async () => { throw new Error('Must not run'); } });
  assert.deepEqual(await disabled(), { disabled: true });
  let calls = 0;
  const run = createAutoLessonReportJob({ enabled: () => true, ensure: async () => { calls++; throw new Error('Synthetic initialization failure'); } });
  await assert.rejects(run()); await assert.rejects(run()); assert.equal(calls, 2);
});
test('schema setup is shared and existing schemas skip DDL; no unrelated migrations run', async () => {
  const statements = [];
  const ensure = createAutoLessonReportSchemaInitializer(async sql => { statements.push(sql); return { rows: [{ ready: false }] }; });
  await Promise.all([ensure(), ensure()]); await ensure(); assert.equal(statements.length, 2);
  assert.match(statements[1], /report_origin TEXT NOT NULL DEFAULT 'manual'/);
  assert.doesNotMatch(statements[1], /\b(?:DROP|DELETE|TRUNCATE|migration_history)\b/i);
  let reads = 0; const ready = createAutoLessonReportSchemaInitializer(async () => { reads++; return { rows: [{ ready: true }] }; });
  await ready(); await ready(); assert.equal(reads, 1);
});
