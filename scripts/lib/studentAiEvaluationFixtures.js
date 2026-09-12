import { cases, schemaVersion, fixtureVersion } from '../../tests/fixtures/student-ai-evaluation/cases.js';

export { schemaVersion, fixtureVersion };
export const fixturePath = new URL('../../tests/fixtures/student-ai-evaluation/cases.js', import.meta.url);
const fail = () => { throw new Error('INVALID_EVALUATION_FIXTURE'); };
const string = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const exactKeys = (object, required, optional = []) => {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      required.some(key => !Object.hasOwn(object, key)) || Object.keys(object).some(key => ![...required, ...optional].includes(key))) fail();
};
const strings = (value, allowEmpty = true) => {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some(item => !string(item))) fail();
};
export function validateCases(values) {
  if (!Array.isArray(values) || !values.length) fail();
  const ids = new Set();
  for (const item of values) {
    exactKeys(item, ['schemaVersion', 'synthetic', 'caseId', 'category', 'purpose', 'detects', 'input', 'gold', 'script']);
    if (item.schemaVersion !== schemaVersion || item.synthetic !== true || typeof item.caseId !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(item.caseId) ||
        ids.has(item.caseId) || !string(item.category) || !string(item.purpose) || !string(item.detects)) fail();
    ids.add(item.caseId);
    const { input, gold, script } = item;
    exactKeys(input, ['studentId', 'question', 'now', 'students', 'minutes'], ['compareAt']);
    if (!/^SYN-/.test(input.studentId) || !string(input.question) || !date(input.now) ||
        (input.compareAt !== undefined && !date(input.compareAt)) ||
        !Array.isArray(input.students) || !Array.isArray(input.minutes)) fail();
    if (!input.students.some(row => row.student_id === input.studentId) ||
        new Set(input.students.map(row => row.student_id)).size !== input.students.length) fail();
    for (const row of input.students) {
      exactKeys(row, ['student_id', 'name']);
      if (!/^SYN-/.test(row.student_id) || !string(row.name)) fail();
    }
    const sourceIds = new Set();
    for (const row of input.minutes) {
      exactKeys(row, ['id', 'student_id', 'lesson_date', 'lesson_number', 'version', 'drive_file_id', 'summary',
        'quality', 'transcript', 'generated_text', 'quality_evaluation', 'summary_length', 'quality_length', 'transcript_length']);
      if (!Number.isSafeInteger(row.id) || row.id < 1 || sourceIds.has(row.id) ||
          !input.students.some(student => student.student_id === row.student_id) ||
          (row.lesson_date !== null && !date(row.lesson_date)) ||
          !/^synthetic-/.test(row.version) || !/^synthetic-/.test(row.drive_file_id)) fail();
      sourceIds.add(row.id);
      for (const field of ['summary', 'quality', 'transcript']) {
        if (typeof row[field] !== 'string' || Array.from(row[field]).length !== row[field + '_length']) fail();
      }
      if (row.generated_text !== row.summary || row.quality_evaluation !== row.quality) fail();
    }
    exactKeys(gold, ['requiredGroups', 'counterevidenceGroups', 'comparisonGroups', 'relevantSourceIds',
      'expectedClaims', 'prohibitedAssertions', 'unanswerablePoints', 'expected']);
    for (const name of ['requiredGroups', 'counterevidenceGroups', 'comparisonGroups']) {
      if (!Array.isArray(gold[name]) || new Set(gold[name].map(g => g.groupId)).size !== gold[name].length) fail();
      for (const group of gold[name]) {
        exactKeys(group, ['groupId', 'allOf']);
        if (!string(group.groupId) || !Array.isArray(group.allOf) || !group.allOf.length) fail();
        for (const clause of group.allOf) {
          exactKeys(clause, ['anyOf']);
          if (!Array.isArray(clause.anyOf) || !clause.anyOf.length) fail();
          for (const ref of clause.anyOf) {
            exactKeys(ref, ['sourceId', 'field', 'start', 'end']);
            const row = input.minutes.find(row => String(row.id) === ref.sourceId && row.student_id === input.studentId);
            if (!row || !['transcript', 'generated_text', 'quality_evaluation'].includes(ref.field) ||
                !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end <= ref.start ||
                ref.end > Array.from(row[ref.field]).length) fail();
          }
        }
      }
    }
    strings(gold.expectedClaims, false); strings(gold.prohibitedAssertions); strings(gold.unanswerablePoints);
    strings(gold.relevantSourceIds);
    if (gold.relevantSourceIds.some(id => !input.minutes.some(row => String(row.id) === id && row.student_id === input.studentId))) fail();
    exactKeys(gold.expected, ['kind', 'reason', 'httpStatus']);
    if (!['answerable', 'insufficient', 'expected_error'].includes(gold.expected.kind) || !string(gold.expected.reason) ||
        ![200, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504].includes(gold.expected.httpStatus) ||
        (gold.expected.kind === 'expected_error') === (gold.expected.httpStatus === 200)) fail();
    exactKeys(script, ['selectionMode', 'sourceOrder', 'excerptNeedles', 'answerMode', 'fault', 'auth'], ['conclusion', 'answerSource']);
    strings(script.sourceOrder); strings(script.excerptNeedles);
    if (new Set(script.sourceOrder).size !== script.sourceOrder.length ||
        script.sourceOrder.some(id => !input.minutes.some(row => String(row.id) === id && row.student_id === input.studentId)) ||
        (script.conclusion !== undefined && (!string(script.conclusion) || Array.from(script.conclusion).length > 4000)) ||
        (script.answerSource !== undefined && !input.minutes.some(row => String(row.id) === script.answerSource && row.student_id === input.studentId)) ||
        (script.answerMode === 'controlled_bad' && !string(script.conclusion))) fail();
    if (script.selectionMode !== 'scripted_oracle' || !['quoted_facts', 'abstain', 'controlled_bad'].includes(script.answerMode) ||
        !['none', 'version_changed', 'cross_student_metadata', 'cross_student_detail', 'bad_citation', 'bad_selection',
          'input_limit', 'timeout', 'missing_usage', 'provider_error'].includes(script.fault) ||
        !['none', 'admin', 'leader', 'crew', 'viewer', 'expired'].includes(script.auth)) fail();
  }
  return values;
}

// No file loader or user-supplied dataset. CLI accepts only this built-in bundle.
export function loadEvaluationCases(caseIds) {
  const values = structuredClone(cases);
  validateCases(values);
  if (caseIds === undefined) return values;
  if (!Array.isArray(caseIds) || !caseIds.length || new Set(caseIds).size !== caseIds.length ||
      caseIds.some(id => !values.some(item => item.caseId === id))) fail();
  return values.filter(item => caseIds.includes(item.caseId));
}
