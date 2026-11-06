import { getSheets } from './sheetsService.js';

export const GROUP_LESSON_SURVEYS = [
  { spreadsheetId: '1GhGJaaF6oJ5QWSLzv8p932NUh9sTf2hBIbnh4sBt1fY', sheet: 'フォームの回答 1', idColumn: 'F' },
  { spreadsheetId: '1q5LE3HUYw7Ls3FGoW1cu__WPpJoHzwwgYh7CUJdQyuA', sheet: 'フォームの回答 1', idColumn: 'D' }
];
export const normalizeAttendanceStudentId = value => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '').replace(/[－‐‑–—]/g, '-').toUpperCase();

// Sheets numeric dates represent local wall-clock time, not a UTC instant.
export function parseAttendanceTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const time = Date.UTC(1899, 11, 30) + value * 86400000 - 9 * 3600000;
    return Number.isFinite(time) && time >= Date.UTC(2000, 0, 1) && time < Date.UTC(2200, 0, 1) ? new Date(time) : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const civil = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}`;
  const date = new Date(`${civil}+09:00`);
  return Number.isFinite(date.getTime()) && new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 19) === civil ? date : null;
}

export function parseGroupLessonSurvey(valueRanges, yearMonth, now) {
  const [dates, ids] = valueRanges || [];
  if (dates?.values?.[0]?.[0]?.trim() !== 'タイムスタンプ' || ids?.values?.[0]?.[0]?.trim() !== '学籍番号') throw new Error('Group lesson survey headers do not match');
  const attended = new Set(), unknown = new Set();
  const [year, month] = yearMonth.split('-').map(Number);
  const start = new Date(`${yearMonth}-01T00:00:00+09:00`);
  const end = new Date(Date.UTC(year, month, 1) - 9 * 3600000);
  const length = Math.max(dates.values.length, ids.values.length);
  for (let i = 1; i < length; i++) {
    const id = normalizeAttendanceStudentId(ids.values[i]?.[0]);
    if (!id) continue; // Never attribute an unidentified response by student name.
    const date = parseAttendanceTimestamp(dates.values[i]?.[0]);
    if (!date) { unknown.add(id); continue; }
    if (date >= start && date < end && date <= now) attended.add(id);
  }
  return { attended, unknown };
}

export async function fetchGroupLessonAttendance(yearMonth, now = new Date(), sheets = getSheets()) {
  const results = await Promise.allSettled(GROUP_LESSON_SURVEYS.map(async source => {
    const sheet = source.sheet.replace(/'/g, "''");
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: source.spreadsheetId,
      ranges: [`'${sheet}'!A1:A`, `'${sheet}'!${source.idColumn}1:${source.idColumn}`], valueRenderOption: 'UNFORMATTED_VALUE' });
    return parseGroupLessonSurvey(response.data.valueRanges, yearMonth, now);
  }));
  const attended = new Set(), unknown = new Set();
  for (const result of results) if (result.status === 'fulfilled') {
    result.value.attended.forEach(id => attended.add(id));
    result.value.unknown.forEach(id => unknown.add(id));
  }
  return { attended, unknown, complete: results.every(result => result.status === 'fulfilled') };
}
