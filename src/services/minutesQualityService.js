/**
 * 議事録から評価するレッスン品質指標の共通定義・正規化・月次集計。
 */

export const MINUTES_QUALITY_METRICS = [
  {
    key: 'opening_anxiety_check',
    label: 'レッスン冒頭の不安確認',
    monthlyLabel: 'レッスン冒頭の不安確認実施率',
    targetRate: 90,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515425',
    allowNotApplicable: false
  },
  {
    key: 'anxiety_content_record',
    label: '不安内容の記録',
    monthlyLabel: '不安内容の記録率',
    targetRate: 90,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515426',
    allowNotApplicable: false
  },
  {
    key: 'previous_anxiety_followup',
    label: '前回の不安の確認',
    monthlyLabel: 'レッスンでの前回不安確認率',
    targetRate: 80,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515427',
    allowNotApplicable: true
  },
  {
    key: 'specific_praise',
    label: '具体的称賛',
    monthlyLabel: '具体的称賛の実施率',
    targetRate: 90,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515428',
    allowNotApplicable: false
  },
  {
    key: 'next_small_goal_setting',
    label: '次回レッスンまでの小目標設定',
    monthlyLabel: '次回小目標設定率',
    targetRate: 95,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515429',
    allowNotApplicable: false
  },
  {
    key: 'previous_small_goal_review',
    label: '前回決めた小目標の確認',
    monthlyLabel: 'レッスンでの小目標振り返り率',
    targetRate: 85,
    asanaUrl: 'https://app.asana.com/1/1209158858248774/task/1217705044515430',
    allowNotApplicable: true
  }
];

const MET_STATUS = 'met';
const NOT_MET_STATUS = 'not_met';
const NOT_APPLICABLE_STATUS = 'not_applicable';

function normalizeStatus(value, allowNotApplicable) {
  if (value === true || value === 1) return MET_STATUS;
  if (value === false || value === 0) return NOT_MET_STATUS;

  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (['met', 'achieved', 'yes', 'true', '実施', '達成', 'できている'].includes(normalized)) {
    return MET_STATUS;
  }
  if (
    allowNotApplicable &&
    ['not_applicable', 'n/a', 'na', '対象外', '該当なし'].includes(normalized)
  ) {
    return NOT_APPLICABLE_STATUS;
  }
  return NOT_MET_STATUS;
}

