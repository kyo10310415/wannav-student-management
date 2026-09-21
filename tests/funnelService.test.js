import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAttritionSummary,
  buildCancellationBreakdown,
  buildFunnelData,
  buildRebookingSummary,
  getPaymentReferenceYearMonth,
  getPaymentStatusForMonth,
  isFunnelEligibleStudent,
  normalizeYearMonth
} from '../src/services/funnelService.js';

test('normalizes supported year-month formats', () => {
  assert.equal(normalizeYearMonth('2026/9'), '2026-09');
  assert.equal(normalizeYearMonth('2026-09'), '2026-09');
  assert.equal(normalizeYearMonth('2026/13'), '');
});

test('limits the cohort to active students who started by the target month', () => {
  assert.equal(isFunnelEligibleStudent({ status: 'アクティブ', contract_plan: '通常', lesson_start_date: '2026-09-30' }, 2026, 9), true);
  assert.equal(isFunnelEligibleStudent({ status: 'アクティブ', contract_plan: '通常', lesson_start_date: '2026-10-01' }, 2026, 9), false);
  assert.equal(isFunnelEligibleStudent({ status: 'アクティブ', contract_plan: '永久会員' }, 2026, 9), false);
  assert.equal(isFunnelEligibleStudent({ status: 'アクティブ', contract_plan: 'エントリープラン' }, 2026, 9), false);
  assert.equal(isFunnelEligibleStudent({ status: '退会済み', contract_plan: '通常' }, 2026, 9), false);
});

test('selects payment status only when the stored month matches', () => {
  const student = {
    payment_year_month_last: '2026/8',
    payment_status_last_month: '支払い完了',
    payment_year_month_current: '2026/9',
    payment_status_current_month: '未払い'
  };

  assert.deepEqual(getPaymentStatusForMonth(student, '2026-08'), { known: true, status: '支払い完了' });
  assert.deepEqual(getPaymentStatusForMonth(student, '2026-07'), { known: false, status: null });
});

test('uses the previous calendar month as the payment reference', () => {
  assert.equal(getPaymentReferenceYearMonth(2026, 9), '2026-08');
  assert.equal(getPaymentReferenceYearMonth(2026, 1), '2025-12');
});

test('counts every reservation and completed lesson against two lessons per student', () => {
  const students = [
    {
      student_id: 's-1', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'A notion',
      lesson_start_date: '2026-08-01', payment_year_month_last: '2026/8', payment_status_last_month: '支払い完了'
    },
    {
      student_id: 'S-2', status: 'アクティブ', contract_plan: 'PRO', homeroom_tutor: 'A notion',
      lesson_start_date: '2026-09-01', payment_year_month_last: '2026/8', payment_status_last_month: '未払い'
    },
    {
      student_id: 'S-3', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'B notion',
      lesson_start_date: '2026-09-10', payment_year_month_last: '2026/8', payment_status_last_month: '支払完了'
    },
    {
      student_id: 'S-4', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'B notion',
      lesson_start_date: '2026-10-01', payment_year_month_last: '2026/8', payment_status_last_month: '支払い完了'
    }
  ];
  const tutors = [
    { employee_id: 'T1', tutor_name: 'Tutor A', notion_name: 'A notion' },
    { employee_id: 'T2', tutor_name: 'Tutor B', notion_name: 'B notion' }
  ];

  const result = buildFunnelData({
    students,
    tutors,
    reservationRows: [
      { student_id: 'S-1', reservation_count: '2' },
      { student_id: 'S-2', reservation_count: 1 },
      { student_id: 'S-3', reservation_count: 3 }
    ],
    completedRows: [
      { student_id: 'S-1', completion_count: 2 },
      { student_id: 'S-3', completion_count: 1 }
    ],
    surveyRecords: [
      { student_id: 'S-1', year_month: '2026/9' },
      { student_id: 's-1', year_month: '2026/9' },
      { student_id: 'S-2', year_month: '2026/8' }
    ],
    year: 2026,
    month: 9
  });

  assert.equal(result.overall.denominator, 3);
  assert.deepEqual(result.overall.payment, {
    numerator: 2, denominator: 3, rate: 66.7, available: true, knownCount: 3
  });
  assert.deepEqual(result.overall.reservation, {
    numerator: 6, denominator: 6, rate: 100, available: true
  });
  assert.deepEqual(result.overall.completion, {
    numerator: 3, denominator: 6, rate: 50, available: true
  });
  assert.equal(result.overall.survey.numerator, 1);
  assert.deepEqual(result.overall.surveyAmongCompleted, {
    numerator: 1, denominator: 2, rate: 50, available: true
  });
  assert.equal(result.cancellationBreakdown.unreservedCount, 0);
  assert.equal(result.paymentReferenceYearMonth, '2026-08');
  assert.equal(result.tutors[0].metrics.denominator, 2);
  assert.equal(result.tutors[0].metrics.reservation.rate, 75);
  assert.equal(result.tutors[0].metrics.completion.rate, 50);
  assert.equal(result.tutors[0].metrics.surveyAmongCompleted.rate, 100);
  assert.equal(result.tutors[1].metrics.denominator, 1);
  assert.equal(result.tutors[1].metrics.reservation.rate, 150);
  assert.equal(result.tutors[1].metrics.surveyAmongCompleted.rate, 0);
});

