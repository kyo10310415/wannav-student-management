import { createHash } from 'node:crypto';

export function stableStringify(value) {
  const canonical = item => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort()
      .filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])]));
    return item;
  };
  return JSON.stringify(canonical(value));
}
export const hashOutput = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const metric = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const id = value => String(value?.sourceId ?? value);
const metricNames = ['requiredRecall', 'sourcePrecision', 'counterevidenceRecall', 'comparisonRecall'];

export function scoreRetrieval(gold, stages) {
  const evidence = stages.finalEvidence ?? [];
  const candidates = new Set((stages.dbCandidates ?? []).map(id));
  const selected = new Set((stages.selectedSources ?? []).map(id));
  const groups = (list = []) => list.map(group => {
    const satisfied = predicate => group.allOf.length > 0 && group.allOf.every(clause => clause.anyOf.some(predicate));
    const dbCandidates = satisfied(ref => candidates.has(String(ref.sourceId)));
    const selectedSources = satisfied(ref => selected.has(String(ref.sourceId)));
    const finalEvidence = satisfied(ref => evidence.some(part => String(part.sourceId) === String(ref.sourceId) &&
      (ref.field === undefined || part.field === ref.field) &&
      (ref.start === undefined || Number.isInteger(part.start) && part.start <= ref.start) &&
      (ref.end === undefined || Number.isInteger(part.end) && part.end >= ref.end)));
    return { groupId: group.groupId, dbCandidates, selectedSources, finalEvidence,
      missingAt: finalEvidence ? null : !dbCandidates ? 'dbCandidates' : !selectedSources ? 'selectedSources' : 'finalEvidence' };
  });
  const required = groups(gold.requiredGroups), counterevidence = groups(gold.counterevidenceGroups), comparison = groups(gold.comparisonGroups);
  const recall = list => metric(list.filter(group => group.finalEvidence).length, list.length);
  const sources = new Set(evidence.map(part => String(part.sourceId)));
  const relevant = new Set((gold.relevantSourceIds ?? []).map(String));
  return { requiredRecall: recall(required), sourcePrecision: metric([...sources].filter(source => relevant.has(source)).length, sources.size),
    counterevidenceRecall: recall(counterevidence), comparisonRecall: recall(comparison),
    groups: { required, counterevidence, comparison }, intermediateMatching: 'source_presence_only; finalEvidence also checks field and offsets' };
}

const same = (a, b) => stableStringify(a) === stableStringify(b);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));
const metadata = ['sourceId', 'lessonDate', 'version', 'field', 'start', 'end', 'sourceKind'];

