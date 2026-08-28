import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateMinutesQualityEvaluations,
  buildTranscriptPromptText,
  normalizeMinutesQualityEvaluation
} from '../src/services/minutesQualityService.js';

test('normalizes all six lesson quality metrics', () => {
  const evaluation = normalizeMinutesQualityEvaluation({
    opening_anxiety_check: { status: 'met', evidence: '冒頭で確認した' },
    anxiety_content_record: { achieved: true, value: '配信への不安' },
    previous_anxiety_followup: { status: 'not_applicable' },
    specific_praise: { status: false },
    next_small_goal_setting: { status: '達成', value: '動画を1本作る' },
    previous_small_goal_review: { status: '対象外' }
  });

  assert.equal(evaluation.metrics.opening_anxiety_check.status, 'met');
  assert.equal(evaluation.metrics.anxiety_content_record.status, 'met');
  assert.equal(evaluation.metrics.previous_anxiety_followup.status, 'not_applicable');
  assert.equal(evaluation.metrics.specific_praise.status, 'not_met');
  assert.equal(evaluation.metrics.next_small_goal_setting.status, 'met');
  assert.equal(evaluation.metrics.previous_small_goal_review.status, 'not_applicable');
});

test('does not allow not_applicable for metrics required in every lesson', () => {
  const evaluation = normalizeMinutesQualityEvaluation({
    opening_anxiety_check: { status: 'not_applicable' },
    anxiety_content_record: { status: 'not_applicable' },
    specific_praise: { status: 'not_applicable' },
    next_small_goal_setting: { status: 'not_applicable' }
  });

  assert.equal(evaluation.metrics.opening_anxiety_check.status, 'not_met');
  assert.equal(evaluation.metrics.anxiety_content_record.status, 'not_met');
  assert.equal(evaluation.metrics.specific_praise.status, 'not_met');
  assert.equal(evaluation.metrics.next_small_goal_setting.status, 'not_met');
});

test('aggregates monthly rates and excludes not_applicable lessons from the denominator', () => {
  const result = aggregateMinutesQualityEvaluations([
    {
      quality_evaluation: {
        previous_anxiety_followup: { status: 'met' },
        opening_anxiety_check: { status: 'met' }
      }
    },
    {
      quality_evaluation: {
        previous_anxiety_followup: { status: 'not_met' },
        opening_anxiety_check: { status: 'not_met' }
      }
    },
    {
      quality_evaluation: {
        previous_anxiety_followup: { status: 'not_applicable' },
        opening_anxiety_check: { status: 'met' }
      }
    },
    { quality_evaluation: null }
  ]);

  const previousAnxiety = result.metrics.find(metric => metric.key === 'previous_anxiety_followup');
  const openingAnxiety = result.metrics.find(metric => metric.key === 'opening_anxiety_check');

  assert.equal(result.totalMinutes, 4);
  assert.equal(result.evaluatedMinutes, 3);
  assert.equal(result.missingEvaluationMinutes, 1);
  assert.equal(previousAnxiety.applicableCount, 2);
  assert.equal(previousAnxiety.notApplicableCount, 1);
  assert.equal(previousAnxiety.rate, 50);
  assert.equal(openingAnxiety.applicableCount, 3);
  assert.ok(Math.abs(openingAnxiety.rate - (200 / 3)) < 1e-10);
});

test('keeps a transcript in full when it is within the expanded limit', () => {
  const transcript = `OPENING-${'a'.repeat(100)}-MIDDLE-${'b'.repeat(100)}-ENDING`;
  const promptText = buildTranscriptPromptText(transcript, 1000);

  assert.equal(promptText, transcript);
});

test('samples long transcripts evenly instead of favoring the opening', () => {
  const transcript = `${'A'.repeat(100)}${'B'.repeat(100)}${'C'.repeat(100)}${'D'.repeat(100)}${'E'.repeat(100)}${'F'.repeat(100)}`;
  const promptText = buildTranscriptPromptText(transcript, 120, 6);

  assert.match(promptText, /^A/);
  assert.match(promptText, /B{10}/);
  assert.match(promptText, /C{10}/);
  assert.match(promptText, /D{10}/);
  assert.match(promptText, /E{10}/);
  assert.match(promptText, /F$/);
  assert.match(promptText, /中略/);
});
