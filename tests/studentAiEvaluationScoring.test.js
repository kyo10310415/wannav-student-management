import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRetrieval, scoreMechanical, applyManualReview, aggregateEvaluation, hashOutput, stableStringify,
  MANUAL_RUBRIC_FIELDS } from '../scripts/lib/studentAiEvaluationScoring.js';

const group = (groupId, ...clauses) => ({ groupId, allOf: clauses.map(anyOf => ({ anyOf })) });
const ref = sourceId => ({ sourceId });
const gold = { requiredGroups: [group('alternative', [ref('1'), ref('2')]), group('both', [ref('1')], [ref('3')])],
  relevantSourceIds: ['1', '2', '3'], counterevidenceGroups: [group('later', [ref('3')])], comparisonGroups: [group('before-after', [ref('1')], [ref('3')])] };
test('retrieval hand calculation distinguishes OR, AND, and unique source precision', () => {
  const score = scoreRetrieval(gold, { dbCandidates: ['1', '2', '3', '4'], selectedSources: ['1', '4'],
    finalEvidence: [{ sourceId: '1' }, { sourceId: '1' }, { sourceId: '4' }] });
  assert.deepEqual(score.requiredRecall, { numerator: 1, denominator: 2, value: 0.5 });
  assert.equal(score.sourcePrecision.value, 0.5);
  assert.equal(score.comparisonRecall.value, 0);
  assert.equal(score.counterevidenceRecall.value, 0);
  assert.equal(score.groups.required[1].missingAt, 'selectedSources');
});
test('retrieval position coverage cannot be replaced by source identity', () => {
  const positional = { requiredGroups: [group('span', [{ sourceId: '1', field: 'transcript', start: 5, end: 10 }])], relevantSourceIds: ['1'] };
  for (const part of [{ sourceId: '1', field: 'transcript', start: 0, end: 9 }, { sourceId: '1', field: 'generated_text', start: 0, end: 20 }]) {
    const score = scoreRetrieval(positional, { dbCandidates: ['1'], selectedSources: ['1'], finalEvidence: [part] });
    assert.equal(score.requiredRecall.value, 0);
    assert.equal(score.groups.required[0].missingAt, 'finalEvidence');
  }
  assert.equal(scoreRetrieval(positional, { finalEvidence: [{ sourceId: '1', field: 'transcript', start: 5, end: 10 }] }).requiredRecall.value, 1);
});
test('empty gold is NA, missing required evidence is zero, and candidate loss is visible', () => {
  assert.equal(scoreRetrieval({}, {}).requiredRecall.value, null);
  assert.equal(scoreRetrieval({}, {}).sourcePrecision.value, null);
  const score = scoreRetrieval(gold, {});
  assert.equal(score.requiredRecall.value, 0);
  assert.equal(score.groups.required[0].missingAt, 'dbCandidates');
});

