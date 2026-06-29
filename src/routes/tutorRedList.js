/**
 * Tutor Red List API Routes
 * GET    /api/tutor-red-list          — 一覧取得（満足度・助っ人依頼・出席率を結合して返す）
 * POST   /api/tutor-red-list/recalc   — スコア再計算＆一覧更新
 * PATCH  /api/tutor-red-list/:tutorId/status — 対応状況・担当者更新
 * DELETE /api/tutor-red-list/:tutorId — エントリ削除（レッドリストから除外）
 */

import { Hono } from 'hono';
import { query } from '../db/connection.js';
import axios from 'axios';
import { fetchTutorSkillScores } from '../services/cacheService.js';

const app = new Hono();

// ─────────────────────────────────────────
// Helper: スコア計算
// ─────────────────────────────────────────
/**
 * 助っ人依頼点数: 依頼回数 × 1点
 * MTG/研修/1on1 出席率70%以下: 3点
 * スキルスコア210点未満: +3点
 */
function calcScore({ helperRequestCount, attendanceRate, skillScoreLow }) {
  const helperScore     = helperRequestCount;  // 1回につき1点
  const attendanceScore = attendanceRate !== null && attendanceRate <= 70 ? 3 : 0;
  const skillScore      = skillScoreLow ? 3 : 0;  // G〜AJ合計が210点未満なら+3点
  return {
    helperScore,
    attendanceScore,
    skillScore,
    total: helperScore + attendanceScore + skillScore,
  };
}

/**
 * スコアからランク判定
 * High: 7点以上 / Middle: 4〜6点 / Low: 3点
 * ※ 3点未満 → リストに登録しない
 */
function calcRank(total) {
  if (total >= 7) return 'High';
  if (total >= 4) return 'Middle';
  if (total >= 3) return 'Low';
  return null; // 登録不要
}

// ─────────────────────────────────────────
// Helper: 外部 API からデータ取得
// ─────────────────────────────────────────

/**
 * BASE URLを環境変数 or localhost から取得
 */
