import { Hono } from 'hono';
import { query } from '../db/connection.js';

const app = new Hono();

/**
 * GET /api/handover/students
 * 引き継ぎ管理対象生徒一覧
 * アクティブ かつ 永久会員・休会・在籍プラン以外
 */
app.get('/students', async (c) => {
  try {
    const result = await query(`
      SELECT
        s.id,
        s.name,
        s.student_number,
        s.lesson_progress,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        s.contract_plan,
        s.status,
        s.created_at,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name,
        ha.assigned_at,
        ha.reset_at
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.id
      WHERE
        s.status = 'アクティブ'
        AND s.contract_plan NOT IN ('永久会員', '休会', '在籍プラン')
      ORDER BY s.student_number ASC NULLS LAST, s.name ASC
    `);

    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[Handover] Error fetching students:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * PUT /api/handover/students/:studentId/assignment
 * 引き継ぎ先Tutorを設定／更新
 */
app.put('/students/:studentId/assignment', async (c) => {
  try {
    const studentId = parseInt(c.req.param('studentId'));
    const { handover_tutor_name } = await c.req.json();

    if (isNaN(studentId)) {
      return c.json({ success: false, error: 'Invalid student ID' }, 400);
    }

    // Upsert: insert or update
    const result = await query(
      `INSERT INTO handover_assignments (student_id, handover_tutor_name, assigned_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (student_id)
       DO UPDATE SET
         handover_tutor_name = EXCLUDED.handover_tutor_name,
         assigned_at = NOW(),
         updated_at  = NOW()
       RETURNING *`,
      [studentId, handover_tutor_name || null]
    );

    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[Handover] Error updating assignment:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/handover/tutor-sidebar
 * 右サイドバー用: Tutor名 + 引き継ぎ可能人数
 * 計算式: student_capacity - activeStudents - pendingHandoverCount
 */
app.get('/tutor-sidebar', async (c) => {
  try {
    // 1. すべてのTutorを取得
    const tutorsResult = await query(`
      SELECT
        t.id,
        t.tutor_name,
        t.notion_name,
        t.student_capacity
      FROM tutors t
      WHERE t.tutor_name IS NOT NULL
        AND t.tutor_name <> ''
      ORDER BY t.tutor_name ASC
    `);

    // 2. アクティブ生徒数を notion_name ベースで集計
    //    (students.homeroom_tutor = tutors.notion_name)
    //    永久会員・在籍プランを除外（tutors ページと同じ計算式）
    const activeCountResult = await query(`
      SELECT
        homeroom_tutor,
        COUNT(*) AS cnt
      FROM students
      WHERE status = 'アクティブ'
        AND contract_plan NOT IN ('永久会員', '在籍プラン')
      GROUP BY homeroom_tutor
    `);
    const activeCountMap = {};
    for (const row of activeCountResult.rows) {
      activeCountMap[row.homeroom_tutor] = parseInt(row.cnt, 10);
    }

    // 3. 引き継ぎ先Tutorの件数 (handover_assignments テーブル、空でないもの)
    const handoverCountResult = await query(`
      SELECT
        handover_tutor_name,
        COUNT(*) AS cnt
      FROM handover_assignments
      WHERE handover_tutor_name IS NOT NULL
        AND handover_tutor_name <> ''
      GROUP BY handover_tutor_name
    `);
    const handoverCountMap = {};
    for (const row of handoverCountResult.rows) {
      handoverCountMap[row.handover_tutor_name] = parseInt(row.cnt, 10);
    }

    // 4. 各Tutorの引き継ぎ可能人数を計算
    const data = tutorsResult.rows.map(tutor => {
      const capacity     = tutor.student_capacity != null ? parseInt(tutor.student_capacity, 10) : null;
      const active       = activeCountMap[tutor.notion_name] || 0;
      const pending      = handoverCountMap[tutor.tutor_name] || 0;
      const available    = capacity != null ? capacity - active - pending : null;

      return {
        tutor_name:    tutor.tutor_name,
        notion_name:   tutor.notion_name,
        capacity:      capacity,
        active_count:  active,
        pending_count: pending,
        available:     available
      };
    });

    return c.json({ success: true, data });
  } catch (error) {
    console.error('[Handover] Error fetching tutor sidebar:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/handover/reset
 * 引き継ぎ先Tutorを一括リセット (毎月10日 スケジューラーから呼ぶ)
 */
app.post('/reset', async (c) => {
  try {
    const result = await query(`
      UPDATE handover_assignments
      SET handover_tutor_name = NULL,
          reset_at            = NOW(),
          updated_at          = NOW()
      WHERE handover_tutor_name IS NOT NULL
        AND handover_tutor_name <> ''
      RETURNING id
    `);

    console.log(`[Handover] Monthly reset: cleared ${result.rowCount} assignments`);
    return c.json({ success: true, cleared: result.rowCount });
  } catch (error) {
    console.error('[Handover] Error resetting assignments:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
