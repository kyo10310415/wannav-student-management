/**
 * 旧形式ジョブの対象者を既存ログと保存済み進捗から分類する。
 * 成功済みは再送せず、失敗は再試行対象にする。中断ジョブでは、保存済みの
 * 処理範囲内にあるログ欠落者と、その直後の1名を送達不明として保護する。
 */
export function classifyLegacyBroadcastRecipients(targets, logRows, job) {
  const logMap = new Map(logRows.map(row => [String(row.student_id), row]));
  const highestLoggedIndex = targets.reduce((highest, student, index) => (
    logMap.has(String(student.student_id)) ? index : highest
  ), -1);
  const processedPrefixLength = Math.min(
    targets.length,
    Math.max(Number(job.sent || 0) + Number(job.failed || 0), highestLoggedIndex + 1)
  );

  return targets.map((student, index) => {
    const studentId = String(student.student_id);
    const log = logMap.get(studentId);
    let status = 'pending';

    if (log?.was_sent) {
      status = 'sent';
    } else if (log?.was_failed) {
      status = 'failed';
    } else if (
      job.status === 'interrupted' &&
      (index < processedPrefixLength || index === processedPrefixLength)
    ) {
      status = 'unknown';
    }

    return {
      student_id: studentId,
      student_name: student.name || null,
      status
    };
  });
}
