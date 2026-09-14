import {
  getMinutesAutoGenerateStatus,
  minutesAutoGenerate
} from './minutesAutoGenerate.js';

let backfillState = {
  status: 'idle',
  requestedAt: null,
  startedAt: null,
  completedAt: null,
  startDate: null,
  endDate: null,
  progress: null,
  summary: null,
  error: null
};

export function getMinutesBackfillState() {
  return {
    ...backfillState,
    progress: backfillState.progress ? { ...backfillState.progress } : null,
    summary: backfillState.summary ? { ...backfillState.summary } : null
  };
}

export function startMinutesBackfill({ startDate, endDate }) {
  if (backfillState.status === 'running') {
    return { started: false, reason: 'backfill_running', state: getMinutesBackfillState() };
  }

  const activeRun = getMinutesAutoGenerateStatus();
  if (activeRun) {
    return { started: false, reason: 'generation_running', activeRun };
  }

  const requestedAt = new Date().toISOString();
  backfillState = {
    status: 'running',
    requestedAt,
    startedAt: requestedAt,
    completedAt: null,
    startDate,
    endDate,
    progress: {
      processed: 0,
      total: 0,
      generated: 0,
      qualityUpdated: 0,
      qualityPending: 0,
      skipped: 0,
      errors: 0
    },
    summary: null,
    error: null
  };

  void minutesAutoGenerate({
    runType: 'backfill',
    startDate,
    endDate,
    includeLegacyQuality: true,
    onProgress(progress) {
      backfillState = {
        ...backfillState,
        progress: { ...progress }
      };
    }
  }).then(summary => {
    if (!summary?.success) {
      backfillState = {
        ...backfillState,
        status: 'failed',
        completedAt: new Date().toISOString(),
        summary: summary || null,
        error: summary?.error || 'バックフィルを開始できませんでした'
      };
      return;
    }

    backfillState = {
      ...backfillState,
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: {
        processed: summary.processed,
        total: summary.targets,
        generated: summary.generated,
        qualityUpdated: summary.qualityUpdated,
        qualityPending: summary.qualityPending,
        skipped: summary.skipped,
        errors: summary.errors
      },
      summary,
      error: null
    };
  }).catch(error => {
    console.error('[MinutesBackfill] Fatal error:', error);
    backfillState = {
      ...backfillState,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error?.message || String(error)
    };
  });

  return { started: true, state: getMinutesBackfillState() };
}