function valid() {
  const record = { id: 'excerpt:1:0', sourceId: '1', text: '練習回数は増えた。', field: 'transcript', start: 0, end: Array.from('練習回数は増えた。').length,
    lessonDate: '2026-08-01', version: 'v1', sourceKind: 'stored_transcript_unverified', driveFileId: 'synthetic_1' };
  const context = { studentId: 'A', evidence: [record], coverage: { scope: 'stored_minutes_only' } };
  const { id: evidenceId, text: ignored, driveFileId: ignoredDrive, ...metadata } = record;
  return { studentId: 'A', context, prompts: [{ role: 'user', content: '架空質問' }], forbiddenCanaries: ['B_ONLY_CANARY'],
    minutes: [{ id: 1, student_id: 'A', transcript: record.text, lesson_date: record.lessonDate, version: 'v1', drive_file_id: 'synthetic_1' }],
    response: { httpStatus: 200, body: { success: true, data: { status: 'answered', answer: '練習回数が増えました。',
      confidence: 'medium', evidence: [{ evidenceId, statement: '増加した。', quote: record.text, ...metadata }], changes: [], recommendedActions: [],
      sources: [{ sourceId: '1', lessonDate: record.lessonDate, version: 'v1', driveUrl: 'https://drive.google.com/file/d/synthetic_1/view', evidenceIds: [evidenceId] }],
      coverage: { ...context.coverage, answerEvidenceIds: [evidenceId], answerSourceIds: ['1'], answerUsesExcerptsOnly: true }, usage: {} } } } };
}
test('correct controlled answer passes independent mechanics', () => assert.equal(scoreMechanical(valid()).status, 'pass'));
for (const [name, code, mutate] of [
  ['wrong quote', 'QUOTE_MISMATCH', input => { input.response.body.data.evidence[0].quote = '増えていない。'; }],
  ['unknown ID', 'EVIDENCE_ID', input => { input.response.body.data.evidence[0].evidenceId = 'invented'; }],
  ['wrong student', 'CONTEXT_STUDENT_SCOPE', input => { input.context.studentId = 'B'; }],
  ['foreign owner', 'SOURCE_OWNERSHIP', input => { input.minutes[0].student_id = 'B'; }],
  ['forged original', 'CONTEXT_ORIGINAL_MISMATCH', input => { input.context.evidence[0].text = '偽の原文'; }],
  ['forged date', 'EVIDENCE_METADATA', input => { input.response.body.data.evidence[0].lessonDate = '2026-09-01'; }],
  ['duplicate source', 'SOURCES_METADATA_OR_DEDUPLICATION', input => { input.response.body.data.sources.push(input.response.body.data.sources[0]); }],
  ['forged URL', 'SOURCES_METADATA_OR_DEDUPLICATION', input => { input.response.body.data.sources[0].driveUrl = 'https://evil.invalid'; }],
  ['unsupported change', 'CHANGE_TIMEPOINTS', input => { input.response.body.data.changes.push({ description: '成長', evidenceIds: ['excerpt:1:0'] }); }],
  ['unsupported action', 'ACTION_REFERENCES', input => { input.response.body.data.recommendedActions.push({ action: '練習', reason: '提案', evidenceIds: ['fake'] }); }],
  ['canary answer', 'CANARY_RESPONSE', input => { input.response.body.data.answer = 'B_ONLY_CANARY'; }],
  ['canary prompt', 'CANARY_PROMPTS', input => { input.prompts[0].content = 'B_ONLY_CANARY'; }],
  ['forged coverage', 'COVERAGE_METADATA', input => { input.response.body.data.coverage.scope = 'all'; }],
  ['unknown JSON key', 'ANSWER_FORMAT', input => { input.response.body.data.studentName = 'fabricated'; }]
]) test(`controlled bad mechanics: ${name}`, () => {
  const input = valid(); mutate(input);
  const result = scoreMechanical(input);
  assert.equal(result.status, 'fail'); assert.ok(result.violations.includes(code), JSON.stringify(result));
});
test('safe error is citation NA, but canaries are checked even on errors', () => {
  const input = { studentId: 'A', context: null, response: { httpStatus: 502, body: { success: false, error: '形式拒否' } }, forbiddenCanaries: ['CANARY'] };
  assert.equal(scoreMechanical(input).status, 'not_applicable');
  input.response.body.error = 'CANARY'; assert.equal(scoreMechanical(input).status, 'fail');
});
test('malformed nested JSON is rejected without crashing the scorer', () => {
  for (const field of ['evidence', 'changes', 'recommendedActions']) {
    const input = valid(); input.response.body.data[field] = [null];
    assert.equal(scoreMechanical(input).status, 'fail');
  }
  const input = valid(); input.context.evidence[0].end += 1;
  assert.ok(scoreMechanical(input).violations.includes('CONTEXT_ORIGINAL_MISMATCH'));
});
test('invalid context evidence collections return fixed failures', () => {
  for (const evidence of [null, undefined, {}, 'not-an-array', 42]) {
    const input = valid(); input.context.evidence = evidence;
    const result = scoreMechanical(input);
    assert.equal(result.status, 'fail'); assert.ok(result.violations.includes('CONTEXT_FORMAT'));
  }
});
test('source kind is independently checked against the source field', () => {
  const input = valid(); input.context.evidence[0].sourceKind = 'summary';
  input.response.body.data.evidence[0].sourceKind = 'summary';
  assert.ok(scoreMechanical(input).violations.includes('CONTEXT_SOURCE_KIND'));
});
test('correct quote with reversed conclusion passes mechanics but manual rubric can fail', () => {
  const input = valid(); input.response.body.data.answer = '練習回数は減りました。';
  assert.equal(scoreMechanical(input).status, 'pass');
  const target = { runId: 'run', caseId: 'reverse', outputHash: hashOutput(input.response) };
  const review = { ...target, reviewer: 'fixture reviewer', notes: '引用は増加、主張は減少。',
    ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, field === 'support' ? 'fail' : 'na'])) };
  assert.equal(applyManualReview(target, review).status, 'fail');
  assert.equal(applyManualReview(target, review).semanticQuality, 'not_evaluated');
});
test('manual review requires all rubric fields and cannot be reused for other run/case/output', () => {
  const target = { runId: 'one', caseId: 'case', outputHash: hashOutput({ answer: 'a' }) };
  const review = { ...target, reviewer: 'human', notes: '', ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, 'pass'])) };
  assert.equal(applyManualReview(target).status, 'pending');
  assert.equal(applyManualReview(target, review).status, 'pass');
  assert.throws(() => applyManualReview(target, { ...review, schemaVersion: '1' }), /INVALID_MANUAL_REVIEW/);
  assert.throws(() => applyManualReview(target, { ...review, notes: 'a'.repeat(4001) }), /INVALID_MANUAL_REVIEW/);
  assert.equal(applyManualReview(target, { ...review, notes: 'あ'.repeat(4000) }).status, 'pass');
  for (const key of ['runId', 'caseId', 'outputHash']) assert.throws(() => applyManualReview({ ...target, [key]: 'changed' }, review), /^Error: REVIEW_TARGET_MISMATCH$/);
  for (const field of MANUAL_RUBRIC_FIELDS) {
    const bad = structuredClone(review); delete bad.ratings[field];
    assert.throws(() => applyManualReview(target, bad), /^Error: INVALID_MANUAL_REVIEW$/);
  }
  review.ratings = Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, 'na']));
  assert.equal(applyManualReview(target, review).status, 'not_applicable');
  review.ratings.support = 'unknown'; assert.throws(() => applyManualReview(target, review), /INVALID_MANUAL_REVIEW/);
});
test('canonical hash binds exact output, independent of object key order', () => {
  assert.equal(stableStringify({ b: 2, a: { z: 3, y: 1 } }), '{"a":{"y":1,"z":3},"b":2}');
  assert.equal(hashOutput({ b: 2, a: 1 }), hashOutput({ a: 1, b: 2 }));
  assert.notEqual(hashOutput({ a: '原文' }), hashOutput({ a: '原文 ' }));
});
test('aggregation hand calculation separates macro/micro and retains failures and NA', () => {
  const results = [
    { category: 'retrieval', status: 'completed', retrieval: scoreRetrieval({ requiredGroups: [group('one', [ref('1')])] }, { finalEvidence: [{ sourceId: '1' }] }), calls: { selection: 2, answer: 1 }, expectationMatched: true },
    { category: 'retrieval', status: 'failed', retrieval: scoreRetrieval(gold, {}), response: { httpStatus: 504 } },
    { category: 'empty', status: 'completed', retrieval: scoreRetrieval({}, {}), response: { httpStatus: 502 } },
    { category: 'limit', status: 'partial', response: { httpStatus: 422 } }
  ];
  const result = aggregateEvaluation(results), metric = result.overall.retrieval.requiredRecall;
  assert.equal(metric.macro, 0.5); assert.equal(metric.micro.value, 1 / 3);
  assert.equal(metric.notApplicable, 1); assert.equal(metric.notEvaluated, 1);
  assert.equal(result.overall.cases, 4); assert.equal(result.overall.failed, 1);
  assert.equal(result.overall.timeoutRate.value, 0.25); assert.equal(result.overall.inputLimitRate.value, 0.25);
  assert.equal(result.overall.formatRefusalRate.value, 0.25); assert.equal(result.overall.completionRate.value, 0.5);
  assert.equal(result.overall.apiSuccessRate.value, 0); assert.equal(result.overall.unknownResponseCount, 1);
  assert.equal(result.overall.expectedOutcomeMatchedCount, 1);
  assert.equal(result.categories.retrieval.cases, 2); assert.equal(result.status, 'partial');
  assert.equal(result.semanticQuality, 'not_evaluated'); assert.equal(result.actualUsage, 'unknown');
  assert.equal(result.liveLatency, 'not_measured'); assert.equal(result.liveCost, 'not_measured');
  assert.equal(aggregateEvaluation([]).status, 'failed');
  assert.equal(aggregateEvaluation([{ category: 'x', status: 'failed' }]).status, 'failed');
});
test('API failures remain visible when every harness case completes', () => {
  const result = aggregateEvaluation([200, 502, 504].map(httpStatus => ({ category: 'api', status: 'completed', response: { httpStatus } })));
  assert.equal(result.overall.completionRate.value, 1);
  assert.equal(result.overall.apiSuccessRate.value, 1 / 3);
  assert.equal(result.overall.unknownResponseCount, 0);
  assert.equal(result.overall.expectedOutcomeMatchedCount, 0);
});