export function scoreMechanical({ studentId, context, response, forbiddenCanaries = [], prompts = [], minutes = [] }) {
  const violations = new Set();
  const flag = (condition, code) => { if (condition) violations.add(code); };
  for (const [surface, value] of Object.entries({ context, response, prompts })) {
    const serialized = stableStringify(value) ?? '';
    flag(forbiddenCanaries.some(canary => typeof canary === 'string' && canary.length > 0 && serialized.includes(canary)), `CANARY_${surface.toUpperCase()}`);
  }
  flag(context != null && context.studentId !== studentId, 'CONTEXT_STUDENT_SCOPE');
  flag(context != null && !Array.isArray(context.evidence), 'CONTEXT_FORMAT');
  const allowed = new Map();
  for (const part of Array.isArray(context?.evidence) ? context.evidence : []) {
    if (!part || typeof part !== 'object') { violations.add('CONTEXT_FORMAT'); continue; }
    flag(allowed.has(part.id), 'DUPLICATE_CONTEXT_ID'); allowed.set(part.id, part);
    const row = minutes.find(row => String(row.id) === String(part.sourceId));
    flag(!row || row.student_id !== studentId, 'SOURCE_OWNERSHIP');
    flag(!['transcript', 'generated_text', 'quality_evaluation'].includes(part.field) ||
      part.sourceKind !== (part.field === 'transcript' ? 'stored_transcript_unverified' : 'summary'), 'CONTEXT_SOURCE_KIND');
    if (row) {
      const raw = row[part.field];
      flag(typeof raw !== 'string' || !Number.isInteger(part.start) || !Number.isInteger(part.end) || part.start < 0 || part.end <= part.start ||
        part.end > Array.from(typeof raw === 'string' ? raw : '').length ||
        Array.from(typeof raw === 'string' ? raw : '').slice(part.start, part.end).join('') !== part.text, 'CONTEXT_ORIGINAL_MISMATCH');
      flag(part.lessonDate !== row.lesson_date || part.version !== (row.version ?? row.updated_at) ||
        part.driveFileId !== (row.drive_file_id ?? null), 'CONTEXT_METADATA_MISMATCH');
    }
  }
  const body = response?.body;
  const success = response?.httpStatus === 200 && body?.success === true;
  flag(!Number.isInteger(response?.httpStatus) || response.httpStatus < 200 || response.httpStatus > 599, 'RESPONSE_FORMAT');
  if (!success) {
    flag(response?.httpStatus === 200 || !body || body.success !== false || typeof body.error !== 'string' || Object.hasOwn(body, 'data'), 'ERROR_RESPONSE_FORMAT');
    return { status: violations.size ? 'fail' : 'not_applicable', violations: [...violations] };
  }
  flag(!context, 'MISSING_CONTEXT');
  const answer = body.data;
  if (!keys(answer, ['status', 'answer', 'evidence', 'changes', 'recommendedActions', 'confidence', 'sources', 'coverage', 'usage'])) {
    violations.add('ANSWER_FORMAT');
    return { status: 'fail', violations: [...violations] };
  }
  flag(!['answered', 'insufficient_evidence'].includes(answer.status) || !['high', 'medium', 'low'].includes(answer.confidence) || !text(answer.answer, 4000), 'ANSWER_FORMAT');
  for (const [key, max] of [['evidence', 12], ['changes', 5], ['recommendedActions', 5], ['sources', 12]]) {
    flag(!Array.isArray(answer[key]) || answer[key].length > max, 'ANSWER_FORMAT');
  }
  if (violations.has('ANSWER_FORMAT')) return { status: 'fail', violations: [...violations] };
  const cited = new Set(), sources = new Map();
  for (const entry of answer.evidence) {
    if (!entry || typeof entry !== 'object') { violations.add('EVIDENCE_FORMAT'); continue; }
    flag(!keys(entry, ['statement', 'evidenceId', 'quote', ...metadata]) || !text(entry.statement, 800) || !text(entry.quote, 1000), 'EVIDENCE_FORMAT');
    const original = allowed.get(entry.evidenceId);
    flag(!original || cited.has(entry.evidenceId), 'EVIDENCE_ID'); cited.add(entry.evidenceId);
    if (!original) continue;
    flag(typeof entry.quote !== 'string' || typeof original.text !== 'string' || !original.text.includes(entry.quote), 'QUOTE_MISMATCH');
    flag(metadata.some(key => !same(entry[key], original[key])), 'EVIDENCE_METADATA');
    if (!sources.has(original.sourceId)) sources.set(original.sourceId, {
      sourceId: original.sourceId, lessonDate: original.lessonDate, version: original.version,
      driveUrl: typeof original.driveFileId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(original.driveFileId)
        ? `https://drive.google.com/file/d/${encodeURIComponent(original.driveFileId)}/view` : null, evidenceIds: [] });
    sources.get(original.sourceId).evidenceIds.push(original.id);
  }
  flag(!same(answer.sources, [...sources.values()]), 'SOURCES_METADATA_OR_DEDUPLICATION');
  const references = refs => Array.isArray(refs) && refs.length > 0 && refs.length <= 12 &&
    new Set(refs).size === refs.length && refs.every(ref => cited.has(ref) && allowed.has(ref));
  for (const change of answer.changes) {
    if (!change || typeof change !== 'object') { violations.add('CHANGE_REFERENCES'); continue; }
    flag(!keys(change, ['description', 'evidenceIds']) || !text(change.description, 800) || !references(change.evidenceIds), 'CHANGE_REFERENCES');
    const records = (Array.isArray(change.evidenceIds) ? change.evidenceIds : []).map(ref => allowed.get(ref)).filter(Boolean);
    flag(new Set(records.map(part => part.sourceId)).size < 2 || new Set(records.map(part => part.lessonDate).filter(Boolean)).size < 2, 'CHANGE_TIMEPOINTS');
  }
  for (const action of answer.recommendedActions) flag(!keys(action, ['action', 'reason', 'evidenceIds']) ||
    !text(action?.action, 800) || !text(action?.reason, 800) || !references(action?.evidenceIds), 'ACTION_REFERENCES');
  flag(answer.status === 'answered' && cited.size === 0, 'ANSWER_WITHOUT_EVIDENCE');
  flag(answer.status === 'insufficient_evidence' && (cited.size || answer.changes.length || answer.recommendedActions.length || answer.confidence !== 'low' ||
    answer.answer !== '保存済みの参照資料だけでは判断できません。必要な記録を確認してください。'), 'ABSTENTION_FORMAT');
  const expectedCoverage = { ...context?.coverage, answerEvidenceIds: [...allowed.keys()],
    answerSourceIds: [...new Set([...allowed.values()].map(part => part.sourceId))], answerUsesExcerptsOnly: true };
  flag(!same(answer.coverage, expectedCoverage), 'COVERAGE_METADATA');
  return { status: violations.size ? 'fail' : 'pass', violations: [...violations] };
}

