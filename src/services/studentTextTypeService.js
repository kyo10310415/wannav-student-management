export const STUDENT_TEXT_TYPE_NEW = '新';
export const STUDENT_TEXT_TYPE_OLD = '旧';

/**
 * Normalize student IDs before matching rows from different data sources.
 */
export function normalizeStudentTextTypeStudentId(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/－/g, '-')
    .toUpperCase();
}

/**
 * Only the explicit "キャラ選択" marker represents the new text.
 * Blank and any unrecognized legacy value are treated as the old text.
 */
export function resolveStudentTextType(campaignValue) {
  return String(campaignValue ?? '').trim() === 'キャラ選択'
    ? STUDENT_TEXT_TYPE_NEW
    : STUDENT_TEXT_TYPE_OLD;
}

/**
 * Build a student_id -> text type map from separately fetched B/AP columns.
 * Google Sheets omits trailing blank AP cells, so rows are aligned by index.
 */
export function buildStudentTextTypeMap(studentIdRows = [], campaignRows = []) {
  const textTypeMap = new Map();

  studentIdRows.forEach((row, index) => {
    const studentId = normalizeStudentTextTypeStudentId(row?.[0]);
    if (!studentId) return;

    textTypeMap.set(studentId, resolveStudentTextType(campaignRows[index]?.[0]));
  });

  return textTypeMap;
}
