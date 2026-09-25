import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';
import { buildFunnelData } from '../services/funnelService.js';
import {
  getFunnelDiscordScanJob,
  startFunnelDiscordScan
} from '../services/funnelDiscordService.js';

const app = new Hono();

async function requireLeaderOrAdmin(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!sessionToken) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const sessionResult = await query(
    `SELECT u.role, u.email
       FROM sessions s
       JOIN users u ON s.user_id = u.id
      WHERE s.session_token = $1
        AND s.expires_at > NOW()`,
    [sessionToken]
  );

  if (sessionResult.rows.length === 0) {
    return c.json({ success: false, error: 'セッションが無効です' }, 401);
  }
  if (!['admin', 'leader'].includes(sessionResult.rows[0].role)) {
    return c.json({ success: false, error: 'リーダー以上の権限が必要です' }, 403);
  }

  c.set('currentUser', sessionResult.rows[0]);

  await next();
}

app.post('/discord-scan', requireLeaderOrAdmin, async (c) => {
  try {
    const { year, month } = await c.req.json();
    if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12) {
      return c.json({ success: false, error: '対象年月が正しくありません' }, 400);
    }
    const job = await startFunnelDiscordScan({
      year: Number(year),
      month: Number(month),
      createdBy: c.get('currentUser')?.email
    });
    return c.json({ success: true, data: job }, 202);
  } catch (error) {
    console.error('[Funnel] Failed to start Discord scan:', error);
    return c.json({ success: false, error: `Discord状況の更新を開始できませんでした: ${error.message}` }, 500);
  }
});

app.get('/discord-scan/:jobId', requireLeaderOrAdmin, async (c) => {
  try {
    const job = await getFunnelDiscordScanJob(c.req.param('jobId'));
    if (!job) return c.json({ success: false, error: '更新ジョブが見つかりません' }, 404);
    return c.json({ success: true, data: job });
  } catch (error) {
    console.error('[Funnel] Failed to get Discord scan status:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/', requireLeaderOrAdmin, async (c) => {
  const year = Number(c.req.query('year'));
  const month = Number(c.req.query('month'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ success: false, error: '対象年月が正しくありません' }, 400);
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  try {
    const [
      studentsResult,
      tutorsResult,
      reservationsResult,
      completedResult,
      lessonResultsResult,
      lastCompletedResult,
      rebookingResult
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
      `, [nextMonthStart])
      ,
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
      `, [startDate, nextMonthStart])
    ]);

    let surveyRecords = [];
    let surveyAvailable = true;
    let surveyWarning = null;
    const spreadsheetId = process.env.SATISFACTION_SPREADSHEET_ID ||
      process.env.GOOGLE_CACHE_SHEET_ID ||
      process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      surveyAvailable = false;
      surveyWarning = 'アンケート回答データの接続先が設定されていません';
    } else {
      try {
        surveyRecords = await fetchSatisfactionFromCache(spreadsheetId);
      } catch (error) {
        surveyAvailable = false;
        surveyWarning = 'アンケート回答データを取得できませんでした';
        console.error('[Funnel] Satisfaction data unavailable:', error.message);
      }
    }

    const targetYearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const latestDiscordScan = await query(
      `SELECT * FROM funnel_discord_scan_jobs
        WHERE year_month = $1 AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1`,
      [targetYearMonth]
    );
    let discordInsights = { available: false };
    if (latestDiscordScan.rows[0]) {
      const scanJob = latestDiscordScan.rows[0];
      const [bookingChecks, noShowChecks] = await Promise.all([
        query(
          `SELECT
             student_id, link_sent, scan_status, error_message
           FROM funnel_booking_link_checks WHERE scan_job_id = $1`,
          [scanJob.id]
        ),
        query(
          `SELECT
             student_id, student_contacted, followup_complete,
             tutor_reminder_sent, scan_status, error_message
           FROM funnel_no_show_followups WHERE scan_job_id = $1`,
          [scanJob.id]
        )
      ]);
      const bookingRows = bookingChecks.rows;
      const noShowRows = noShowChecks.rows;
      discordInsights = {
        available: true,
        scanJob,
        bookingRows,
        noShowRows,
        bookingLinkSent: bookingRows.filter(row => row.scan_status === 'success' && row.link_sent).length,
        bookingLinkNotSent: bookingRows.filter(row => row.scan_status === 'success' && !row.link_sent).length,
        contactedLater: noShowRows.filter(row => row.scan_status === 'success' && row.student_contacted).length,
        noContactAfterNoShow: noShowRows.filter(row => row.scan_status === 'success' && !row.student_contacted && row.followup_complete).length,
        followupPending: noShowRows.filter(row => row.scan_status === 'success' && !row.student_contacted && !row.followup_complete).length,
        tutorReminderSent: noShowRows.filter(row => row.scan_status === 'success' && row.tutor_reminder_sent).length,
        errorCount: bookingRows.filter(row => row.scan_status === 'error').length +
          noShowRows.filter(row => row.scan_status === 'error').length
      };
    }

    const data = buildFunnelData({
      students: studentsResult.rows,
      tutors: tutorsResult.rows,
      reservationRows: reservationsResult.rows,
      completedRows: completedResult.rows,
      lessonResultRows: lessonResultsResult.rows,
      rebookingRows: rebookingResult.rows,
      discordInsights,
      lastCompletedRows: lastCompletedResult.rows,
      surveyRecords,
      surveyAvailable,
      year,
      month
    });
    data.discordScan = discordInsights.available ? discordInsights.scanJob : null;

    return c.json({
      success: true,
      data,
      warnings: surveyWarning ? [surveyWarning] : []
    });
  } catch (error) {
    console.error('[Funnel] Failed to build funnel:', error);
    return c.json({ success: false, error: `ファネルデータの取得に失敗しました: ${error.message}` }, 500);
  }
});

export default app;
