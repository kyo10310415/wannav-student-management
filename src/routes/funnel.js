import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';
import { buildFunnelData } from '../services/funnelService.js';

const app = new Hono();

async function requireLeaderOrAdmin(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!sessionToken) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const sessionResult = await query(
    `SELECT u.role
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

  await next();
}

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
    const [studentsResult, tutorsResult, reservationsResult, completedResult] = await Promise.all([
      query(`
        SELECT student_id, status, contract_plan, homeroom_tutor, lesson_start_date,
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

    const data = buildFunnelData({
      students: studentsResult.rows,
      tutors: tutorsResult.rows,
      reservationRows: reservationsResult.rows,
      completedRows: completedResult.rows,
      surveyRecords,
      surveyAvailable,
      year,
      month
    });

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