function cleanText(value, maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseEvaluation(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanPreviousTarget(value) {
  return cleanText(value)
    .replace(/^[-*・\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmptyPreviousTarget(value) {
  const normalized = cleanPreviousTarget(value)
    .normalize('NFKC')
    .replace(/[\s。．.！!？?]/g, '')
    .toLowerCase();
  return !normalized || [
    'なし',
    '特になし',
    '該当なし',
    'ありません',
    '特にありません',
    '未設定',
    'n/a',
    'na',
    '-'
  ].includes(normalized);
}

function extractPreviousNextAction(generatedText) {
  const match = String(generatedText || '').match(
    /(?:^|\n)#{1,6}\s*ネクストアクション・ミッション\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/
  );
  const value = cleanPreviousTarget(match?.[1]);
  return isEmptyPreviousTarget(value) ? null : value;
}

/**
 * 前回項目の対象有無をAIに推測させず、保存済みの構造化値から確定する。
 * 品質評価導入前の議事録だけは、本文のネクストアクション欄を互換用に利用する。
 */
export function getPreviousMinutesQualityTargets(previousMinutesContext) {
  if (!previousMinutesContext) {
    return { anxietyContent: null, smallGoal: null };
  }

  const rawEvaluation = parseEvaluation(previousMinutesContext.quality_evaluation);
  if (rawEvaluation && isVerifiedMinutesQualityEvaluation(rawEvaluation)) {
    const evaluation = normalizeMinutesQualityEvaluation(rawEvaluation);
    const anxietyMetric = evaluation.metrics.anxiety_content_record;
    const goalMetric = evaluation.metrics.next_small_goal_setting;
    const anxietyContent = anxietyMetric.status === MET_STATUS
      && !isEmptyPreviousTarget(anxietyMetric.value)
      ? cleanPreviousTarget(anxietyMetric.value)
      : null;
    const smallGoal = goalMetric.status === MET_STATUS
      && !isEmptyPreviousTarget(goalMetric.value)
      ? cleanPreviousTarget(goalMetric.value)
      : null;

    return { anxietyContent, smallGoal };
  }

  return {
    anxietyContent: null,
    smallGoal: extractPreviousNextAction(previousMinutesContext.generated_text)
  };
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
}

function cleanEvidenceQuote(value) {
  return cleanText(value)
    .replace(/^["'「『【]+/, '')
    .replace(/["'」』】]+$/, '')
    .trim();
}

function getOpeningTranscript(transcript) {
  const text = String(transcript || '');
  const openingLength = Math.min(
    text.length,
    Math.max(1200, Math.min(6000, Math.ceil(text.length * 0.2)))
  );
  return text.slice(0, openingLength);
}

const OPENING_METRIC_KEYS = new Set([
  'opening_anxiety_check',
  'anxiety_content_record',
  'previous_anxiety_followup',
  'previous_small_goal_review'
]);

function downgradeMetric(metric, message) {
  metric.status = NOT_MET_STATUS;
  metric.evidence = message;
}

/**
 * AIの評価を保存する前に、根拠引用と対象外判定を決定論的に検証する。
 */
export function validateMinutesQualityEvaluation(
  rawEvaluation,
  transcript,
  previousTargets = { anxietyContent: null, smallGoal: null }
) {
  const evaluation = normalizeMinutesQualityEvaluation(rawEvaluation);
  const fullTranscript = normalizeComparableText(transcript);
  const openingTranscript = normalizeComparableText(getOpeningTranscript(transcript));
  const safePreviousTargets = previousTargets || {};
  const targetByMetric = {
    previous_anxiety_followup: safePreviousTargets.anxietyContent || null,
    previous_small_goal_review: safePreviousTargets.smallGoal || null
  };

  for (const definition of MINUTES_QUALITY_METRICS) {
    const metric = evaluation.metrics[definition.key];

    if (definition.key in targetByMetric) {
      const target = targetByMetric[definition.key];
      if (!target) {
        metric.status = NOT_APPLICABLE_STATUS;
        metric.evidence = '';
        metric.value = '';
        continue;
      }
      if (metric.status === NOT_APPLICABLE_STATUS) {
        downgradeMetric(metric, '前回の確認対象があるため対象外にはできません');
      }
    }

    if (metric.status !== MET_STATUS) continue;

    const evidence = cleanEvidenceQuote(metric.evidence);
    const comparableEvidence = normalizeComparableText(evidence);
    const hasGroundedEvidence = comparableEvidence.length >= 6
      && fullTranscript.includes(comparableEvidence);
    if (!hasGroundedEvidence) {
      downgradeMetric(metric, '達成根拠となる発言を文字起こし原文で確認できませんでした');
      continue;
    }

    if (
      OPENING_METRIC_KEYS.has(definition.key)
      && !openingTranscript.includes(comparableEvidence)
    ) {
      downgradeMetric(metric, '達成根拠となる発言をレッスン冒頭で確認できませんでした');
      continue;
    }

    metric.evidence = evidence;
  }

  if (evaluation.metrics.opening_anxiety_check.status !== MET_STATUS) {
    downgradeMetric(
      evaluation.metrics.anxiety_content_record,
      '冒頭の不安確認が確認できないため、不安内容の記録も未達成です'
    );
  } else if (
    evaluation.metrics.anxiety_content_record.status === MET_STATUS
    && !evaluation.metrics.anxiety_content_record.value
  ) {
    downgradeMetric(
      evaluation.metrics.anxiety_content_record,
      '不安内容または「特になし」が記録されていません'
    );
  }

  if (
    evaluation.metrics.next_small_goal_setting.status === MET_STATUS
    && isEmptyPreviousTarget(evaluation.metrics.next_small_goal_setting.value)
  ) {
    downgradeMetric(
      evaluation.metrics.next_small_goal_setting,
      '具体的な小目標が記録されていません'
    );
  }

  return {
    version: 2,
    evaluationMethod: 'transcript_grounded_v2',
    metrics: evaluation.metrics
  };
}

/**
 * 通常のレッスンは全文を渡す。上限を超える場合も先頭偏重にせず、
 * 冒頭・中盤・終盤から等間隔に原文を抽出する。
 */
export function buildTranscriptPromptText(transcript, maxCharacters = 48000, chunkCount = 6) {
  const text = String(transcript || '');
  const safeMaxCharacters = Math.max(2, Math.floor(Number(maxCharacters) || 48000));
  if (text.length <= safeMaxCharacters) return text;

  const safeChunkCount = Math.min(
    safeMaxCharacters,
    Math.max(2, Math.floor(Number(chunkCount) || 6))
  );
  const chunkLength = Math.floor(safeMaxCharacters / safeChunkCount);
  const maxStart = text.length - chunkLength;
  const chunks = [];

  for (let index = 0; index < safeChunkCount; index++) {
    const start = Math.round(index * maxStart / (safeChunkCount - 1));
    chunks.push(text.slice(start, start + chunkLength));
  }

  return chunks.join('\n\n（中略：文字起こしを全体から等間隔で抽出）\n\n');
}

export function normalizeMinutesQualityEvaluation(rawEvaluation) {
  const parsedEvaluation = parseEvaluation(rawEvaluation) || {};
  const rawMetrics = parsedEvaluation.metrics || parsedEvaluation;
  const metrics = {};

  for (const definition of MINUTES_QUALITY_METRICS) {
    const rawMetric = rawMetrics[definition.key] || {};
    metrics[definition.key] = {
      status: normalizeStatus(rawMetric.status ?? rawMetric.achieved, definition.allowNotApplicable),
      evidence: cleanText(rawMetric.evidence),
      value: cleanText(rawMetric.value)
    };
  }

  return {
    version: Number(parsedEvaluation.version) || 1,
    ...(parsedEvaluation.evaluationMethod
      ? { evaluationMethod: parsedEvaluation.evaluationMethod }
      : {}),
    metrics
  };
}

export function isVerifiedMinutesQualityEvaluation(rawEvaluation) {
  const parsedEvaluation = parseEvaluation(rawEvaluation);
  return Number(parsedEvaluation?.version) >= 2;
}

export function aggregateMinutesQualityEvaluations(records) {
  const rows = records || [];
  const evaluatedRows = rows.filter(
    row => isVerifiedMinutesQualityEvaluation(row.quality_evaluation)
  );
  const legacyEvaluationMinutes = rows.filter(
    row => row.quality_evaluation
      && !isVerifiedMinutesQualityEvaluation(row.quality_evaluation)
  ).length;

  const metrics = MINUTES_QUALITY_METRICS.map(definition => {
    let metCount = 0;
    let notMetCount = 0;
    let notApplicableCount = 0;

    for (const row of evaluatedRows) {
      const evaluation = normalizeMinutesQualityEvaluation(row.quality_evaluation);
      const status = evaluation.metrics[definition.key].status;
      if (status === MET_STATUS) metCount++;
      else if (status === NOT_APPLICABLE_STATUS) notApplicableCount++;
      else notMetCount++;
    }

    const applicableCount = metCount + notMetCount;
    const rate = applicableCount > 0 ? metCount / applicableCount * 100 : null;

    return {
      ...definition,
      metCount,
      notMetCount,
      notApplicableCount,
      applicableCount,
      rate,
      targetAchieved: rate === null ? null : rate >= definition.targetRate
    };
  });

  return {
    totalMinutes: rows.length,
    evaluatedMinutes: evaluatedRows.length,
    missingEvaluationMinutes: rows.length - evaluatedRows.length,
    legacyEvaluationMinutes,
    metrics
  };
}

export function getMinutesQualityMetricDefinitions() {
  return MINUTES_QUALITY_METRICS.map(metric => ({ ...metric }));
}
