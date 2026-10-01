import { exportFunnelSnapshotForMonth } from '../services/funnelSheetExportService.js';

export function getJstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

export function isLastDayOfMonth(year, month, day) {
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 毎月末に、当月のファネル管理データを月次列として保存する。 */
export async function monthlyFunnelSnapshot(now = new Date()) {
  const target = getJstDateParts(now);
  if (!isLastDayOfMonth(target.year, target.month, target.day)) {
    return { success: true, skipped: true, reason: 'not_last_day' };
  }

  const result = await exportFunnelSnapshotForMonth(target.year, target.month);
  return { success: true, skipped: false, ...result };
}
