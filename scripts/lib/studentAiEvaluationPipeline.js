import { Hono } from 'hono';
import { createStudentAiContextService } from '../../src/services/studentAiContextService.js';
import { createStudentAiSelector } from '../../src/services/studentAiSelectionService.js';
import { createStudentAiAnswerService } from '../../src/services/studentAiAnswerService.js';
import { createStudentAiRoutes } from '../../src/routes/studentAi.js';
import { validateCases, fixtureVersion, schemaVersion } from './studentAiEvaluationFixtures.js';
import { hashOutput, scoreRetrieval, scoreMechanical, applyManualReview, aggregateEvaluation } from './studentAiEvaluationScoring.js';

export const evaluatorVersion = '1.0.0';
const points = value => Array.from(value);
const clone = value => structuredClone(value);
const assert = condition => { if (!condition) throw new Error('INVALID_FAKE_SQL'); };
const sortRows = (a, b) => a.lesson_date === b.lesson_date ? b.id - a.id :
  a.lesson_date === null ? 1 : b.lesson_date === null ? -1 : b.lesson_date.localeCompare(a.lesson_date);

// This boundary accepts only source inputs and a scripted mock plan, not gold.
// Every SQL branch checks placeholders and reproduces filtering/ordering/limits.
export function createEvaluationDependencies(input, script) {
  const trace = { prompts: [], dbCandidates: [], selectedSources: [], dbRows: [], calls: { selection: 0, answer: 0 } };
  const query = async (sql, params) => {
    assert(typeof sql === 'string' && Array.isArray(params));
    if (sql.includes('FROM sessions')) {
      assert(sql.includes('s.session_token = $1') && sql.includes('s.expires_at > NOW()') &&
        params.length === 1 && params[0] === 'synthetic-session');
      return { rows: script.auth === 'expired' ? [] : [{ user_id: 'synthetic-user', email: 'synthetic@example.invalid', role: script.auth }] };
    }
    assert(sql.includes('student_id = $1') && params[0] === input.studentId &&
      sql.trim().startsWith('SELECT') && !sql.includes(input.studentId));
    if (sql.includes('FROM students')) {
      assert(params.length === 1);
      return { rows: input.students.filter(row => row.student_id === params[0]).map(row => ({ student_id: row.student_id })) };
    }
    assert(sql.includes('FROM minutes'));
    let rows = clone(input.minutes.filter(row => row.student_id === params[0])).sort(sortRows);
    if (sql.includes('ANY(')) {
      assert(sql.includes('id = ANY($2::int[])') && params.length === 3 && Array.isArray(params[1]) &&
        params[1].every(id => typeof id === 'string') && Number.isInteger(params[2]));
      trace.selectedSources = [...params[1]];
      rows = rows.filter(row => params[1].includes(String(row.id)));
      if (script.fault === 'version_changed' && rows.length) rows[0].version = 'synthetic-v2';
      if (script.fault === 'cross_student_detail') rows.push(clone(input.minutes.find(row => row.student_id !== input.studentId)));
      trace.dbRows.push({ stage: 'detail', studentIds: rows.map(row => row.student_id) });
      return { rows: rows.map(row => ({ id: row.id, student_id: row.student_id, lesson_date: row.lesson_date,
        version: row.version, drive_file_id: row.drive_file_id,
        transcript: points(row.transcript).slice(0, params[2]).join(''), transcript_length: row.transcript_length })) };
    }
    assert(!sql.includes('AS transcript') && sql.includes('LIMIT $2') && sql.includes('DESC NULLS LAST') &&
      params.length === 3 && Number.isInteger(params[1]) && Number.isInteger(params[2]));
    rows = rows.slice(0, params[1]);
    if (script.fault === 'cross_student_metadata') rows.push(clone(input.minutes.find(row => row.student_id !== input.studentId)));
    trace.dbCandidates = rows.map(row => String(row.id));
    trace.dbRows.push({ stage: 'metadata', studentIds: rows.map(row => row.student_id) });
    return { rows: rows.map(row => ({ id: row.id, student_id: row.student_id, lesson_date: row.lesson_date,
      version: row.version, drive_file_id: row.drive_file_id,
      summary: points(row.summary).slice(0, params[2]).join(''),
      quality: points(row.quality).slice(0, params[2]).join(''), summary_length: row.summary_length, quality_length: row.quality_length })) };
  };
  const client = { chat: { completions: { create: async (body, options) => {
    trace.prompts.push(...clone(body.messages));
    const data = JSON.parse(body.messages[1].content);
    const selection = Array.isArray(data.untrustedRecords);
    trace.calls[selection ? 'selection' : 'answer']++;
    if (script.fault === 'provider_error') throw new Error('FAKE_SECRET_EVALUATION_PROVIDER');
    if (script.fault === 'timeout') {
      await new Promise((_, reject) => {
        if (options.signal.aborted) reject(new Error('FAKE_SECRET_ABORT'));
        else options.signal.addEventListener('abort', () => reject(new Error('FAKE_SECRET_ABORT')), { once: true });
      });
    }
    let value;
    if (selection) {
      const eligible = data.untrustedRecords.filter(item => data.phase === 'excerpts' || script.sourceOrder.includes(item.sourceId));
      eligible.sort((a, b) => (data.phase === 'summaries'
        ? script.sourceOrder.indexOf(a.sourceId) - script.sourceOrder.indexOf(b.sourceId) : 0) ||
        (script.excerptNeedles.some(word => b.text.includes(word)) ? 1 : 0) -
        (script.excerptNeedles.some(word => a.text.includes(word)) ? 1 : 0) || a.start - b.start);
      value = { ids: script.fault === 'bad_selection' ? ['forged:999'] : eligible.slice(0, data.maxSelected).map(item => item.id) };
    } else if (script.answerMode === 'abstain') {
      value = { status: 'insufficient_evidence', answer: '別時点の記録がなく判断できない。',
        evidence: [], changes: [], recommendedActions: [], confidence: 'low' };
    } else {
      const excerpts = data.untrustedEvidence.filter(item => !script.answerSource || item.sourceId === script.answerSource);
      const evidence = excerpts.map(item => {
        const quote = points(item.text).slice(0, 80).join('');
        return { statement: '記録には「' + quote + '」とある。', quote, evidenceId: item.id };
      });
      value = { status: 'answered', answer: script.conclusion ?? '参照した架空記録の範囲では、以下の引用を確認できます。',
        evidence, changes: [], recommendedActions: [], confidence: 'medium' };
      if (script.fault === 'bad_citation' && evidence.length) evidence[0].evidenceId = 'forged:999';
    }
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      // Synthetic numbers exercise wiring only; never presented as actual usage.
      ...(script.fault === 'missing_usage' ? {} : { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) };
  } } } };
  return { query, client, trace };
}

