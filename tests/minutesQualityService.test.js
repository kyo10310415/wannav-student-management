import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateMinutesQualityEvaluations,
  buildTranscriptPromptText,
  getPreviousMinutesQualityTargets,
  normalizeMinutesQualityEvaluation,
  validateMinutesQualityEvaluation
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
        version: 2,
        previous_anxiety_followup: { status: 'met' },
        opening_anxiety_check: { status: 'met' }
      }
    },
    {
      quality_evaluation: {
        version: 2,
        previous_anxiety_followup: { status: 'not_met' },
        opening_anxiety_check: { status: 'not_met' }
      }
    },
    {
      quality_evaluation: {
        version: 2,
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

test('excludes legacy unverified evaluations from monthly rates', () => {
  const result = aggregateMinutesQualityEvaluations([
    {
      quality_evaluation: {
        version: 1,
        opening_anxiety_check: { status: 'met' }
      }
    },
    {
      quality_evaluation: {
        version: 2,
        opening_anxiety_check: { status: 'not_met' }
      }
    }
  ]);

  assert.equal(result.totalMinutes, 2);
  assert.equal(result.evaluatedMinutes, 1);
  assert.equal(result.missingEvaluationMinutes, 1);
  assert.equal(result.legacyEvaluationMinutes, 1);
  assert.equal(result.metrics[0].rate, 0);
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

test('resolves previous anxiety and goal targets from structured quality data', () => {
  const targets = getPreviousMinutesQualityTargets({
    quality_evaluation: JSON.stringify({
      version: 2,
      metrics: {
        anxiety_content_record: { status: 'met', value: '初配信が不安' },
        next_small_goal_setting: { status: 'met', value: '動画を1本投稿する' }
      }
    })
  });

  assert.deepEqual(targets, {
    anxietyContent: '初配信が不安',
    smallGoal: '動画を1本投稿する'
  });
});

test('treats a previous explicit no-anxiety answer as no follow-up target', () => {
  const targets = getPreviousMinutesQualityTargets({
    quality_evaluation: {
      version: 2,
      anxiety_content_record: { status: 'met', value: '特になし' },
      next_small_goal_setting: { status: 'not_met', value: '' }
    }
  });

  assert.deepEqual(targets, { anxietyContent: null, smallGoal: null });
});

test('uses the previous minutes next-action section for legacy records', () => {
  const targets = getPreviousMinutesQualityTargets({
    generated_text: `# レッスン議事録

## ネクストアクション・ミッション
・サムネイルを2枚作成する

## 次回レッスン予定
添削を行う`
  });

  assert.equal(targets.anxietyContent, null);
  assert.equal(targets.smallGoal, 'サムネイルを2枚作成する');
});

test('does not trust structured targets from a legacy unverified evaluation', () => {
  const targets = getPreviousMinutesQualityTargets({
    quality_evaluation: {
      version: 1,
      anxiety_content_record: { status: 'met', value: 'AIが推測した不安' },
      next_small_goal_setting: { status: 'met', value: 'AIが推測した目標' }
    },
    generated_text: `## ネクストアクション・ミッション
実際の議事録に保存された目標

## 次回レッスン予定
振り返り`
  });

  assert.deepEqual(targets, {
    anxietyContent: null,
    smallGoal: '実際の議事録に保存された目標'
  });
});

test('downgrades a met result when its evidence is not present in the transcript', () => {
  const evaluation = validateMinutesQualityEvaluation(
    {
      opening_anxiety_check: {
        status: 'met',
        evidence: '不安なことはありますか'
      },
      anxiety_content_record: {
        status: 'met',
        evidence: '初配信が不安です',
        value: '初配信が不安'
      },
      specific_praise: {
        status: 'met',
        evidence: '構成が具体的で良かったです'
      }
    },
    '今日は発声練習から始めます。声量を意識しましょう。'
  );

  assert.equal(evaluation.version, 2);
  assert.equal(evaluation.metrics.opening_anxiety_check.status, 'not_met');
  assert.equal(evaluation.metrics.anxiety_content_record.status, 'not_met');
  assert.equal(evaluation.metrics.specific_praise.status, 'not_met');
});

test('keeps grounded results and determines previous-item applicability on the server', () => {
  const transcript = `Tutor: 今困っていることや不安なことはありますか？
生徒: 初配信が不安です。
Tutor: 前回話していた初配信の不安はどうなりましたか？
生徒: 少し解消しました。
Tutor: 投稿の構成を三段階に分けた点が具体的で良かったです。
Tutor: 次回までに紹介動画を一本投稿しましょう。`;
  const evaluation = validateMinutesQualityEvaluation(
    {
      opening_anxiety_check: {
        status: 'met',
        evidence: '今困っていることや不安なことはありますか？'
      },
      anxiety_content_record: {
        status: 'met',
        evidence: '初配信が不安です。',
        value: '初配信が不安'
      },
      previous_anxiety_followup: {
        status: 'not_applicable',
        evidence: '',
        value: ''
      },
      specific_praise: {
        status: 'met',
        evidence: '投稿の構成を三段階に分けた点が具体的で良かったです。'
      },
      next_small_goal_setting: {
        status: 'met',
        evidence: '次回までに紹介動画を一本投稿しましょう。',
        value: '紹介動画を一本投稿する'
      },
      previous_small_goal_review: {
        status: 'met',
        evidence: '次回までに紹介動画を一本投稿しましょう。'
      }
    },
    transcript,
    { anxietyContent: '初配信が不安', smallGoal: null }
  );

  assert.equal(evaluation.metrics.opening_anxiety_check.status, 'met');
  assert.equal(evaluation.metrics.anxiety_content_record.status, 'met');
  assert.equal(evaluation.metrics.previous_anxiety_followup.status, 'not_met');
  assert.equal(evaluation.metrics.specific_praise.status, 'met');
  assert.equal(evaluation.metrics.next_small_goal_setting.status, 'met');
  assert.equal(evaluation.metrics.previous_small_goal_review.status, 'not_applicable');
});

test('rejects opening checks whose evidence occurs only after the opening window', () => {
  const transcript = `${'通常の会話です。'.repeat(220)}不安なことはありますか？`;
  const evaluation = validateMinutesQualityEvaluation(
    {
      opening_anxiety_check: {
        status: 'met',
        evidence: '不安なことはありますか？'
      }
    },
    transcript
  );

  assert.equal(evaluation.metrics.opening_anxiety_check.status, 'not_met');
  assert.match(evaluation.metrics.opening_anxiety_check.evidence, /レッスン冒頭/);
});
