import { query } from '../db/connection.js';
import { fetchLessonCompletionStatus } from './cacheService.js';
import { normalizeStudentId } from './tutorSatisfactionService.js';

const CACHE_DURATION = 60 * 60 * 1000;
let spreadsheetCompletionCache = null;
let spreadsheetCompletionCacheTime = 0;
let spreadsheetCompletionCachePromise = null;

function toDateString(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

async function getSpreadsheetCompletionCache() {
  const spreadsheetId = process.env.PROGRESS_SPREADSHEET_ID;
  if (!spreadsheetId) return null;

  const now = Date.now();
  if (!spreadsheetCompletionCache || now - spreadsheetCompletionCacheTime >= CACHE_DURATION) {
    if (!spreadsheetCompletionCachePromise) {
      spreadsheetCompletionCachePromise = fetchLessonCompletionStatus(spreadsheetId)
        .then(cache => {
          spreadsheetCompletionCache = cache;
          spreadsheetCompletionCacheTime = Date.now();
          return cache;
        })
        .finally(() => {
          spreadsheetCompletionCachePromise = null;
        });
    }
    await spreadsheetCompletionCachePromise;
  }

  return spreadsheetCompletionCache;
}

function findSpreadsheetCompletion(cache, studentId, lessonDate) {
  if (!cache) return null;

  const normalizedId = normalizeStudentId(studentId);
  let fallback = null;

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const checkDate = new Date(`${lessonDate}T00:00:00`);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    const checkDateStr = [
      checkDate.getFullYear(),
      String(checkDate.getMonth() + 1).padStart(2, '0'),
      String(checkDate.getDate()).padStart(2, '0')
    ].join('-');
    const data = cache.get(`${normalizedId}_${checkDateStr}`);

    if (data?.completed) return data;
    if (!fallback && data) fallback = data;
  }

  return fallback;
}

/**
 * Resolve completion for the same student/date pairs used by the reservation page.
 * lesson_reports is authoritative; the progress spreadsheet is the fallback.
 */
export async function resolveLessonCompletionItems(items) {
  const normalizedItems = [];
  const uniqueItems = [];
  const seen = new Set();

  for (const item of items || []) {
    const studentId = item.studentId;
    const lessonDate = toDateString(item.lessonDate);
    if (!studentId || !lessonDate) continue;
    normalizedItems.push({ studentId, lessonDate });
    const key = `${studentId}_${lessonDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push({ studentId, lessonDate });
  }

  if (uniqueItems.length === 0) return [];

  const studentIds = [...new Set(uniqueItems.map(item => item.studentId))];
  const lessonDates = [...new Set(uniqueItems.map(item => item.lessonDate))];
  const reportsByKey = new Map();
  try {
    const reportResult = await query(
      `SELECT student_id, lesson_date, lesson_result, reported_at
         FROM lesson_reports
        WHERE student_id = ANY($1::text[])
          AND lesson_date::date = ANY($2::date[])`,
      [studentIds, lessonDates]
    );

    for (const row of reportResult.rows) {
      const lessonDate = toDateString(row.lesson_date);
      if (lessonDate) reportsByKey.set(`${row.student_id}_${lessonDate}`, row);
    }
  } catch (error) {
    console.error('[Lesson Completion] Database lookup failed, using spreadsheet fallback:', error.message);
  }

  let spreadsheetCache = null;
  try {
    spreadsheetCache = await getSpreadsheetCompletionCache();
  } catch (error) {
    console.error('[Lesson Completion] Failed to load spreadsheet fallback:', error.message);
  }

  return normalizedItems.map(item => {
    const report = reportsByKey.get(`${item.studentId}_${item.lessonDate}`);
    if (report) {
      return {
        ...item,
        completed: report.lesson_result === '実施済み',
        lessonResult: report.lesson_result,
        timestamp: report.reported_at,
        source: 'database'
      };
    }

    const fallback = findSpreadsheetCompletion(spreadsheetCache, item.studentId, item.lessonDate);
    if (fallback) {
      return {
        ...item,
        completed: fallback.completed,
        lessonResult: fallback.lessonResult,
        timestamp: fallback.timestamp,
        source: 'spreadsheet'
      };
    }

    return {
      ...item,
      completed: false,
      lessonResult: null,
      timestamp: null,
      source: 'none'
    };
  });
}

export async function getCompletedStudentIdsForMonth(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) {
    throw new Error('yearMonth is required (format: YYYY-MM)');
  }

  const [year, month] = yearMonth.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const lessonsResult = await query(
    `SELECT DISTINCT student_id, TO_CHAR(lesson_date, 'YYYY-MM-DD') AS lesson_date
       FROM lessons
      WHERE lesson_date >= $1::date
        AND lesson_date < $2::date
        AND student_id IS NOT NULL
        AND student_id <> ''`,
    [startDate, endDate]
  );

  const items = lessonsResult.rows.map(row => ({
    studentId: row.student_id,
    lessonDate: row.lesson_date
  }));
  const results = await resolveLessonCompletionItems(items);
  const completedStudentIds = [...new Set(
    results
      .filter(result => result.completed)
      .map(result => normalizeStudentId(result.studentId))
  )];

  return {
    yearMonth,
    completedStudentIds,
    scheduledStudentIds: [...new Set(items.map(item => normalizeStudentId(item.studentId)))],
    checkedLessonCount: results.length
  };
}