export async function evaluateCase(fixture, { runId, manualReview = null, signal } = {}) {
  validateCases([fixture]);
  if (typeof runId !== 'string' || !runId) throw new Error('INVALID_RUN_ID');
  const { input, script } = fixture;
  const { query, client, trace } = createEvaluationDependencies(clone(input), clone(script));
  // Label offline adapters explicitly; route gets both services and never
  // initializes its production client/defaultQuery or reads process.env.
  const options = { client, model: 'offline-scripted-mock', timeoutMs: script.fault === 'timeout' ? 5 : 60000,
    maxInputTokens: script.fault === 'input_limit' ? 2300 : 100000 };
  const build = createStudentAiContextService({ query, select: createStudentAiSelector(options) });
  const answer = createStudentAiAnswerService(options);
  let context = null;
  const app = new Hono();
  app.route('/api/student-ai', createStudentAiRoutes({ query,
    env: { STUDENT_AI_ENABLED: 'true' }, // isolated mock dependency, never an environment mutation
    clock: () => new Date(input.now + 'T00:00:00+09:00'),
    buildContext: async request => { context = await build(request); return context; }, answerQuestion: answer }));
  const raw = await app.request('/api/student-ai/' + encodeURIComponent(input.studentId) + '/questions', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(script.auth === 'none' ? {} : { Authorization: 'Bearer synthetic-session' }) },
    body: JSON.stringify({ question: input.question, ...(input.compareAt ? { compareAt: input.compareAt } : {}) }), signal
  });
  const response = { httpStatus: raw.status, body: await raw.json() };
  const outputHash = hashOutput({ response, context });
  const stages = { dbCandidates: trace.dbCandidates, selectedSources: trace.selectedSources, finalEvidence: context?.evidence ?? [] };
  const forbiddenCanaries = input.minutes.filter(row => row.student_id !== input.studentId)
    .flatMap(row => [...row.transcript.matchAll(/CANARY_[A-Z0-9_]+/g)].map(match => match[0]));
  const retrieval = scoreRetrieval(fixture.gold, stages);
  const mechanical = scoreMechanical({ studentId: input.studentId, context, response,
    forbiddenCanaries, prompts: trace.prompts, minutes: input.minutes });
  const expected = fixture.gold.expected;
  const expectationMatched = response.httpStatus === expected.httpStatus &&
    (expected.kind === 'expected_error' || response.body.data?.status === (expected.kind === 'answerable' ? 'answered' : 'insufficient_evidence'));
  return { caseId: fixture.caseId, category: fixture.category, runId, outputHash,
    mode: 'offline_mock', semanticQuality: 'not_evaluated', selectionMode: script.selectionMode,
    status: signal?.aborted ? 'partial' : 'completed', expectationMatched,
    response, context, stages, retrieval, mechanical,
    semantic: applyManualReview({ runId, caseId: fixture.caseId, outputHash }, manualReview),
    calls: trace.calls, actualUsage: 'unknown', usageSource: 'synthetic_mock_or_missing',
    mockUsagePresent: response.body.data?.usage?.total?.total_tokens != null,
    trace: { dbRows: trace.dbRows, promptHashes: trace.prompts.map(hashOutput),
      promptGoldSeparation: 'input_and_script_only; gold_not_passed_to_dependencies' },
    layers: ['T030 SQL fake/filter/assert', 'T030 selector adapter + scripted mock',
      'T030 context evidence', 'T040 answer service', 'T040 authenticated Hono route'],
    reviewPacket: { synthetic: true, question: input.question, now: input.now, compareAt: input.compareAt ?? null,
      expectedClaims: fixture.gold.expectedClaims, prohibitedAssertions: fixture.gold.prohibitedAssertions,
      unanswerablePoints: fixture.gold.unanswerablePoints, requiredGroups: fixture.gold.requiredGroups,
      reason: expected.reason, purpose: fixture.purpose,
      // All passages here are authored synthetic evidence, separate from provider input.
      goldPassages: fixture.gold.requiredGroups.flatMap(group => group.allOf.flatMap(clause => clause.anyOf.map(ref => {
        const row = input.minutes.find(row => String(row.id) === ref.sourceId);
        return { ...ref, text: points(row[ref.field]).slice(ref.start, ref.end).join('') };
      }))) } };
}

