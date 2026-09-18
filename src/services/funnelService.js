const EXCLUDED_CONTRACT_PLANS = new Set(['永久会員', '在籍プラン', 'エントリープラン']);
const PAYMENT_COMPLETE_STATUSES = new Set(['支払い完了', '支払完了']);

export function normalizeFunnelStudentId(studentId) {
  return String(studentId || '')
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/－/g, '-')
    .toUpperCase();
}

export function normalizeYearMonth(value) {
  const match = String(value || '').trim().match(/^(\d{4})[/-](\d{1,2})$/);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return '';

  return `${year}-${String(month).padStart(2, '0')}`;
}

function getNextMonthKey(year, month) {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

export function isFunnelEligibleStudent(student, year, month) {
  if (!student || student.status !== 'アクティブ') return false;
  if (EXCLUDED_CONTRACT_PLANS.has(student.contract_plan)) return false;

  const startDate = String(student.lesson_start_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return true;

  return startDate < getNextMonthKey(Number(year), Number(month));
}

export function getPaymentStatusForMonth(student, targetYearMonth) {
  const target = normalizeYearMonth(targetYearMonth);
  if (!target) return { known: false, status: null };

  if (normalizeYearMonth(student?.payment_year_month_last) === target) {
    return { known: true, status: student.payment_status_last_month || '未払い' };
  }
  if (normalizeYearMonth(student?.payment_year_month_current) === target) {
    return { known: true, status: student.payment_status_current_month || '未払い' };
  }

  return { known: false, status: null };
}

export function getPaymentReferenceYearMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const paymentYear = numericMonth === 1 ? numericYear - 1 : numericYear;
  const paymentMonth = numericMonth === 1 ? 12 : numericMonth - 1;
  return `${paymentYear}-${String(paymentMonth).padStart(2, '0')}`;
}

function makeMetric(numerator, denominator, options = {}) {
  const available = options.available !== false;
  return {
    numerator: available ? numerator : null,
    denominator,
    rate: available && denominator > 0
      ? Math.round((numerator / denominator) * 1000) / 10
      : null,
    available,
    ...(options.knownCount !== undefined ? { knownCount: options.knownCount } : {})
  };
}

function toStudentIdSet(rows, predicate = () => true) {
  const result = new Set();
  for (const row of rows || []) {
    if (!predicate(row)) continue;
    const studentId = normalizeFunnelStudentId(row.student_id);
    if (studentId) result.add(studentId);
  }
  return result;
}

function getYearMonthSerial(value) {
  const match = String(value || '').trim().match(/^(\d{4})[/-](\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + month - 1;
}

export function isAttritionEligibleStudent(student, year, month) {
  if (!student || EXCLUDED_CONTRACT_PLANS.has(student.contract_plan)) return false;
  const startMonth = getYearMonthSerial(student.lesson_start_date);
  const targetMonth = Number(year) * 12 + Number(month) - 1;
  return startMonth !== null && startMonth <= targetMonth;
}

function makeCountMetric(numerator, denominator) {
  return {
    numerator,
    denominator,
    rate: denominator > 0
      ? Math.round((numerator / denominator) * 1000) / 10
      : null,
    available: true
  };
}

/**
 * 最終実施月の翌月を離脱月として、一人を1つの月だけに割り当てる。
 * 例: 1カ月目に実施あり、2カ月目以降に実施なし → 2カ月目離脱。
 */
export function buildAttritionSummary({ students, lastCompletedRows, year, month }) {
  const targetMonth = Number(year) * 12 + Number(month) - 1;
  const lastCompletedByStudent = new Map();
  for (const row of lastCompletedRows || []) {
    const studentId = normalizeFunnelStudentId(row.student_id);
    const completedMonth = getYearMonthSerial(row.last_completed_date);
    if (studentId && completedMonth !== null) {
      lastCompletedByStudent.set(studentId, completedMonth);
    }
  }

  const cohort = (students || [])
    .filter(student => isAttritionEligibleStudent(student, year, month))
    .map(student => {
      const studentId = normalizeFunnelStudentId(student.student_id);
      const startMonth = getYearMonthSerial(student.lesson_start_date);
      const observedMonths = targetMonth - startMonth + 1;
      const lastCompletedMonth = lastCompletedByStudent.get(studentId);
      const lastCompletedOffset = lastCompletedMonth === undefined
        ? 0
        : Math.max(0, lastCompletedMonth - startMonth + 1);
      const churnMonth = lastCompletedOffset + 1;
      const hasChurnedByTarget = churnMonth <= observedMonths;
      return {
        observedMonths,
        churnMonth,
        hasChurnedByTarget,
        isActive: student.status === 'アクティブ'
      };
    });

  const fiveMonthCohort = cohort.filter(student => student.observedMonths >= 5);
  const months = Array.from({ length: 5 }, (_, index) => {
    const monthNumber = index + 1;
    const numerator = fiveMonthCohort.filter(student =>
      student.hasChurnedByTarget && student.churnMonth === monthNumber
    ).length;
    return {
      month: monthNumber,
      ...makeCountMetric(numerator, fiveMonthCohort.length)
    };
  });

  const cumulativeCount = months.reduce((sum, item) => sum + item.numerator, 0);

  return {
    cohortCount: fiveMonthCohort.length,
    cumulativeFiveMonth: makeCountMetric(cumulativeCount, fiveMonthCohort.length),
    statusAttritionCount: fiveMonthCohort.filter(student =>
      student.isActive && student.hasChurnedByTarget && student.churnMonth <= 5
    ).length,
    months
  };
}

export function buildCancellationBreakdown(resultRows, eligibleStudents, expectedLessonCount = 0) {
  const eligibleStudentIds = new Set(
    (eligibleStudents || []).map(student => normalizeFunnelStudentId(student.student_id))
  );
  const counts = {
    completed: 0,
    studentReschedule: 0,
    noShow: 0,
    tutorReschedule: 0,
    other: 0
  };

  for (const row of resultRows || []) {
    const studentId = normalizeFunnelStudentId(row.student_id);
    if (!eligibleStudentIds.has(studentId)) continue;
    const count = Number(row.result_count) || 0;
    switch (String(row.lesson_result || '').trim()) {
      case '実施済み':
        counts.completed += count;
        break;
      case '生徒様都合でリスケ':
        counts.studentReschedule += count;
        break;
      case '無断キャンセル':
        counts.noShow += count;
        break;
      case 'Tutor都合でリスケ':
        counts.tutorReschedule += count;
        break;
      default:
        counts.other += count;
    }
  }

  const bookedNotAttended = counts.studentReschedule + counts.noShow + counts.tutorReschedule + counts.other;
  return {
    lessonNotAttendedTotal: Math.max(0, Number(expectedLessonCount) - counts.completed),
    bookedNotAttended,
    ...counts,
    unavailable: {
      rebookedAndCompleted: null,
      rebookedAndCancelled: null,
      noRebooking: null,
      contactedLater: null,
      noContactAfterNoShow: null,
      bookingLinkNotSent: null,
      bookingLinkSent: null
    }
  };
}

function buildSummary({
  students,
  reservationCounts,
  completionCounts,
  surveyStudentIds,
  paymentMonthAvailable,
  surveyAvailable,
  paymentReferenceYearMonth
}) {
  const denominator = students.length;
  const eligibleStudentIds = new Set(students.map(student => normalizeFunnelStudentId(student.student_id)));

  let paymentCompleteCount = 0;
  let paymentKnownCount = 0;
  for (const student of students) {
    const payment = getPaymentStatusForMonth(student, paymentReferenceYearMonth);
    if (!payment.known) continue;
    paymentKnownCount++;
    if (PAYMENT_COMPLETE_STATUSES.has(String(payment.status).trim())) paymentCompleteCount++;
  }

  let reservationCount = 0;
  let lessonCompletionCount = 0;
  let surveyCompleteCount = 0;
  for (const studentId of eligibleStudentIds) {
    reservationCount += reservationCounts.get(studentId) || 0;
    lessonCompletionCount += completionCounts.get(studentId) || 0;
    if (surveyStudentIds.has(studentId)) surveyCompleteCount++;
  }

  const monthlyLessonCapacity = denominator * 2;

  return {
    denominator,
    payment: makeMetric(paymentCompleteCount, denominator, {
      available: paymentMonthAvailable,
      knownCount: paymentKnownCount
    }),
    reservation: makeMetric(reservationCount, monthlyLessonCapacity),
    completion: makeMetric(lessonCompletionCount, monthlyLessonCapacity),
    survey: makeMetric(surveyCompleteCount, denominator, { available: surveyAvailable })
  };
}

export function buildFunnelData({
  students = [],
  tutors = [],
  reservationRows = [],
  completedRows = [],
  lessonResultRows = [],
  lastCompletedRows = [],
  surveyRecords = [],
  surveyAvailable = true,
  year,
  month
}) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const targetYearMonth = `${numericYear}-${String(numericMonth).padStart(2, '0')}`;
  const paymentReferenceYearMonth = getPaymentReferenceYearMonth(numericYear, numericMonth);

  const eligibleStudents = students.filter(student =>
    isFunnelEligibleStudent(student, numericYear, numericMonth)
  );

  const paymentMonthAvailable = students.some(student =>
    normalizeYearMonth(student.payment_year_month_last) === paymentReferenceYearMonth ||
    normalizeYearMonth(student.payment_year_month_current) === paymentReferenceYearMonth
  );

  const reservationCounts = new Map();
  for (const row of reservationRows) {
    const studentId = normalizeFunnelStudentId(row.student_id);
    if (!studentId) continue;
    reservationCounts.set(
      studentId,
      (reservationCounts.get(studentId) || 0) + (Number(row.reservation_count) || 0)
    );
  }

  const completionCounts = new Map();
  for (const row of completedRows) {
    const studentId = normalizeFunnelStudentId(row.student_id);
    if (!studentId) continue;
    completionCounts.set(
      studentId,
      (completionCounts.get(studentId) || 0) + (Number(row.completion_count) || 0)
    );
  }
  const surveyStudentIds = surveyAvailable
    ? toStudentIdSet(surveyRecords, record => normalizeYearMonth(record.year_month) === targetYearMonth)
    : new Set();

  const summaryArgs = {
    reservationCounts,
    completionCounts,
    surveyStudentIds,
    paymentMonthAvailable,
    surveyAvailable,
    paymentReferenceYearMonth
  };

  const attrition = buildAttritionSummary({
    students,
    lastCompletedRows,
    year: numericYear,
    month: numericMonth
  });
  const cancellationBreakdown = buildCancellationBreakdown(
    lessonResultRows,
    eligibleStudents,
    eligibleStudents.length * 2
  );

  const tutorData = tutors
    .filter(tutor => tutor.notion_name)
    .map(tutor => ({
      employeeId: tutor.employee_id,
      name: tutor.tutor_name || tutor.name || tutor.notion_name,
      notionName: tutor.notion_name,
      metrics: buildSummary({
        ...summaryArgs,
        students: eligibleStudents.filter(student => student.homeroom_tutor === tutor.notion_name)
      })
    }));

  return {
    year: numericYear,
    month: numericMonth,
    targetYearMonth,
    paymentReferenceYearMonth,
    paymentMonthAvailable,
    surveyAvailable,
    overall: buildSummary({ ...summaryArgs, students: eligibleStudents }),
    attrition,
    cancellationBreakdown,
    tutors: tutorData
  };
}
