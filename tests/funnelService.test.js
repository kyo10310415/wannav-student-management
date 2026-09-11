import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFunnelData,
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

test('counts every reservation and completed lesson against two lessons per student', () => {
  const students = [
    {
      student_id: 's-1', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'A notion',
      lesson_start_date: '2026-08-01', payment_year_month_current: '2026/9', payment_status_current_month: '支払い完了'
    },
    {
      student_id: 'S-2', status: 'アクティブ', contract_plan: 'PRO', homeroom_tutor: 'A notion',
      lesson_start_date: '2026-09-01', payment_year_month_current: '2026/9', payment_status_current_month: '未払い'
    },
    {
      student_id: 'S-3', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'B notion',
      lesson_start_date: '2026-09-10', payment_year_month_current: '2026/9', payment_status_current_month: '支払完了'
    },
    {
      student_id: 'S-4', status: 'アクティブ', contract_plan: '通常', homeroom_tutor: 'B notion',
      lesson_start_date: '2026-10-01', payment_year_month_current: '2026/9', payment_status_current_month: '支払い完了'
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
  assert.equal(result.tutors[0].metrics.denominator, 2);
  assert.equal(result.tutors[0].metrics.reservation.rate, 75);
  assert.equal(result.tutors[0].metrics.completion.rate, 50);
  assert.equal(result.tutors[1].metrics.denominator, 1);
  assert.equal(result.tutors[1].metrics.reservation.rate, 150);
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
});
