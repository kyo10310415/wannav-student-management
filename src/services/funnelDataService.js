import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from './cacheService.js';
import { buildFunnelData } from './funnelService.js';

function validateTargetMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100 ||
      !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    throw new Error('対象年月が正しくありません');
  }
  return { year: numericYear, month: numericMonth };
}

async function fetchSurveyRecords() {
  const spreadsheetId = process.env.SATISFACTION_SPREADSHEET_ID ||
    process.env.GOOGLE_CACHE_SHEET_ID ||
    process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    return {
      records: [],
      available: false,
      warning: 'アンケート回答データの接続先が設定されていません'
    };
  }

  try {
    return {
      records: await fetchSatisfactionFromCache(spreadsheetId),
      available: true,
      warning: null
    };
  } catch (error) {
    console.error('[Funnel] Satisfaction data unavailable:', error.message);
    return {
      records: [],
      available: false,
      warning: 'アンケート回答データを取得できませんでした'
    };
  }
}

async function fetchDiscordInsights(targetYearMonth) {
  const latestDiscordScan = await query(
    `SELECT * FROM funnel_discord_scan_jobs
      WHERE year_month = $1 AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1`,
    [targetYearMonth]
  );
  if (!latestDiscordScan.rows[0]) return { available: false };

  const scanJob = latestDiscordScan.rows[0];
  const [bookingChecks, noShowChecks] = await Promise.all([
    query(
      `SELECT student_id, link_sent, scan_status, error_message
         FROM funnel_booking_link_checks WHERE scan_job_id = $1`,
      [scanJob.id]
    ),
    query(
      `SELECT student_id, student_contacted, followup_complete,
              tutor_reminder_sent, scan_status, error_message
         FROM funnel_no_show_followups WHERE scan_job_id = $1`,
      [scanJob.id]
    )
  ]);
  const bookingRows = bookingChecks.rows;
  const noShowRows = noShowChecks.rows;

  return {
    available: true,
    scanJob,
    bookingRows,
    noShowRows,
    bookingLinkSent: bookingRows.filter(row => row.scan_status === 'success' && row.link_sent).length,
    bookingLinkNotSent: bookingRows.filter(row => row.scan_status === 'success' && !row.link_sent).length,
    contactedLater: noShowRows.filter(row => row.scan_status === 'success' && row.student_contacted).length,
    noContactAfterNoShow: noShowRows.filter(row =>
      row.scan_status === 'success' && !row.student_contacted && row.followup_complete
    ).length,
    followupPending: noShowRows.filter(row =>
      row.scan_status === 'success' && !row.student_contacted && !row.followup_complete
    ).length,
    tutorReminderSent: noShowRows.filter(row =>
      row.scan_status === 'success' && row.tutor_reminder_sent
    ).length,
    errorCount: bookingRows.filter(row => row.scan_status === 'error').length +
      noShowRows.filter(row => row.scan_status === 'error').length
  };
}

/**
 * ファネル管理画面・月次スナップショットで共通利用する集計データを取得する。
 */
export async function fetchFunnelDataForMonth(year, month) {
  const target = validateTargetMonth(year, month);
  const startDate = `${target.year}-${String(target.month).padStart(2, '0')}-01`;
  const nextYear = target.month === 12 ? target.year + 1 : target.year;
  const nextMonth = target.month === 12 ? 1 : target.month + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [
    studentsResult,
    tutorsResult,
    reservationsResult,
    completedResult,
    lessonResultsResult,
    lastCompletedResult,
    rebookingResult,
    survey,
    discordInsights
  ] = await Promise.all([
    query(`
      SELECT student_id, name, status, contract_plan, homeroom_tutor, lesson_start_date,
             payment_status_last_month, payment_status_current_month,
             payment_year_month_last, payment_year_month_current
        FROM students
    `),
    query(`
      SELECT employee_id, name, tutor_name, notion_name
        FROM tutors
       WHERE status = 'アクティブ'
         AND job_type ILIKE '%Tutor%'
         AND notion_name IS NOT NULL
         AND notion_name <> ''
       ORDER BY COALESCE(tutor_name, name, notion_name) ASC
    `),
    query(`
      SELECT student_id, COUNT(*)::int AS reservation_count
        FROM lessons
       WHERE lesson_date >= $1::date
         AND lesson_date < $2::date
       GROUP BY student_id
    `, [startDate, nextMonthStart]),
    query(`
      SELECT student_id, COUNT(*)::int AS completion_count
        FROM lesson_reports
       WHERE lesson_date >= $1::date
         AND lesson_date < $2::date
         AND lesson_result = '実施済み'
       GROUP BY student_id
    `, [startDate, nextMonthStart]),
    query(`
      SELECT student_id, lesson_result, COUNT(*)::int AS result_count
        FROM lesson_reports
       WHERE lesson_date >= $1::date
         AND lesson_date < $2::date
       GROUP BY student_id, lesson_result
    `, [startDate, nextMonthStart]),
    query(`
      SELECT student_id, MAX(lesson_date)::date::text AS last_completed_date
        FROM lesson_reports
       WHERE lesson_date < $1::date
         AND lesson_result = '実施済み'
       GROUP BY student_id
    `, [nextMonthStart]),
    query(`
      SELECT cancelled.id AS lesson_report_id,
             cancelled.student_id,
             next_lesson.lesson_date::text AS next_lesson_date,
             next_lesson.lesson_result AS next_lesson_result
        FROM lesson_reports cancelled
        LEFT JOIN LATERAL (
          SELECT l.lesson_date::date AS lesson_date, next_report.lesson_result
            FROM lessons l
            LEFT JOIN lesson_reports next_report
              ON next_report.student_id = l.student_id
             AND next_report.lesson_date = l.lesson_date::date
           WHERE l.student_id = cancelled.student_id
             AND l.lesson_date::date > cancelled.lesson_date
             AND l.lesson_date < $2::date
             AND l.created_at > cancelled.reported_at
           ORDER BY l.lesson_date ASC
           LIMIT 1
        ) next_lesson ON TRUE
       WHERE cancelled.lesson_date >= $1::date
         AND cancelled.lesson_date < $2::date
         AND cancelled.lesson_result = '生徒様都合でリスケ'
    `, [startDate, nextMonthStart]),
    fetchSurveyRecords(),
    fetchDiscordInsights(`${target.year}-${String(target.month).padStart(2, '0')}`)
  ]);

  const data = buildFunnelData({
    students: studentsResult.rows,
    tutors: tutorsResult.rows,
    reservationRows: reservationsResult.rows,
    completedRows: completedResult.rows,
    lessonResultRows: lessonResultsResult.rows,
    rebookingRows: rebookingResult.rows,
    discordInsights,
    lastCompletedRows: lastCompletedResult.rows,
    surveyRecords: survey.records,
    surveyAvailable: survey.available,
    year: target.year,
    month: target.month
  });
  data.discordScan = discordInsights.available ? discordInsights.scanJob : null;

  return {
    data,
    warnings: survey.warning ? [survey.warning] : []
  };
}
