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
  const rawMetrics = rawEvaluation?.metrics || rawEvaluation || {};
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
    version: 1,
    metrics
  };
}

export function aggregateMinutesQualityEvaluations(records) {
  const rows = records || [];
  const evaluatedRows = rows.filter(row => row.quality_evaluation);

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
    metrics
  };
}

export function getMinutesQualityMetricDefinitions() {
  return MINUTES_QUALITY_METRICS.map(metric => ({ ...metric }));
}
