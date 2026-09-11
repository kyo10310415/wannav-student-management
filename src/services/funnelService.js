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
    tutors: tutorData
  };
}
