import { Hono } from 'hono';
import { query } from '../db/connection.js';

const app = new Hono();

/**
 * GET /api/handover/students
 * 引き継ぎ管理対象生徒一覧 + 今月残りレッスン数
 * アクティブ かつ 永久会員・休会・在籍プラン以外
 */
app.get('/students', async (c) => {
  try {
    // 今月の今日以降の日付範囲（JST）
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    // 今日の JST 0:00
    const todayJst = new Date(jst.getFullYear(), jst.getMonth(), jst.getDate());
    // 今月末 JST 23:59:59
    const monthEnd = new Date(jst.getFullYear(), jst.getMonth() + 1, 0, 23, 59, 59);

    // 今月残りレッスン数: 今日以降のレッスンを生徒ごとに集計
    const remainingResult = await query(`
      SELECT
        student_id,
        COUNT(*) AS remaining_lessons
      FROM lessons
      WHERE lesson_date >= $1
        AND lesson_date <= $2
      GROUP BY student_id
    `, [todayJst.toISOString(), monthEnd.toISOString()]);

    const remainingMap = {};
    for (const row of remainingResult.rows) {
      remainingMap[row.student_id] = parseInt(row.remaining_lessons, 10);
    }

    const result = await query(`
      SELECT
        s.id,
        s.student_id,
        s.name,
        s.lesson_progress,
        s.contract_plan,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        s.status,
        s.created_at,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name,
        ha.assigned_at,
        ha.reset_at
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.student_id
      WHERE
        s.status = 'アクティブ'
        AND s.contract_plan NOT IN ('永久会員', '休会', '在籍プラン')
      ORDER BY s.student_id ASC NULLS LAST, s.name ASC
    `);

    // 今月残りレッスン数を付加
    const data = result.rows.map(row => ({
      ...row,
      remaining_lessons: remainingMap[row.student_id] || 0
    }));

    return c.json({ success: true, data });
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
    const studentId = c.req.param('studentId');
    const { handover_tutor_name } = await c.req.json();

    if (!studentId) {
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
 * 計算式: student_capacity - activeStudents - 引き継ぎ先件数(受取) + 引き継ぎ元件数(送出)
 *
 * 例) AさんのTutor担当生徒の引き継ぎ先がBさんの場合
 *   → Aさん: +1（送り出し）、Bさん: -1（受け取り）
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

    // 3. 引き継ぎ割り当て情報を取得
    //    引き継ぎ先Tutor名 + 担当Tutor（homeroom_tutor = notion_name）を一緒に取得
    const assignmentResult = await query(`
      SELECT
        ha.handover_tutor_name,
        s.homeroom_tutor
      FROM handover_assignments ha
      JOIN students s ON s.student_id = ha.student_id
      WHERE ha.handover_tutor_name IS NOT NULL
        AND ha.handover_tutor_name <> ''
    `);

    // 引き継ぎ先Tutor名 → 受け取り件数（-1される側）
    const handoverToMap = {};   // key: tutor_name (引き継ぎ先)
    // 担当Tutor notion_name → 送り出し件数（+1される側）
    const handoverFromMap = {}; // key: notion_name (担当Tutor)

    for (const row of assignmentResult.rows) {
      // 受け取り側 (引き継ぎ先Tutor)
      handoverToMap[row.handover_tutor_name] = (handoverToMap[row.handover_tutor_name] || 0) + 1;
      // 送り出し側 (担当Tutor = homeroom_tutor = notion_name)
      if (row.homeroom_tutor) {
        handoverFromMap[row.homeroom_tutor] = (handoverFromMap[row.homeroom_tutor] || 0) + 1;
      }
    }

    // 4. 各Tutorの引き継ぎ可能人数を計算
    const data = tutorsResult.rows.map(tutor => {
      const capacity  = tutor.student_capacity != null ? parseInt(tutor.student_capacity, 10) : null;
      const active    = activeCountMap[tutor.notion_name] || 0;
      // 引き継ぎ先として受け取る件数（マイナス）
      const toCount   = handoverToMap[tutor.tutor_name] || 0;
      // 担当生徒が引き継ぎに出ている件数（プラス）
      const fromCount = handoverFromMap[tutor.notion_name] || 0;
      const available = capacity != null ? capacity - active - toCount + fromCount : null;

      return {
        tutor_name:    tutor.tutor_name,
        notion_name:   tutor.notion_name,
        capacity:      capacity,
        active_count:  active,
        to_count:      toCount,
        from_count:    fromCount,
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
