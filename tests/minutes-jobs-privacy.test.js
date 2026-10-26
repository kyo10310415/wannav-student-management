import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { buildLessonContentIndex, getLessonContent, resolveLessonReference } from '../src/services/lessonReferenceService.js';
const marker = 'SYNTHETIC_MINUTES_JOB_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, credentials: marker }, detail: marker });
let sequence = 0;
async function load(file, deps) {
  const source = (await readFile(new URL('../src/jobs/' + file, import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'minutesJobsPrivacyFixture' + sequence++; globalThis[key] = deps;
  try { return await import(`data:text/javascript;base64,${Buffer.from(`const { ${Object.keys(deps).join(', ')} } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
}
const candidate = (i = 0) => ({ student_id: marker + i, student_name: marker, lesson_date: '2026-10-26', lesson_number: 3 });
async function autoFixture({ candidates = [candidate()], existing = [], fail, missingTranscript = false, qualityPending = false, queryOverride } = {}) {
  const logs = [], queries = [], builds = [], evaluations = [], transcripts = [], contexts = [];
  const errorAt = stage => { if (fail === stage) throw rawError(); };
  const deps = { buildLessonContentIndex, getLessonContent, resolveLessonReference,
    query: async (sql, params) => {
      queries.push({ sql, params }); if (queryOverride) return queryOverride(sql, params);
      if (sql.includes('SELECT DISTINCT')) { errorAt('candidates'); return { rows: candidates }; }
      if (sql.includes('SELECT id, student_id')) { errorAt('existing'); return { rows: existing }; }
      if (sql.includes('FROM minutes_templates')) { errorAt('template'); return { rows: [{ id: 1, template_text: marker }] }; }
      if (sql.includes('FROM lesson_contents')) { errorAt('contents'); return { rows: [{ lesson_number: 3, title: 'today', content: marker }, { lesson_number: 4, title: 'next', content: marker }] }; }
      errorAt('write'); return { rows: [] };
    }, fetchTranscript: async (...args) => { transcripts.push(args); errorAt('transcript'); return missingTranscript ? null : { transcript: marker, fileId: marker, fileName: marker }; },
    buildMinutesResult: async input => { builds.push(input); errorAt('build'); return { generatedText: marker, qualityEvaluation: qualityPending ? null : { verified: true }, qualityEvaluationError: qualityPending ? rawError() : null }; },
    evaluateLessonQuality: async (...args) => { evaluations.push(args); errorAt('evaluate'); return { verified: true }; },
    isVerifiedMinutesQualityEvaluation: value => Boolean(value?.verified),
    getPreviousMinutesContext: async (...args) => { contexts.push(args); errorAt('context'); return { generated_text: marker }; },
    resolveMinutesTutor: async () => ({ tutorName: marker, tutorEmployeeId: marker }),
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  return { module: await load('minutesAutoGenerate.js', deps), logs, queries, builds, evaluations, transcripts, contexts };
}
const options = { startDate: '2026-10-01', endDate: '2026-10-26', runType: 'backfill' };
const safe = value => assert.equal(inspect(value).includes(marker), false);

test('new generation preserves AI input, SQL parameters, summary and progress without identifying logs', async () => {
  for (const qualityPending of [false, true]) {
    const f = await autoFixture({ qualityPending }); const progress = [];
    const result = await f.module.minutesAutoGenerate({ ...options, onProgress: value => progress.push(value) });
    assert.deepEqual(result, { success: true, candidates: 1, targets: 1, processed: 1, generated: 1, qualityUpdated: 0, qualityPending: qualityPending ? 1 : 0, skipped: 0, errors: 0 });
    assert.deepEqual(f.queries[0].params, [options.startDate, options.endDate]);
    assert.equal(f.builds[0].studentId, marker + '0'); assert.equal(f.builds[0].templateText, marker);
    assert.equal(f.builds[0].todayContent, 'today\n' + marker); assert.equal(f.builds[0].nextContent, 'next\n' + marker);
    assert.deepEqual(f.queries.at(-1).params, [marker + '0', marker, '2026-10-26', '3', marker, marker, marker, marker, 1, marker, marker, qualityPending ? null : '{"verified":true}']);
    assert.equal(progress[0].processed, 1); assert.equal(progress[0].qualityPending, qualityPending ? 1 : 0);
    assert.equal(f.module.getMinutesAutoGenerateStatus(), null); safe(f.logs);
  }
});

test('initial database errors are fixed and always release the run lock', async () => {
  for (const fail of ['candidates', 'existing']) {
    const f = await autoFixture({ fail });
    await assert.rejects(() => f.module.minutesAutoGenerate(options), error => { safe(error); return error.message === 'Minutes generation job failed'; });
    assert.equal(f.module.getMinutesAutoGenerateStatus(), null); safe(f.logs);
  }
});

test('template and master fallbacks remain successful while per-target failures preserve progress and continue', async () => {
  for (const fail of ['template', 'contents', 'transcript', 'build', 'context', 'write']) {
    const f = await autoFixture({ fail, candidates: [candidate(), candidate(1)] }); const progress = [];
    const result = await f.module.minutesAutoGenerate({ ...options, onProgress: value => progress.push(value) });
    assert.equal(result.errors, ['template', 'contents'].includes(fail) ? 0 : 2);
    assert.equal(result.generated, ['template', 'contents'].includes(fail) ? 2 : 0);
    assert.equal(progress.length, 2); assert.equal(progress[1].processed, 2); safe(f.logs);
  }
});

test('legacy re-evaluation keeps existing text, targets at most 20 and preserves stored transcript reuse', async () => {
  const candidates = Array.from({ length: 25 }, (_, i) => candidate(i));
  const existing = candidates.map((c, i) => ({ ...c, id: i + 1, transcript: marker, quality_evaluation: {} }));
  const f = await autoFixture({ candidates, existing });
  const summary = await f.module.minutesAutoGenerate(options);
  assert.equal(summary.targets, 20); assert.equal(summary.qualityUpdated, 20); assert.equal(summary.generated, 0);
  assert.equal(f.builds.length, 0); assert.equal(f.transcripts.length, 0); assert.equal(f.evaluations.length, 20);
  const updates = f.queries.filter(q => q.sql.includes('UPDATE minutes'));
  assert.equal(updates.length, 20); assert.deepEqual(updates[0].params, ['{"verified":true}', 1]);
  assert.equal(updates.some(q => q.sql.includes('generated_text')), false); safe(f.logs);
});

test('no candidates, verified records, disabled legacy, unresolved lesson and missing transcript retain skips', async () => {
  const empty = await autoFixture({ candidates: [] }); assert.equal((await empty.module.minutesAutoGenerate(options)).targets, 0);
  const row = { ...candidate(), id: 1, transcript: marker, quality_evaluation: { verified: true } };
  const verified = await autoFixture({ existing: [row] }); assert.equal((await verified.module.minutesAutoGenerate(options)).targets, 0);
  const legacy = await autoFixture({ existing: [{ ...row, quality_evaluation: {} }] });
  assert.equal((await legacy.module.minutesAutoGenerate({ ...options, includeLegacyQuality: false })).targets, 0);
  for (const params of [{ candidates: [{ ...candidate(), lesson_number: null }] }, { missingTranscript: true }, { existing: [{ ...row, transcript: '', quality_evaluation: {} }], missingTranscript: true }]) {
    const f = await autoFixture(params); const summary = await f.module.minutesAutoGenerate(options);
    assert.equal(summary.skipped, 1); assert.equal(summary.errors, 0); assert.equal(f.builds.length, 0); safe(f.logs);
  }
});

test('concurrent auto runs retain the existing busy contract and lock lifetime', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const f = await autoFixture({ queryOverride: async () => { await waiting; return { rows: [] }; } });
  const active = f.module.minutesAutoGenerate(options);
  const busy = await f.module.minutesAutoGenerate(options); assert.equal(busy.busy, true); assert.equal(busy.success, false);
  assert.equal(busy.error, '別の議事録生成処理が実行中です'); assert.equal(busy.activeRun.runType, 'backfill');
  release(); await active; assert.equal(f.module.getMinutesAutoGenerateStatus(), null); safe(f.logs);
});

async function backfillFixture(activeRun = null) {
  let resolve, reject; const task = new Promise((a, b) => { resolve = a; reject = b; });
  const logs = [], runs = [];
  const deps = { getMinutesAutoGenerateStatus: () => activeRun, minutesAutoGenerate: options => { runs.push(options); return task; },
    console: { error: (...args) => logs.push(inspect(args)) } };
  return { module: await load('minutesBackfill.js', deps), logs, runs, resolve, reject };
}
const settle = () => new Promise(setImmediate);

test('backfill retains start, busy, progress, completion and snapshot-copy contracts', async () => {
  const f = await backfillFixture(); const started = f.module.startMinutesBackfill(options);
  assert.equal(started.started, true); assert.equal(started.state.status, 'running'); assert.equal(f.runs[0].includeLegacyQuality, true);
  assert.equal(f.module.startMinutesBackfill(options).reason, 'backfill_running');
  const progress = { processed: 1, total: 2, generated: 1, qualityUpdated: 0, qualityPending: 0, skipped: 0, errors: 0 };
  f.runs[0].onProgress(progress); assert.deepEqual(f.module.getMinutesBackfillState().progress, progress);
  const copied = f.module.getMinutesBackfillState(); copied.progress.processed = 999;
  assert.equal(f.module.getMinutesBackfillState().progress.processed, 1);
  const summary = { success: true, processed: 2, targets: 2, generated: 2, qualityUpdated: 0, qualityPending: 0, skipped: 0, errors: 0 };
  f.resolve(summary); await settle(); const state = f.module.getMinutesBackfillState();
  assert.equal(state.status, 'completed'); assert.deepEqual(state.summary, summary); assert.equal(state.error, null); assert.equal(state.progress.processed, 2);
  const active = await backfillFixture({ runType: 'hourly' }); assert.equal(active.module.startMinutesBackfill(options).reason, 'generation_running'); assert.equal(active.runs.length, 0);
});

test('backfill rejected jobs and failed summaries conceal raw errors in logs and both state fields', async () => {
  for (const reject of [true, false]) {
    const f = await backfillFixture(); f.module.startMinutesBackfill(options);
    if (reject) f.reject(rawError()); else f.resolve({ success: false, busy: true, error: marker });
    await settle(); const state = f.module.getMinutesBackfillState();
    assert.equal(state.status, 'failed'); assert.equal(state.error, reject ? '議事録バックフィルに失敗しました' : 'バックフィルを開始できませんでした');
    safe(state); safe(f.logs);
    if (!reject) assert.equal(state.summary.busy, true);
  }
});