function getBaseUrl() {
  return process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * 今月の助っ人依頼数を取得 (GET /api/tutors/monthly-stats/:year/:month)
 */
async function fetchHelperStats(year, month) {
  try {
    const res = await axios.get(`${getBaseUrl()}/api/tutors/monthly-stats/${year}/${month}`);
    if (res.data.success) {
      return res.data.data || { byEmployeeId: {}, rescheduleByName: {} };
    }
  } catch (e) {
    console.error('[TutorRedList] fetchHelperStats error:', e.message);
  }
  return { byEmployeeId: {}, rescheduleByName: {} };
}

/**
 * 今月の出席率を取得 (GET /api/schedules/absence-stats?year=&month=)
 */
async function fetchAttendanceStats(year, month) {
  try {
    const res = await axios.get(`${getBaseUrl()}/api/schedules/absence-stats?year=${year}&month=${month}`);
    if (res.data.success && res.data.data && res.data.data.stats) {
      // { tutor_email -> attendanceRate } マップを返す
      const map = {};
      for (const stat of res.data.data.stats) {
        map[stat.tutor_name] = stat.attendance_rate ?? 100;
      }
      return map;
    }
  } catch (e) {
    console.error('[TutorRedList] fetchAttendanceStats error:', e.message);
  }
  return {};
}

/**
 * 全Tutorの満足度データを取得 (GET /api/tutors/satisfaction/all)
 */
async function fetchSatisfactionAll() {
  try {
    const res = await axios.get(`${getBaseUrl()}/api/tutors/satisfaction/all`);
    if (res.data.success) {
      return res.data.data || {};  // tutor_name -> { yearMonth -> { average, count } }
    }
  } catch (e) {
    console.error('[TutorRedList] fetchSatisfactionAll error:', e.message);
  }
  return {};
}

// ─────────────────────────────────────────
// GET /api/tutor-red-list
// Tutorレッドリスト一覧を返す
// クエリパラメータ: year, month（省略時は現在月）
// ─────────────────────────────────────────
app.get('/', async (c) => {
  try {
    const now   = new Date();
    const year  = parseInt(c.req.query('year')  || now.getFullYear());
    const month = parseInt(c.req.query('month') || now.getMonth() + 1);

    // tutor_red_list テーブルの全エントリ取得
    const redListResult = await query(
      `SELECT * FROM tutor_red_list ORDER BY
         CASE rank WHEN 'High' THEN 1 WHEN 'Middle' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END,
         total_score DESC`
    );

    // スキルスコアシートID
    const skillSheetId = process.env.TUTOR_SKILL_SHEET_ID || '1nP12NofNbRVI2tRBMUARjMzpbHgxHcFfNifpPy1fyyE';

    // 最新の満足度・助っ人依頼・出席率・スキルスコアを並列取得
    const [helperStats, attendanceMap, satisfactionAll, skillScoreMap] = await Promise.all([
      fetchHelperStats(year, month),
      fetchAttendanceStats(year, month),
      fetchSatisfactionAll(),
      fetchTutorSkillScores(skillSheetId),
    ]);

    const selectedYM = `${year}/${month}`;

    // 各エントリにリアルタイムデータを付加
    const enriched = redListResult.rows.map(entry => {
      const tutorName = entry.tutor_name;

      // 満足度平均（当月）
      const tutorSatisfactionData = satisfactionAll[tutorName] || {};
      const monthData = tutorSatisfactionData[selectedYM];
      const satisfactionAvg = monthData ? (monthData.average * 10) : null;  // 0〜100換算

      // 助っ人依頼数（当月）
      const helperEntry = helperStats.byEmployeeId[entry.tutor_id] || {};
      const helperRequestCount = helperEntry.helperRequestCount || 0;

      // 出席率（当月）
      const attendanceRate = attendanceMap[tutorName] ?? null;

      // スキルスコア合計（G〜AJ列合計）
      const skillTotalScore = skillScoreMap.has(entry.tutor_id)
        ? skillScoreMap.get(entry.tutor_id)
        : null;

      return {
        ...entry,
        current_satisfaction: satisfactionAvg,
        current_helper_request_count: helperRequestCount,
        current_attendance_rate: attendanceRate,
        skill_total_score: skillTotalScore,
        year,
        month,
      };
    });

    return c.json({
      success: true,
      data: enriched,
      year,
      month,
    });
  } catch (error) {
    console.error('[TutorRedList] GET / error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// POST /api/tutor-red-list/recalc
// スコア再計算 → tutor_red_list を更新
// Body: { year?, month? }
// ─────────────────────────────────────────
app.post('/recalc', async (c) => {
  try {
    const body  = await c.req.json().catch(() => ({}));
    const now   = new Date();
    const year  = parseInt(body.year  || now.getFullYear());
    const month = parseInt(body.month || now.getMonth() + 1);

    // スキルスコアシートID（環境変数 or ハードコード）
    const skillSheetId = process.env.TUTOR_SKILL_SHEET_ID || '1nP12NofNbRVI2tRBMUARjMzpbHgxHcFfNifpPy1fyyE';

    // 並列でデータ取得
    const [tutorsResult, helperStats, attendanceMap, satisfactionAll, skillScoreMap] = await Promise.all([
      query(`SELECT * FROM tutors WHERE status = 'アクティブ' AND job_type ILIKE '%Tutor%'`),
      fetchHelperStats(year, month),
      fetchAttendanceStats(year, month),
      fetchSatisfactionAll(),
      fetchTutorSkillScores(skillSheetId),
    ]);

    console.log(`[TutorRedList] Skill score map loaded: ${skillScoreMap.size} entries`);

    const tutors = tutorsResult.rows;
    const selectedYM = `${year}/${month}`;

    let added = 0, updated = 0, removed = 0;

    for (const tutor of tutors) {
      const tutorName = tutor.tutor_name || tutor.name;
      const tutorId   = tutor.employee_id;

      // 助っ人依頼数
      const helperEntry        = helperStats.byEmployeeId[tutorId] || {};
      const helperRequestCount = helperEntry.helperRequestCount || 0;

      // 出席率
      const attendanceRate = attendanceMap[tutorName] ?? null;

      // スキルスコア（G〜AJ合計が210点未満なら skillScoreLow=true）
      const skillTotal    = skillScoreMap.has(tutorId) ? skillScoreMap.get(tutorId) : null;
      const skillScoreLow = skillTotal !== null && skillTotal < 210;

      // スコア計算
      const { helperScore, attendanceScore, skillScore, total } = calcScore({
        helperRequestCount,
        attendanceRate: attendanceRate ?? 100,
        skillScoreLow,
      });

      const rank = calcRank(total);

      // 満足度
      const tutorSatisfactionData = satisfactionAll[tutorName] || {};
      const monthData = tutorSatisfactionData[selectedYM];
      const satisfactionAvg = monthData ? (monthData.average * 10) : null;

      if (skillTotal !== null) {
        console.log(`[TutorRedList] ${tutorName}(${tutorId}): skillTotal=${skillTotal} skillScoreLow=${skillScoreLow} skillScore=${skillScore}`);
      }

      if (rank) {
        // UPSERT
        const existing = await query(
          'SELECT id FROM tutor_red_list WHERE tutor_id = $1',
          [tutorId]
        );

        if (existing.rows.length > 0) {
          await query(
            `UPDATE tutor_red_list
               SET rank = $1, total_score = $2,
                   helper_request_score = $3, attendance_score = $4,
                   snapshot_satisfaction = $5, snapshot_team = $6,
                   updated_at = NOW()
             WHERE tutor_id = $7`,
            [rank, total, helperScore, attendanceScore,
             satisfactionAvg, tutor.team || null, tutorId]
          );
          updated++;
        } else {
          await query(
            `INSERT INTO tutor_red_list
               (tutor_id, tutor_name, rank, total_score,
                helper_request_score, attendance_score,
                snapshot_satisfaction, snapshot_team,
                registered_at, correspondence_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),'未対応')`,
            [tutorId, tutorName, rank, total,
             helperScore, attendanceScore,
             satisfactionAvg, tutor.team || null]
          );
          added++;
        }
      } else {
        // スコア3未満 → レッドリストから除外
        const del = await query(
          'DELETE FROM tutor_red_list WHERE tutor_id = $1 AND correspondence_status = $2 RETURNING id',
          [tutorId, '未対応']  // 対応中・対応済みは手動管理のため削除しない
        );
        if (del.rows.length > 0) removed++;
      }
    }

    console.log(`[TutorRedList] recalc done: added=${added}, updated=${updated}, removed=${removed}`);

    return c.json({
      success: true,
      message: `再計算完了: 新規${added}件, 更新${updated}件, 除外${removed}件`,
      added,
      updated,
      removed,
      year,
      month,
    });
  } catch (error) {
    console.error('[TutorRedList] POST /recalc error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// PATCH /api/tutor-red-list/:tutorId/status
// 対応状況・担当者・メモを更新
// ─────────────────────────────────────────
app.patch('/:tutorId/status', async (c) => {
  try {
    const tutorId = c.req.param('tutorId');
    const body    = await c.req.json();

    const fields = [];
    const params = [];

    if (body.correspondence_status !== undefined) {
      params.push(body.correspondence_status);
      fields.push(`correspondence_status = $${params.length}`);
    }
    if (body.assigned_to !== undefined) {
      params.push(body.assigned_to || null);
      fields.push(`assigned_to = $${params.length}`);
    }
    if (body.notes !== undefined) {
      params.push(body.notes || null);
      fields.push(`notes = $${params.length}`);
    }

    if (fields.length === 0) {
      return c.json({ success: false, error: '更新フィールドがありません' }, 400);
    }

    params.push(tutorId);
    const result = await query(
      `UPDATE tutor_red_list
         SET ${fields.join(', ')}, updated_at = NOW()
       WHERE tutor_id = $${params.length}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'レコードが見つかりません' }, 404);
    }

    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[TutorRedList] PATCH /:tutorId/status error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// DELETE /api/tutor-red-list/:tutorId
// エントリを手動削除（レッドリストから除外）
// ─────────────────────────────────────────
app.delete('/:tutorId', async (c) => {
  try {
    const tutorId = c.req.param('tutorId');
    const result  = await query(
      'DELETE FROM tutor_red_list WHERE tutor_id = $1 RETURNING id',
      [tutorId]
    );

    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'レコードが見つかりません' }, 404);
    }

    return c.json({ success: true, message: 'レッドリストから削除しました' });
  } catch (error) {
    console.error('[TutorRedList] DELETE /:tutorId error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