test('marks payment and survey metrics unavailable instead of reporting false zeroes', () => {
  const result = buildFunnelData({
    students: [{ student_id: 'S-1', status: 'アクティブ', contract_plan: '通常' }],
    tutors: [],
    year: 2026,
    month: 7,
    surveyAvailable: false
  });

  assert.equal(result.overall.payment.available, false);
  assert.equal(result.overall.payment.rate, null);
  assert.equal(result.overall.survey.available, false);
  assert.equal(result.overall.survey.rate, null);
  assert.equal(result.overall.surveyAmongCompleted.available, false);
  assert.equal(result.overall.surveyAmongCompleted.rate, null);
});

test('calculates survey response rate only among students with a completed lesson', () => {
  const result = buildFunnelData({
    students: [
      { student_id: 'S-1', status: 'アクティブ', contract_plan: '通常' },
      { student_id: 'S-2', status: 'アクティブ', contract_plan: '通常' }
    ],
    completedRows: [{ student_id: 'S-1', completion_count: 2 }],
    surveyRecords: [
      { student_id: 'S-1', year_month: '2026/9' },
      { student_id: 'S-2', year_month: '2026/9' }
    ],
    year: 2026,
    month: 9
  });

  assert.deepEqual(result.overall.survey, {
    numerator: 2, denominator: 2, rate: 100, available: true
  });
  assert.deepEqual(result.overall.surveyAmongCompleted, {
    numerator: 1, denominator: 1, rate: 100, available: true
  });
});

test('assigns each student to the first month after their final completed lesson', () => {
  const students = [
    { student_id: 'S-1', contract_plan: '通常', lesson_start_date: '2026-01-10' },
    { student_id: 'S-2', status: 'アクティブ', contract_plan: '通常', lesson_start_date: '2026-01-10' },
    { student_id: 'S-3', status: '退会', contract_plan: 'PRO', lesson_start_date: '2026-01-10' },
    { student_id: 'S-4', contract_plan: '通常', lesson_start_date: '2026-01-10' },
    { student_id: 'S-5', contract_plan: '通常', lesson_start_date: '2026-04-01' },
    { student_id: 'S-6', contract_plan: 'エントリープラン', lesson_start_date: '2026-01-01' }
  ];

  const result = buildAttritionSummary({
    students,
    lastCompletedRows: [
      { student_id: 'S-2', last_completed_date: '2026-01-20' },
      { student_id: 'S-3', last_completed_date: '2026-02-20' },
      { student_id: 'S-4', last_completed_date: '2026-05-20' }
    ],
    year: 2026,
    month: 5
  });

  assert.equal(result.cohortCount, 4);
  assert.deepEqual(result.months[0], {
    month: 1, numerator: 1, denominator: 4, rate: 25, available: true
  });
  assert.deepEqual(result.months[1], {
    month: 2, numerator: 1, denominator: 4, rate: 25, available: true
  });
  assert.deepEqual(result.months[2], {
    month: 3, numerator: 1, denominator: 4, rate: 25, available: true
  });
  assert.deepEqual(result.cumulativeFiveMonth, {
    numerator: 3, denominator: 4, rate: 75, available: true
  });
  assert.equal(
    result.months.reduce((sum, item) => sum + item.numerator, 0),
    result.cumulativeFiveMonth.numerator
  );
  assert.equal(result.statusAttritionCount, null);
});

test('breaks non-attendance reports into student, no-show, and tutor cancellations', () => {
  const result = buildCancellationBreakdown([
    { student_id: 'S-1', lesson_result: '実施済み', result_count: 2 },
    { student_id: 'S-1', lesson_result: '生徒様都合でリスケ', result_count: 3 },
    { student_id: 'S-2', lesson_result: '無断キャンセル', result_count: 1 },
    { student_id: 'S-2', lesson_result: 'Tutor都合でリスケ', result_count: 1 },
    { student_id: 'S-2', lesson_result: 'Tutor都合によるリスケ', result_count: 1 },
    { student_id: 'OUTSIDE', lesson_result: '無断キャンセル', result_count: 99 }
  ], [
    { student_id: 'S-1' },
    { student_id: 'S-2' }
  ], 10, { unreservedStudentCount: 2 });

  assert.equal(result.completed, 2);
  assert.equal(result.studentReschedule, 3);
  assert.equal(result.noShow, 1);
  assert.equal(result.tutorReschedule, 2);
  assert.equal(result.bookedNotAttended, 6);
  assert.equal(result.unreservedCount, 2);
  assert.equal(result.lessonNotAttendedTotal, 8);
  assert.equal(result.unavailable.rebookedAndCompleted, null);
  assert.equal(result.unavailable.contactedLater, null);
});

test('classifies the first reservation after a student cancellation', () => {
  const result = buildRebookingSummary([
    { student_id: 'S-1', next_lesson_date: '2026-09-15', next_lesson_result: '実施済み' },
    { student_id: 'S-2', next_lesson_date: '2026-09-20', next_lesson_result: '無断キャンセル' },
    { student_id: 'S-3', next_lesson_date: null, next_lesson_result: null },
    { student_id: 'S-4', next_lesson_date: '2026-09-28', next_lesson_result: null },
    { student_id: 'OUTSIDE', next_lesson_date: null, next_lesson_result: null }
  ], [
    { student_id: 'S-1' },
    { student_id: 'S-2' },
    { student_id: 'S-3' },
    { student_id: 'S-4' }
  ]);

  assert.deepEqual(result, {
    rebookedAndCompleted: 1,
    rebookedAndCancelled: 1,
    rebookingPending: 1,
    noRebooking: 1
  });
});
