import { Hono } from 'hono';
import { query } from '../db/connection.js';

const app = new Hono();

// ─────────────────────────────────────────────
// GET /api/daily-reports/tutors
// アクティブTutor一覧＋最新日報提出日（役職=クルーのみ）
// ─────────────────────────────────────────────
app.get('/tutors', async (c) => {
  try {
    const result = await query(`
      SELECT
        t.id          AS tutor_id,
        t.tutor_name,
        t.team,
        t.status,
        t.job_type,
        u.job_title,
        MAX(dr.report_date) AS latest_report_date
      FROM tutors t
      LEFT JOIN daily_reports dr ON dr.tutor_id = t.id
      LEFT JOIN users u ON LOWER(t.email) = LOWER(u.email)
      WHERE t.status = 'アクティブ'
        AND t.job_type ILIKE '%tutor%'
        AND u.job_title = 'クルー'
      GROUP BY t.id, t.tutor_name, t.team, t.status, t.job_type, u.job_title
      ORDER BY t.team, t.tutor_name
    `);
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[DailyReports] GET /tutors error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// GET /api/daily-reports/reminder-setting
// 通知ON/OFF設定を取得
// ─────────────────────────────────────────────
app.get('/reminder-setting', async (c) => {
  try {
    const result = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'daily_report_reminder_enabled'`
    );
    const enabled = result.rows[0]?.setting_value !== 'false';
    return c.json({ success: true, enabled });
  } catch (error) {
    console.error('[DailyReports] GET /reminder-setting error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// PUT /api/daily-reports/reminder-setting
// 通知ON/OFFを更新
// Body: { enabled: true|false }
// ─────────────────────────────────────────────
app.put('/reminder-setting', async (c) => {
  try {
    const { enabled } = await c.req.json();
    await query(
      `UPDATE system_settings SET setting_value = $1, updated_at = NOW()
       WHERE setting_key = 'daily_report_reminder_enabled'`,
      [enabled ? 'true' : 'false']
    );
    console.log(`[DailyReports] reminder-setting updated: ${enabled}`);
    return c.json({ success: true, enabled: !!enabled });
  } catch (error) {
    console.error('[DailyReports] PUT /reminder-setting error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// GET /api/daily-reports/tutor/:tutorId
// 特定Tutorの日報一覧（コメント付き、新しい順）
// ─────────────────────────────────────────────
app.get('/tutor/:tutorId', async (c) => {
  const { tutorId } = c.req.param();
  const limit  = parseInt(c.req.query('limit')  || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    // 日報一覧
    const reportsResult = await query(`
      SELECT
        dr.id,
        dr.tutor_id,
        dr.report_date,
        dr.content,
        dr.submitted_at,
        dr.created_at,
        t.tutor_name,
        t.team
      FROM daily_reports dr
      JOIN tutors t ON t.id = dr.tutor_id
      WHERE dr.tutor_id = $1
      ORDER BY dr.report_date DESC
      LIMIT $2 OFFSET $3
    `, [tutorId, limit, offset]);

    // 合計件数
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM daily_reports WHERE tutor_id = $1`,
      [tutorId]
    );

    // 各日報のコメント
    const reportIds = reportsResult.rows.map(r => r.id);
    let commentsMap = {};
    if (reportIds.length > 0) {
      const commentsResult = await query(`
        SELECT
          drc.id,
          drc.report_id,
          drc.content,
          drc.created_at,
          u.email,
          COALESCE(t2.tutor_name, u.email) AS commenter_name,
          u.role AS commenter_role
        FROM daily_report_comments drc
        JOIN users u  ON u.id  = drc.user_id
        LEFT JOIN tutors t2 ON LOWER(t2.email) = LOWER(u.email)
        WHERE drc.report_id = ANY($1::int[])
        ORDER BY drc.created_at ASC
      `, [reportIds]);

      commentsResult.rows.forEach(cm => {
        if (!commentsMap[cm.report_id]) commentsMap[cm.report_id] = [];
        commentsMap[cm.report_id].push(cm);
      });
    }

    const reports = reportsResult.rows.map(r => ({
      ...r,
      comments: commentsMap[r.id] || []
    }));

    return c.json({
      success: true,
      data: reports,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (error) {
    console.error('[DailyReports] GET /tutor/:tutorId error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// POST /api/daily-reports
// 日報提出（upsert: 同じtutor_id+report_dateなら更新）
// Body: { tutor_id, report_date, content }
// ─────────────────────────────────────────────
app.post('/', async (c) => {
  try {
    const { tutor_id, report_date, content } = await c.req.json();

    if (!tutor_id || !report_date || !content?.trim()) {
      return c.json({ success: false, error: '必須項目が不足しています' }, 400);
    }

    const result = await query(`
      INSERT INTO daily_reports (tutor_id, report_date, content, submitted_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (tutor_id, report_date)
      DO UPDATE SET
        content      = EXCLUDED.content,
        submitted_at = NOW(),
        updated_at   = NOW()
      RETURNING *
    `, [tutor_id, report_date, content.trim()]);

    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[DailyReports] POST / error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// DELETE /api/daily-reports/:id
// 日報削除（admin/leader のみ想定）
// ─────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const { id } = c.req.param();
  try {
    await query(`DELETE FROM daily_reports WHERE id = $1`, [id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('[DailyReports] DELETE /:id error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// POST /api/daily-reports/:id/comments
// コメント投稿
// Body: { user_id, content }
// ─────────────────────────────────────────────
app.post('/:id/comments', async (c) => {
  const { id } = c.req.param();
  try {
    const { user_id, content } = await c.req.json();

    if (!user_id || !content?.trim()) {
      return c.json({ success: false, error: '必須項目が不足しています' }, 400);
    }

    const result = await query(`
      INSERT INTO daily_report_comments (report_id, user_id, content)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, user_id, content.trim()]);

    // コメント投稿者名を付与して返す
    const commentRow = result.rows[0];
    const userResult = await query(`
      SELECT u.email, u.role,
             COALESCE(t.tutor_name, u.email) AS commenter_name
      FROM users u
      LEFT JOIN tutors t ON LOWER(t.email) = LOWER(u.email)
      WHERE u.id = $1
    `, [user_id]);

    const user = userResult.rows[0] || {};
    return c.json({
      success: true,
      data: {
        ...commentRow,
        commenter_name: user.commenter_name || '',
        commenter_role: user.role || ''
      }
    });
  } catch (error) {
    console.error('[DailyReports] POST /:id/comments error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// DELETE /api/daily-reports/comments/:commentId
// コメント削除
// ─────────────────────────────────────────────
app.delete('/comments/:commentId', async (c) => {
  const { commentId } = c.req.param();
  try {
    await query(`DELETE FROM daily_report_comments WHERE id = $1`, [commentId]);
    return c.json({ success: true });
  } catch (error) {
    console.error('[DailyReports] DELETE /comments/:commentId error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// GET /api/daily-reports/check/:tutorId/:date
// 特定日の日報提出有無確認
// ─────────────────────────────────────────────
app.get('/check/:tutorId/:date', async (c) => {
  const { tutorId, date } = c.req.param();
  try {
    const result = await query(
      `SELECT id FROM daily_reports WHERE tutor_id = $1 AND report_date = $2 LIMIT 1`,
      [tutorId, date]
    );
    return c.json({ success: true, submitted: result.rows.length > 0 });
  } catch (error) {
    console.error('[DailyReports] GET /check error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