export async function evaluateCases(fixtures, { runId, signal, reviews = [], onCase = () => {}, runCase = evaluateCase } = {}) {
  validateCases(fixtures);
  if (!Array.isArray(reviews) || new Set(reviews.map(review => review.caseId)).size !== reviews.length ||
      reviews.some(review => !fixtures.some(item => item.caseId === review.caseId))) throw new Error('INVALID_MANUAL_REVIEWS');
  const results = [];
  for (const fixture of fixtures) {
    if (signal?.aborted) break;
    try {
      const result = await runCase(fixture, { runId, signal, manualReview: reviews.find(review => review.caseId === fixture.caseId) ?? null });
      results.push(result);
    } catch {
      // Never persist an exception message: fixtures can simulate secret payloads.
      results.push({ caseId: fixture.caseId, category: fixture.category, status: 'failed',
        error: 'EVALUATION_CASE_FAILED', semantic: { status: 'pending', semanticQuality: 'not_evaluated' } });
    }
    await onCase(results.at(-1), results);
  }
  // Include unexecuted cases in the denominator and mark them, never silently drop.
  for (const fixture of fixtures.slice(results.length)) results.push({
    caseId: fixture.caseId, category: fixture.category, status: 'partial', error: 'NOT_EXECUTED',
    semantic: { status: 'pending', semanticQuality: 'not_evaluated' }
  });
  const aggregate = aggregateEvaluation(results);
  return { runId, schemaVersion, fixtureVersion, evaluatorVersion, fixtureHash: hashOutput(fixtures),
    mode: 'offline_mock', semanticQuality: 'not_evaluated', liveQuality: 'pending',
    status: aggregate.status, selectionMode: 'scripted_oracle', seed: null,
    results, aggregate, harnessChecks: {
      expectedOutcomes: results.filter(result => result.expectationMatched === true).length,
      total: fixtures.length, mechanicalFailures: results.filter(result => result.mechanical?.status === 'fail').length,
      technicalFailures: results.filter(result => result.status !== 'completed').length
    } };
}
