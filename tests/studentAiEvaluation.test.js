import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { loadEvaluationCases, validateCases } from '../scripts/lib/studentAiEvaluationFixtures.js';
import { evaluateCase, evaluateCases, createEvaluationDependencies } from '../scripts/lib/studentAiEvaluationPipeline.js';
import { scoreRetrieval, applyManualReview, MANUAL_RUBRIC_FIELDS, hashOutput } from '../scripts/lib/studentAiEvaluationScoring.js';
import { parseArguments, runCli } from '../scripts/evaluate-student-ai.js';

const cases = loadEvaluationCases();
const one = id => loadEvaluationCases([id])[0];
const quiet = { stdout: () => {}, stderr: () => {} };
const runId = 'unit-offline';

test('40 independently named Japanese cases have valid synthetic schema and inspectable source anchors', () => {
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map(item => item.input.question)).size, cases.length);
  assert.ok(new Set(cases.map(item => item.category)).size >= 12);
  for (const item of cases) {
    assert.ok(item.synthetic); assert.ok(/[ぁ-んァ-ヶ一-龠]/.test(item.input.question));
    assert.ok(item.gold.expected.reason); assert.ok(item.purpose); assert.ok(item.detects);
    for (const group of item.gold.requiredGroups) for (const clause of group.allOf) for (const ref of clause.anyOf) {
      const row = item.input.minutes.find(row => String(row.id) === ref.sourceId);
      assert.ok(Array.from(row[ref.field]).slice(ref.start, ref.end).join('').length > 0);
    }
  }
});
for (const [name, mutate] of Object.entries({
  'empty fixture': () => [],
  'duplicate case': values => { values.push(values[0]); },
  'missing reason': values => { delete values[0].gold.expected.reason; },
  'real data marker': values => { values[0].synthetic = false; },
  'wrong schema': values => { values[0].schemaVersion = 999; },
  'unknown input': values => { values[0].input.gold = {}; },
  'wrong length': values => { values[0].input.minutes[0].transcript_length = -1; },
  'unknown source': values => { values[0].gold.requiredGroups[0].allOf[0].anyOf[0].sourceId = '999'; },
  'invalid anchor': values => { values[0].gold.requiredGroups[0].allOf[0].anyOf[0].end = 9999; },
  'invalid group': values => { values[0].gold.requiredGroups[0].allOf = []; },
  'foreign gold': values => { values[0].gold.relevantSourceIds = ['999']; }
})) test('fixture validation rejects ' + name, () => {
  const values = loadEvaluationCases();
  assert.throws(() => validateCases(mutate(values) ?? values), /INVALID_EVALUATION_FIXTURE/);
});
for (const fixture of cases) test('offline pipeline: ' + fixture.caseId, async () => {
  const result = await evaluateCase(fixture, { runId });
  assert.equal(result.status, 'completed'); assert.equal(result.expectationMatched, true);
  assert.notEqual(result.mechanical.status, 'fail', result.mechanical.violations.join(','));
  assert.equal(result.mode, 'offline_mock'); assert.equal(result.semanticQuality, 'not_evaluated');
  assert.equal(result.semantic.status, 'pending');
  assert.equal(result.actualUsage, 'unknown');
  assert.equal(result.outputHash, hashOutput({ response: result.response, context: result.context }));
});
test('full evaluation judgments and aggregates are deterministic, without time or live model labels', async () => {
  const first = await evaluateCases(cases, { runId }), second = await evaluateCases(cases, { runId });
  assert.deepEqual(first, second);
  assert.equal(first.harnessChecks.expectedOutcomes, 40);
  assert.equal(first.aggregate.overall.expectedOutcomeMatchedCount, 40);
  assert.equal(first.aggregate.overall.manualReview.pending, 40);
  assert.equal(first.aggregate.overall.apiSuccessRate.denominator, 40);
  assert.ok(first.aggregate.overall.apiSuccessRate.value < 1);
  assert.equal(first.aggregate.actualUsage, 'unknown');
  assert.equal(first.aggregate.liveLatency, 'not_measured');
  assert.ok(!JSON.stringify(first).includes('gpt-4.1'));
});
test('fixture final count/character losses are visible at finalEvidence, not removed from gold', async () => {
  for (const id of ['final-excerpt-count-loss', 'final-character-loss']) {
    const result = await evaluateCase(one(id), { runId });
    assert.equal(result.retrieval.requiredRecall.value, 0);
    assert.equal(result.retrieval.groups.required[0].missingAt, 'finalEvidence');
    assert.ok(result.stages.selectedSources.includes('1'));
    assert.ok(result.context.coverage.omittedExcerptIds.length > 0);
    if (id.includes('count')) assert.equal(result.context.evidence.length, 12);
    else assert.equal(result.context.inputCharacters, 24000);
  }
});
test('sourceId alone cannot cover a later passage in the same long record', async () => {
  const fixture = one('final-excerpt-count-loss');
  const ref = fixture.gold.requiredGroups[0].allOf[0].anyOf[0];
  const score = scoreRetrieval(fixture.gold, { dbCandidates: ['1'], selectedSources: ['1'],
    finalEvidence: [{ sourceId: '1', field: ref.field, start: 0, end: 4000 }] });
  assert.equal(score.sourcePrecision.value, 1); assert.equal(score.requiredRecall.value, 0);
});
test('controlled old-only evidence and missing counterevidence both lose recall', async () => {
  const fixture = one('later-counterevidence');
  const result = await evaluateCase(fixture, { runId });
  const score = scoreRetrieval(fixture.gold, { ...result.stages,
    selectedSources: ['1'], finalEvidence: result.context.evidence.filter(part => part.sourceId === '1') });
  assert.equal(score.requiredRecall.value, 0.5);
  assert.equal(score.counterevidenceRecall.value, 0);
});
test('hierarchical selection executes multiple mock batches and preserves intermediate source', async () => {
  const result = await evaluateCase(one('hierarchical-many-records'), { runId });
  assert.ok(result.calls.selection > 5); assert.equal(result.retrieval.requiredRecall.value, 1);
  assert.ok(result.stages.dbCandidates.length > 24);
});
test('all four provider/DB dependencies are offline and gold never reaches provider prompts', async t => {
  let externalCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { externalCalls++; throw new Error('NETWORK_FORBIDDEN'); });
  t.mock.method(pg.Pool.prototype, 'query', () => { externalCalls++; throw new Error('DATABASE_FORBIDDEN'); });
  const fixture = one('current-issue');
  fixture.gold.expectedClaims.push('GOLD_ONLY_SENTINEL');
  fixture.gold.prohibitedAssertions.push('GOLD_ONLY_FORBIDDEN');
  const deps = createEvaluationDependencies(fixture.input, fixture.script);
  const { createStudentAiSelector } = await import('../src/services/studentAiSelectionService.js');
  const { createStudentAiContextService } = await import('../src/services/studentAiContextService.js');
  const { createStudentAiAnswerService } = await import('../src/services/studentAiAnswerService.js');
  const select = createStudentAiSelector({ client: deps.client, model: 'offline-scripted-mock' });
  const context = await createStudentAiContextService({ query: deps.query, select })(fixture.input);
  await createStudentAiAnswerService({ client: deps.client, model: 'offline-scripted-mock' })({ ...fixture.input, context });
  assert.ok(deps.trace.prompts.length >= 4);
  assert.ok(!JSON.stringify(deps.trace.prompts).includes('GOLD_ONLY'));
  assert.ok(!JSON.stringify(deps.trace.prompts).includes('requiredGroups'));
  await evaluateCases(cases, { runId });
  assert.equal(externalCalls, 0);
});
test('SQL fake enforces parameters and prevents B rows; service rejects deliberately contaminated detail rows', async () => {
  const fixture = one('similar-students-canary');
  const { query } = createEvaluationDependencies(fixture.input, fixture.script);
  await assert.rejects(query('SELECT * FROM minutes', []), /INVALID_FAKE_SQL/);
  await assert.rejects(query('SELECT * FROM minutes WHERE student_id = $1', ['SYN-B']), /INVALID_FAKE_SQL/);
  fixture.script.fault = 'cross_student_detail';
  fixture.gold.expected = { kind: 'expected_error', httpStatus: 500, reason: 'detail側の混入' };
  const result = await evaluateCase(fixture, { runId });
  assert.equal(result.response.httpStatus, 500); assert.equal(result.calls.selection, 0);
  assert.ok(!JSON.stringify(result.response).includes('CANARY'));
});
test('SQL fake preserves DESC id ordering when multiple lesson dates are null', async () => {
  const fixture = one('unknown-date');
  fixture.input.minutes.push({ ...fixture.input.minutes[0], id: 2, drive_file_id: 'synthetic-second' });
  const { query } = createEvaluationDependencies(fixture.input, fixture.script);
  const result = await query('SELECT id FROM minutes WHERE student_id = $1 ORDER BY lesson_date DESC NULLS LAST, id DESC LIMIT $2',
    [fixture.input.studentId, 10, 16000]);
  assert.deepEqual(result.rows.map(row => row.id), [2, 1]);
});
test('unauthenticated/expired/unknown role never start student selection or AI', async () => {
  for (const [auth, status] of [['none', 401], ['expired', 401], ['viewer', 403]]) {
    const fixture = one('unauthenticated'); fixture.script.auth = auth;
    const result = await evaluateCase(fixture, { runId });
    assert.equal(result.response.httpStatus, status);
    assert.deepEqual(result.stages.dbCandidates, []); assert.deepEqual(result.calls, { selection: 0, answer: 0 });
  }
});
test('three intentionally wrong semantic outputs still pass mechanics, but reviewed fail labels are supported', async () => {
  for (const id of ['valid-quote-reverse-conclusion', 'unrelated-valid-quote', 'proposal-presented-as-fact']) {
    const result = await evaluateCase(one(id), { runId });
    assert.equal(result.mechanical.status, 'pass');
    assert.equal(result.semantic.status, 'pending');
    const target = { runId, caseId: id, outputHash: result.outputHash };
    const review = { ...target, reviewer: 'synthetic-rubric-test', notes: 'Controlled bad example, not a live review.',
      ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, field === 'support' ? 'fail' : 'na'])) };
    assert.equal(applyManualReview(target, review).status, 'fail');
  }
});
test('manual review cannot be applied to another run or an edited output hash', async () => {
  const fixture = one('single-supported-fact');
  const result = await evaluateCase(fixture, { runId });
  const review = { runId, caseId: fixture.caseId, outputHash: result.outputHash, reviewer: 'synthetic-reviewer', notes: '',
    ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, 'pass'])) };
  assert.equal((await evaluateCase(fixture, { runId, manualReview: review })).semantic.status, 'pass');
  await assert.rejects(evaluateCase(fixture, { runId: 'other', manualReview: review }), /REVIEW_TARGET_MISMATCH/);
  await assert.rejects(evaluateCase(fixture, { runId, manualReview: { ...review, outputHash: 'bad' } }), /REVIEW_TARGET_MISMATCH/);
});
test('partial, crashed, empty evaluations cannot claim completion; raw errors are not persisted', async () => {
  const fixtures = cases.slice(0, 3), controller = new AbortController();
  const partial = await evaluateCases(fixtures, { runId, signal: controller.signal, onCase: () => controller.abort() });
  assert.equal(partial.status, 'partial'); assert.equal(partial.results.length, 3);
  assert.equal(partial.aggregate.overall.partial, 2);
  const failed = await evaluateCases(fixtures, { runId, runCase: () => { throw new Error('FAKE_SECRET_TECHNICAL'); } });
  assert.equal(failed.status, 'failed'); assert.equal(failed.aggregate.overall.failed, 3);
  assert.ok(!JSON.stringify(failed).includes('FAKE_SECRET'));
  await assert.rejects(evaluateCases([], { runId }), /INVALID_EVALUATION_FIXTURE/);
});
test('secret-like provider exceptions never reach logs or run outputs', async t => {
  const logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  const result = await evaluateCase(one('provider-secret-error'), { runId });
  assert.equal(result.response.httpStatus, 503);
  assert.ok(!JSON.stringify(result).includes('FAKE_SECRET')); assert.deepEqual(logs, []);
});
test('CLI rejects live/custom input paths and unknown arguments', () => {
  for (const args of [['--live'], ['--fixtures', '/production.json'], ['--input', 'data.json'],
    ['--out'], ['--run-id', '../escape'], ['--reviews', 'reviews.json'], ['--out', 'a', '--out', 'b']]) {
    assert.throws(() => parseArguments(args), /INVALID_OFFLINE_ARGUMENTS/);
  }
});
test('CLI writes fresh JSON/Markdown/review template and refuses run overwrite', async () => {
  const out = await mkdtemp(join(tmpdir(), 't050-cli-'));
  const args = ['--out', out, '--run-id', 'fresh', '--case', 'single-supported-fact'];
  assert.equal(await runCli(args, quiet), 0);
  const path = join(out, 'fresh/result.json'), bytes = await readFile(path, 'utf8'), result = JSON.parse(bytes);
  assert.equal(result.mode, 'offline_mock'); assert.equal(result.semanticQuality, 'not_evaluated');
  assert.ok(result.inputPath); assert.ok(result.outputPath); assert.match(result.gitSha, /^[a-f0-9]{40}$/);
  assert.match(await readFile(join(out, 'fresh/summary.md'), 'utf8'), /NOT semantic/);
  const template = JSON.parse(await readFile(join(out, 'fresh/manual-review-template.json'), 'utf8'));
  assert.equal(template[0].outputHash, result.results[0].outputHash);
  assert.ok(Object.values(template[0].ratings).every(value => value === null));
  assert.equal(await runCli(args, quiet), 1); assert.equal(await readFile(path, 'utf8'), bytes);
});
test('CLI review replay binds the same logical run and hash, rejecting mismatches', async () => {
  const out = await mkdtemp(join(tmpdir(), 't050-review-'));
  const fixture = one('single-supported-fact'), result = await evaluateCase(fixture, { runId: 'logical-run' });
  const review = { runId: 'logical-run', caseId: fixture.caseId, outputHash: result.outputHash, reviewer: 'synthetic-reviewer', notes: '',
    ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, 'pass'])) };
  const reviewPath = join(out, 'reviews.json'); await writeFile(reviewPath, JSON.stringify([review]));
  const args = ['--out', join(out, 'reviewed'), '--run-id', 'logical-run', '--case', fixture.caseId, '--reviews', reviewPath];
  assert.equal(await runCli(args, quiet), 0);
  assert.equal(await runCli(['--out', join(out, 'wrong'), '--run-id', 'other-run', '--case', fixture.caseId, '--reviews', reviewPath], quiet), 1);
});
test('CLI stores failed/partial states on interruption or technical failure and never emits a pass', async () => {
  const out = await mkdtemp(join(tmpdir(), 't050-failed-'));
  assert.equal(await runCli(['--out', out, '--run-id', 'crash'], {
    ...quiet, evaluate: () => { throw new Error('FAKE_SECRET_CRASH'); }
  }), 1);
  const failure = await readFile(join(out, 'crash/result.json'), 'utf8');
  assert.equal(JSON.parse(failure).status, 'failed'); assert.ok(!failure.includes('FAKE_SECRET'));
  assert.equal(await runCli(['--out', out, '--run-id', 'empty'], { ...quiet, evaluate: () => ({ status: 'completed', results: [] }) }), 1);
  const controller = new AbortController(); controller.abort();
  assert.equal(await runCli(['--out', out, '--run-id', 'cancelled'], { ...quiet, signal: controller.signal }), 1);
  assert.equal(JSON.parse(await readFile(join(out, 'cancelled/result.json'), 'utf8')).status, 'partial');
});
test('standalone CLI works offline even with production-looking credentials in environment', async () => {
  const out = await mkdtemp(join(tmpdir(), 't050-env-'));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['scripts/evaluate-student-ai.js',
    '--out', out, '--run-id', 'offline-env', '--case', 'single-supported-fact'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env,
      DATABASE_URL: 'postgres://invalid.example/FAKE_SECRET', OPENAI_API_KEY: 'FAKE_SECRET_KEY', STUDENT_AI_ENABLED: 'true' }
  });
  assert.match(stdout, /offline_mock/); assert.ok(!stdout.includes('FAKE_SECRET')); assert.equal(stderr, '');
});
