/**
 * Tutor satisfaction calculation helpers shared by jobs and API routes.
 */

export function aggregateSatisfactionByTutorMonth(records) {
  const grouped = {};

  for (const record of records || []) {
    const tutorName = record.tutor_name;
    const yearMonth = record.year_month;
    const score = parseFloat(record.satisfaction_score);

    if (!tutorName || !yearMonth || Number.isNaN(score)) continue;

    if (!grouped[tutorName]) grouped[tutorName] = {};
    if (!grouped[tutorName][yearMonth]) {
      grouped[tutorName][yearMonth] = {
        scores: [],
        reasons: [],
        studentNames: []
      };
    }

    const monthData = grouped[tutorName][yearMonth];
    monthData.scores.push(score);

    if (record.reason) {
      monthData.reasons.push({
        studentName: record.student_name,
        reason: record.reason,
        score
      });
    }
    if (record.student_name) monthData.studentNames.push(record.student_name);
  }

  const result = {};
  for (const [tutorName, months] of Object.entries(grouped)) {
    result[tutorName] = {};
    for (const [yearMonth, data] of Object.entries(months)) {
      result[tutorName][yearMonth] = {
        average: data.scores.reduce((sum, score) => sum + score, 0) / data.scores.length,
        count: data.scores.length,
        reasons: data.reasons,
        studentNames: data.studentNames
      };
    }
  }

  return result;
}

export function getJstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

/**
 * The lesson-completion denominator rule starts on the 26th JST.
 * It always applies to completed past months and never to future months.
 */
export function isLessonCompletionFilterActive(year, month, referenceDate = new Date()) {
  const current = getJstDateParts(referenceDate);
  const targetValue = Number(year) * 12 + Number(month);
  const currentValue = current.year * 12 + current.month;

  if (targetValue < currentValue) return true;
  if (targetValue > currentValue) return false;
  return current.day > 25;
}

export function normalizeStudentId(studentId) {
  return String(studentId || '')
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/－/g, '-')
    .toUpperCase();
}

export function getActiveStudentsForTutor(students, tutor) {
  return (students || []).filter(student =>
    student.homeroom_tutor === tutor.notion_name &&
    student.status === 'アクティブ' &&
    student.contract_plan !== '永久会員' &&
    student.contract_plan !== '在籍プラン'
  );
}

/**
 * 25日判定を導入する前の回収率分母。
 * レッスン実施有無に関係なく、対象となるアクティブ生徒をすべて数える。
 */
export function getLegacySatisfactionDenominator({ students, tutor }) {
  return getActiveStudentsForTutor(students, tutor).length;
}

export function getSatisfactionDenominator({
  students,
  tutor,
  year,
  month,
  completedStudentIds = null,
  referenceDate = new Date()
}) {
  const activeStudents = getActiveStudentsForTutor(students, tutor);

  if (!isLessonCompletionFilterActive(year, month, referenceDate) || !(completedStudentIds instanceof Set)) {
    return activeStudents.length;
  }

  return activeStudents.filter(student =>
    completedStudentIds.has(normalizeStudentId(student.student_id))
  ).length;
}

export function calculateSatisfactionMetrics(monthData, denominator) {
  if (!monthData) {
    return {
      satisfactionValue: null,
      satisfactionCount: 0,
      collectionRate: denominator > 0 ? 0 : null,
      satisfactionScore: null
    };
  }

  const satisfactionValue = Number(monthData.average) * 10;
  const satisfactionCount = Number(monthData.count) || 0;
  const collectionRate = denominator > 0
    ? satisfactionCount / denominator * 100
    : null;
  const satisfactionScore = collectionRate === null
    ? null
    : satisfactionValue * collectionRate / 100;

  return {
    satisfactionValue,
    satisfactionCount,
    collectionRate,
    satisfactionScore
  };
}

/**
 * 同じ満足度データから旧計算・レッスン実施考慮の両方を生成する。
 * スナップショットでは既存シートに legacy、新規シートに lessonAdjusted を保存する。
 */
export function calculateSatisfactionMetricVariants({
  monthData,
  students,
  tutor,
  year,
  month,
  completedStudentIds = null,
  referenceDate = new Date()
}) {
  const legacyDenominator = getLegacySatisfactionDenominator({ students, tutor });
  const lessonAdjustedDenominator = getSatisfactionDenominator({
    students,
    tutor,
    year,
    month,
    completedStudentIds,
    referenceDate
  });

  return {
    legacy: {
      denominator: legacyDenominator,
      ...calculateSatisfactionMetrics(monthData, legacyDenominator)
    },
    lessonAdjusted: {
      denominator: lessonAdjustedDenominator,
      ...calculateSatisfactionMetrics(monthData, lessonAdjustedDenominator)
    }
  };
}