export const MANUAL_RUBRIC_FIELDS = Object.freeze(['support', 'time', 'counterevidence', 'prohibitedAssertions', 'abstention', 'factProposalSeparation']);
export function applyManualReview(target, review = null) {
  if (review == null) return { status: 'pending', semanticQuality: 'not_evaluated', manualRequired: true };
  if (['runId', 'caseId', 'outputHash'].some(key => typeof target[key] !== 'string' || target[key] !== review[key])) throw new Error('REVIEW_TARGET_MISMATCH');
  if (!keys(review, ['runId', 'caseId', 'outputHash', 'reviewer', 'ratings', 'notes']) ||
    !text(review.reviewer, 200) || !keys(review.ratings, MANUAL_RUBRIC_FIELDS) ||
    MANUAL_RUBRIC_FIELDS.some(key => !['pass', 'fail', 'na'].includes(review.ratings[key])) ||
    typeof review.notes !== 'string' || Array.from(review.notes).length > 4000) throw new Error('INVALID_MANUAL_REVIEW');
  const values = Object.values(review.ratings);
  return { status: values.includes('fail') ? 'fail' : values.every(value => value === 'na') ? 'not_applicable' : 'pass',
    semanticQuality: 'not_evaluated', manualRequired: false, review };
}

function summarize(results) {
  const count = results.length;
  const retrieval = Object.fromEntries(metricNames.map(name => {
    const values = results.map(result => result.retrieval?.[name]);
    const evaluated = values.filter(value => value && value.value !== null);
    return [name, { macro: evaluated.length ? evaluated.reduce((sum, value) => sum + value.value, 0) / evaluated.length : null,
      micro: metric(evaluated.reduce((sum, value) => sum + value.numerator, 0), evaluated.reduce((sum, value) => sum + value.denominator, 0)),
      evaluated: evaluated.length, notApplicable: values.filter(value => value?.value === null).length, notEvaluated: values.filter(value => !value).length }];
  }));
  const statuses = field => Object.fromEntries(['pass', 'fail', 'pending', 'not_applicable', 'not_evaluated'].map(status =>
    [status, results.filter(result => (result[field]?.status ?? 'not_evaluated') === status).length]));
  const rate = predicate => metric(results.filter(predicate).length, count);
  return { cases: count, completed: results.filter(result => result.status === 'completed').length,
    failed: results.filter(result => result.status === 'failed').length, partial: results.filter(result => result.status === 'partial').length,
    retrieval, mechanical: statuses('mechanical'), manualReview: statuses('semantic'),
    apiSuccessRate: rate(result => result.response?.httpStatus === 200),
    unknownResponseCount: results.filter(result => !Number.isInteger(result.response?.httpStatus) || result.response.httpStatus < 200 || result.response.httpStatus > 599).length,
    expectedOutcomeMatchedCount: results.filter(result => result.expectationMatched === true).length,
    completionRate: rate(result => result.status === 'completed'), formatRefusalRate: rate(result => result.response?.httpStatus === 502),
    inputLimitRate: rate(result => [413, 422].includes(result.response?.httpStatus)), timeoutRate: rate(result => result.response?.httpStatus === 504),
    calls: { selection: results.reduce((sum, result) => sum + (result.calls?.selection ?? 0), 0), answer: results.reduce((sum, result) => sum + (result.calls?.answer ?? 0), 0) } };
}
export function aggregateEvaluation(results) {
  const overall = summarize(results);
  return { mode: 'offline_mock', semanticQuality: 'not_evaluated', liveQuality: 'pending',
    status: !results.length || overall.failed === results.length ? 'failed' : overall.completed !== results.length ? 'partial' : 'completed',
    overall, categories: Object.fromEntries([...new Set(results.map(result => result.category))].sort()
      .map(category => [category, summarize(results.filter(result => result.category === category))])),
    actualUsage: 'unknown', liveLatency: 'not_measured', liveCost: 'not_measured' };
}
