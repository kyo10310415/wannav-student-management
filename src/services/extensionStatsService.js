// Matches extended-management: rounds 1–3 use lesson months, 4–6 use PRO months.
export const EXTENSION_ROUNDS = [
  { round: 1, key: 'exam1st', month: 5 },
  { round: 2, key: 'exam2nd', month: 11 },
  { round: 3, key: 'exam3rd', month: 17 },
  { round: 4, key: 'exam4th', month: 5, pro: true },
  { round: 5, key: 'exam5th', month: 11, pro: true },
  { round: 6, key: 'exam6th', month: 17, pro: true }
];

export function proPlanMonths(startDate, referenceDate = new Date()) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (!Number.isFinite(start.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric'
  }).formatToParts(referenceDate).map(p => [p.type, p.value]));
  const months = (Number(parts.year) - start.getUTCFullYear()) * 12 + Number(parts.month) - start.getUTCMonth();
  return months > 0 ? months : null;
}

const rate = (count, total) => total > 0 ? Math.round(count / total * 1000) / 10 : 0;

export function aggregateExtensionStats(students, extensions, referenceDate = new Date()) {
  const data = new Map(extensions.map(row => [row.student_id, row]));
  const stats = { targetCount: 0, certaintyFilledCount: 0, extensionCount: 0,
    withdrawalCount: 0, lifetimeCount: 0, extensionRate: 0, extensionRateVsResult: 0,
    remainingCount: 0, resultToldCount: 0 };
  const tutors = new Map();
  const teams = new Map();
  for (const definition of EXTENSION_ROUNDS) {
    stats[definition.key] = { targetCount: 0, extensionCount: 0, extensionRate: 0, lifetimeCount: 0 };
  }
  for (const student of students) {
    const ext = data.get(student.student_id) || {};
    const teamName = student.team || '未所属';
    if (!teams.has(teamName)) {
      const team = { teamName, targetCount: 0, extensionCount: 0, withdrawalCount: 0, lifetimeCount: 0, extensionRate: 0 };
      for (const { key } of EXTENSION_ROUNDS) {
        team[`${key}TargetCount`] = 0;
        team[`${key}ExtensionCount`] = 0;
        team[`${key}ExtensionRate`] = 0;
      }
      teams.set(teamName, team);
    }
    const team = teams.get(teamName);
    let tutor;
    if (student.homeroom_tutor) {
      if (!tutors.has(student.homeroom_tutor)) tutors.set(student.homeroom_tutor, {
        tutorName: student.homeroom_tutor, hearingTargetCount: 0, examTargetCount: 0,
        hearingIncompleteCount: 0, examIncompleteCount: 0
      });
      tutor = tutors.get(student.homeroom_tutor);
    }
    const proMonths = proPlanMonths(student.pro_plan_start_date, referenceDate);
    for (const { round, key, month, pro } of EXTENSION_ROUNDS) {
      const months = pro ? proMonths : Number(student.continued_months);
      if (months === month - 1) {
        const certainty = ext[`extension_certainty_${round}`];
        if (certainty && certainty !== '対象外') stats.certaintyFilledCount++;
        if (tutor) {
          tutor.hearingTargetCount++;
          if (!ext[`hearing_status_${round}`]) tutor.hearingIncompleteCount++;
        }
      }
      if (months !== month) continue;
      const result = ext[`examination_result_${round}`];
      stats.targetCount++;
      stats[key].targetCount++;
      team.targetCount++;
      team[`${key}TargetCount`]++;
      if (tutor) {
        tutor.examTargetCount++;
        if (!result) tutor.examIncompleteCount++;
      }
      if (result) stats.resultToldCount++;
      if (result === '延長') {
        stats.extensionCount++;
        stats[key].extensionCount++;
        team.extensionCount++;
        team[`${key}ExtensionCount`]++;
      } else if (round >= 3 && result === '永久会員') {
        stats.lifetimeCount++;
        stats[key].lifetimeCount++;
        team.lifetimeCount++;
      } else if (result === '退会') {
        stats.withdrawalCount++;
        team.withdrawalCount++;
      }
      // Preserve the existing round 1/2 residual calculation; later rounds count blanks.
      if (round <= 2 ? result !== '延長' && result !== '退会' : !String(result || '').trim()) stats.remainingCount++;
    }
  }
  stats.extensionRate = rate(stats.extensionCount, stats.targetCount);
  stats.extensionRateVsResult = rate(stats.extensionCount, stats.resultToldCount);
  for (const { key } of EXTENSION_ROUNDS) {
    stats[key].extensionRate = rate(stats[key].extensionCount, stats[key].targetCount);
    for (const team of teams.values()) team[`${key}ExtensionRate`] = rate(team[`${key}ExtensionCount`], team[`${key}TargetCount`]);
  }
  for (const team of teams.values()) team.extensionRate = rate(team.extensionCount, team.targetCount);
  return { stats, tutors: [...tutors.values()].sort((a, b) => b.hearingTargetCount - a.hearingTargetCount),
    teams: [...teams.values()].sort((a, b) => b.targetCount - a.targetCount) };
}
