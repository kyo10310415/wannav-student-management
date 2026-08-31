import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateSatisfactionByTutorMonth,
  calculateSatisfactionMetricVariants,
  calculateSatisfactionMetrics,
  getLegacySatisfactionDenominator,
  getSatisfactionDenominator,
  isLessonCompletionFilterActive
} from '../src/services/tutorSatisfactionService.js';

test('aggregates satisfaction records by tutor and month', () => {
  const result = aggregateSatisfactionByTutorMonth([
    { tutor_name: 'Tutor A', year_month: '2026/8', satisfaction_score: '9', student_name: 'A' },
    { tutor_name: 'Tutor A', year_month: '2026/8', satisfaction_score: '7', student_name: 'B', reason: 'reason' },
    { tutor_name: 'Tutor A', year_month: '2026/8', satisfaction_score: 'invalid' }
  ]);

  assert.equal(result['Tutor A']['2026/8'].average, 8);
  assert.equal(result['Tutor A']['2026/8'].count, 2);
  assert.equal(result['Tutor A']['2026/8'].reasons.length, 1);
});

test('activates the completion filter from the 26th JST', () => {
  const justBeforeCutoff = new Date('2026-08-25T14:59:59Z');
  const atCutoff = new Date('2026-08-25T15:00:00Z');

  assert.equal(isLessonCompletionFilterActive(2026, 8, justBeforeCutoff), false);
  assert.equal(isLessonCompletionFilterActive(2026, 8, atCutoff), true);
  assert.equal(isLessonCompletionFilterActive(2026, 7, justBeforeCutoff), true);
  assert.equal(isLessonCompletionFilterActive(2026, 9, atCutoff), false);
});

test('excludes active students without a completed lesson after the cutoff', () => {
  const tutor = { notion_name: 'TutorNotion' };
  const students = [
    { student_id: 'S-1', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: '通常' },
    { student_id: 'S-2', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: 'PROプラン' },
    { student_id: 'S-3', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: '永久会員' }
  ];

  const beforeCutoff = getSatisfactionDenominator({
    students,
    tutor,
    year: 2026,
    month: 8,
    completedStudentIds: new Set(['S-1']),
    referenceDate: new Date('2026-08-25T14:59:59Z')
  });
  const afterCutoff = getSatisfactionDenominator({
    students,
    tutor,
    year: 2026,
    month: 8,
    completedStudentIds: new Set(['S-1']),
    referenceDate: new Date('2026-08-25T15:00:00Z')
  });
  const afterLateLessonCompletion = getSatisfactionDenominator({
    students,
    tutor,
    year: 2026,
    month: 8,
    completedStudentIds: new Set(['S-1', 'S-2']),
    referenceDate: new Date('2026-08-26T15:00:00Z')
  });

  assert.equal(beforeCutoff, 2);
  assert.equal(afterCutoff, 1);
  assert.equal(afterLateLessonCompletion, 2);
});

test('uses the same 0-100 calculation as the Tutor management screen', () => {
  const metrics = calculateSatisfactionMetrics({ average: 9, count: 3 }, 6);

  assert.equal(metrics.satisfactionValue, 90);
  assert.equal(metrics.collectionRate, 50);
  assert.equal(metrics.satisfactionScore, 45);
});

test('creates both legacy and lesson-adjusted snapshot metrics after the cutoff', () => {
  const tutor = { notion_name: 'TutorNotion' };
  const students = [
    { student_id: 'S-1', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: '通常' },
    { student_id: 'S-2', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: 'PROプラン' }
  ];

  assert.equal(getLegacySatisfactionDenominator({ students, tutor }), 2);

  const variants = calculateSatisfactionMetricVariants({
    monthData: { average: 9, count: 1 },
    students,
    tutor,
    year: 2026,
    month: 8,
    completedStudentIds: new Set(['S-1']),
    referenceDate: new Date('2026-08-25T15:00:00Z')
  });

  assert.equal(variants.legacy.denominator, 2);
  assert.equal(variants.legacy.collectionRate, 50);
  assert.equal(variants.legacy.satisfactionScore, 45);
  assert.equal(variants.lessonAdjusted.denominator, 1);
  assert.equal(variants.lessonAdjusted.collectionRate, 100);
  assert.equal(variants.lessonAdjusted.satisfactionScore, 90);
});

test('lesson-adjusted snapshot denominator includes students after a late lesson', () => {
  const tutor = { notion_name: 'TutorNotion' };
  const students = [
    { student_id: 'S-1', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: '通常' },
    { student_id: 'S-2', homeroom_tutor: 'TutorNotion', status: 'アクティブ', contract_plan: 'PROプラン' }
  ];

  const variants = calculateSatisfactionMetricVariants({
    monthData: { average: 8, count: 1 },
    students,
    tutor,
    year: 2026,
    month: 8,
    completedStudentIds: new Set(['S-1', 'S-2']),
    referenceDate: new Date('2026-08-26T15:00:00Z')
  });

  assert.equal(variants.legacy.denominator, 2);
  assert.equal(variants.lessonAdjusted.denominator, 2);
  assert.equal(variants.legacy.collectionRate, variants.lessonAdjusted.collectionRate);
});
