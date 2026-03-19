import { Hono } from 'hono';
import { getPool } from '../db/connection.js';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';

const app = new Hono();

/**
 * GET /api/survey/responses/:studentId
 * 特定の生徒のアンケート回答記録を取得
 */
app.get('/responses/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param();
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        id,
        student_id,
        response_month,
        responded_at,
        created_at
      FROM survey_responses
      WHERE student_id = $1
      ORDER BY response_month DESC
    `, [studentId]);

    return c.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching survey responses:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/survey/responses
 * アンケート回答を記録
 * Body: { studentId, responseMonth }
 */
app.post('/responses', async (c) => {
  try {
    const { studentId, responseMonth } = await c.req.json();

    if (!studentId || !responseMonth) {
      return c.json({
        success: false,
        error: 'studentId and responseMonth are required'
      }, 400);
    }

    // responseMonthのフォーマット検証（YYYY-MM）
    if (!/^\d{4}-\d{2}$/.test(responseMonth)) {
      return c.json({
        success: false,
        error: 'responseMonth must be in YYYY-MM format'
      }, 400);
    }

    const pool = getPool();

    // 既に回答済みかチェック
    const existing = await pool.query(`
      SELECT id FROM survey_responses
      WHERE student_id = $1 AND response_month = $2
    `, [studentId, responseMonth]);

    if (existing.rows.length > 0) {
      return c.json({
        success: false,
        error: 'Response for this month already exists'
      }, 409);
    }

    // 回答記録を挿入
    const result = await pool.query(`
      INSERT INTO survey_responses (student_id, response_month, responded_at)
      VALUES ($1, $2, NOW())
      RETURNING id, student_id, response_month, responded_at, created_at
    `, [studentId, responseMonth]);

    console.log(`[Survey] Response recorded: ${studentId} - ${responseMonth}`);

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error recording survey response:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/survey/stats/:studentId
 * 特定の生徒のアンケート統計情報を取得
 * - 回答数
 * - 回答率
 * - 最新のルーレット結果
 * - 特典対象判定
 */
app.get('/stats/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param();
    const pool = getPool();

    // 生徒情報取得
    const studentResult = await pool.query(`
      SELECT 
        student_id,
        name,
        status,
        continued_months,
        lesson_start_date,
        result_score_prev_month as result_score
      FROM students
      WHERE student_id = $1
    `, [studentId]);

    if (studentResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Student not found'
      }, 404);
    }

    const student = studentResult.rows[0];

    // アンケート回答数取得
    const responseResult = await pool.query(`
      SELECT COUNT(*) as response_count
      FROM survey_responses
      WHERE student_id = $1
    `, [studentId]);

    const responseCount = parseInt(responseResult.rows[0].response_count);
    const continuedMonths = student.continued_months || 0;
    const responseRate = continuedMonths > 0 
      ? Math.round((responseCount / continuedMonths) * 100 * 10) / 10 
      : 0;

    // 最新のルーレット結果取得
    const rouletteResult = await pool.query(`
      SELECT 
        result,
        probability,
        created_at
      FROM roulette_results
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [studentId]);

    // 延長審査結果取得（extension DB）
    let extensionResult = null;
    const extPool = getExtensionPool();
    if (extPool) {
      try {
        const cycle = (continuedMonths === 4 || continuedMonths === 5) ? 1 : 2;
        const extResult = await queryExtension(`
          SELECT 
            examination_result_1,
            examination_result_2
          FROM student_extensions
          WHERE student_id = $1
        `, [studentId]);

        if (extResult.rows.length > 0) {
          extensionResult = cycle === 1 
            ? extResult.rows[0].examination_result_1 
            : extResult.rows[0].examination_result_2;
        }
      } catch (error) {
        console.warn('Could not fetch extension result:', error.message);
      }
    }

    // 特典対象判定
    const isEligible = await checkEligibility(student, responseCount, responseRate, extensionResult, pool);

    return c.json({
      success: true,
      data: {
        studentId: student.student_id,
        name: student.name,
        status: student.status,
        continuedMonths,
        responseCount,
        responseRate,
        latestRouletteResult: rouletteResult.rows[0] || null,
        isEligible,
        extensionResult,
        resultScore: student.result_score
      }
    });
  } catch (error) {
    console.error('Error fetching survey stats:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/survey/eligible-students
 * 特典対象の生徒一覧を取得
 */
app.get('/eligible-students', async (c) => {
  try {
    const pool = getPool();

    // アクティブな生徒を全て取得
    const studentsResult = await pool.query(`
      SELECT 
        student_id,
        name,
        status,
        continued_months,
        lesson_start_date,
        result_score_prev_month as result_score
      FROM students
      WHERE status = 'アクティブ'
      ORDER BY student_id
    `);

    const students = studentsResult.rows;
    const eligibleStudents = [];

    // 延長審査データ取得
    let extensionMap = {};
    const extPool = getExtensionPool();
    if (extPool) {
      try {
        const extResult = await queryExtension(`
          SELECT 
            student_id,
            examination_result_1,
            examination_result_2
          FROM student_extensions
        `);
        
        extResult.rows.forEach(ext => {
          extensionMap[ext.student_id] = ext;
        });
      } catch (error) {
        console.warn('Could not fetch extension data:', error.message);
      }
    }

    // 各生徒の特典対象判定
    for (const student of students) {
      // アンケート回答数取得
      const responseResult = await pool.query(`
        SELECT COUNT(*) as response_count
        FROM survey_responses
        WHERE student_id = $1
      `, [student.student_id]);

      const responseCount = parseInt(responseResult.rows[0].response_count);
      const continuedMonths = student.continued_months || 0;
      const responseRate = continuedMonths > 0 
        ? Math.round((responseCount / continuedMonths) * 100 * 10) / 10 
        : 0;

      // 延長審査結果
      const cycle = (continuedMonths === 4 || continuedMonths === 5) ? 1 : 2;
      const ext = extensionMap[student.student_id];
      const extensionResult = ext 
        ? (cycle === 1 ? ext.examination_result_1 : ext.examination_result_2)
        : null;

      // 特典対象判定
      const eligibility = await checkEligibility(student, responseCount, responseRate, extensionResult, pool);

      if (eligibility.isEligible) {
        eligibleStudents.push({
          studentId: student.student_id,
          name: student.name,
          continuedMonths,
          responseCount,
          responseRate,
          achievementType: eligibility.achievementType,
          probability: student.result_score === 'S' ? 100 : 50,
          resultScore: student.result_score
        });
      }
    }

    console.log(`[Survey] Found ${eligibleStudents.length} eligible students`);

    return c.json({
      success: true,
      data: eligibleStudents
    });
  } catch (error) {
    console.error('Error fetching eligible students:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 特典対象判定ロジック
 */
async function checkEligibility(student, responseCount, responseRate, extensionResult, pool) {
  const continuedMonths = student.continued_months || 0;
  const lessonStartDate = student.lesson_start_date ? new Date(student.lesson_start_date) : null;
  const cutoffDate = new Date('2026-04-01');

  // 条件4: ステータスがアクティブ
  if (student.status !== 'アクティブ') {
    return { isEligible: false, reason: 'Status is not active' };
  }

  // 条件4: 延長審査結果が「延長」
  if (extensionResult !== '延長') {
    return { isEligible: false, reason: 'Extension result is not 延長' };
  }

  // 既に達成済みかチェック
  const achievementResult = await pool.query(`
    SELECT id, achievement_type
    FROM stamp_rally_achievements
    WHERE student_id = $1
    ORDER BY achievement_date DESC
    LIMIT 1
  `, [student.student_id]);

  const latestAchievement = achievementResult.rows[0];

  // リセット後の判定（条件2のみ）
  if (latestAchievement) {
    // 6ヶ月連続回答チェック（リセット後）
    const consecutiveMonths = await checkConsecutiveMonths(student.student_id, pool);
    if (consecutiveMonths >= 6) {
      return { 
        isEligible: true, 
        achievementType: 'reset_6',
        reason: 'Reset: 6 consecutive months after previous achievement'
      };
    }
    return { isEligible: false, reason: 'Not enough consecutive months after reset' };
  }

  // 初回判定
  if (!lessonStartDate) {
    return { isEligible: false, reason: 'Lesson start date not set' };
  }

  const startedBefore2026_04 = lessonStartDate < cutoffDate;

  // 条件1: 2026/3以前開始、回答率80%以上
  if (startedBefore2026_04 && continuedMonths >= 6 && responseRate >= 80) {
    return { 
      isEligible: true, 
      achievementType: 'initial_80',
      reason: 'Started before 2026/04 with ≥80% response rate'
    };
  }

  // 条件2: 2026/4以降開始、6ヶ月連続回答
  if (!startedBefore2026_04) {
    const consecutiveMonths = await checkConsecutiveMonths(student.student_id, pool);
    if (consecutiveMonths >= 6) {
      return { 
        isEligible: true, 
        achievementType: 'continuous_6',
        reason: 'Started after 2026/04 with 6 consecutive months'
      };
    }
  }

  // 条件3: 2026/3以前開始、継続6ヶ月未満、2026/4から100%
  if (startedBefore2026_04 && continuedMonths < 6) {
    // 2026/4以降の回答数をカウント
    const postCutoffResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM survey_responses
      WHERE student_id = $1
        AND response_month >= '2026-04'
    `, [student.student_id]);

    const postCutoffCount = parseInt(postCutoffResult.rows[0].count);
    const monthsSince202604 = Math.max(0, continuedMonths - (continuedMonths - postCutoffCount));
    const requiredMonths = 6 - continuedMonths;

    if (postCutoffCount >= requiredMonths && postCutoffCount === monthsSince202604) {
      return { 
        isEligible: true, 
        achievementType: 'catch_up_100',
        reason: 'Started before 2026/04, <6 months, 100% since 2026/04'
      };
    }
  }

  return { isEligible: false, reason: 'No condition met' };
}

/**
 * 連続回答月数をチェック
 */
async function checkConsecutiveMonths(studentId, pool) {
  const result = await pool.query(`
    SELECT response_month
    FROM survey_responses
    WHERE student_id = $1
    ORDER BY response_month DESC
  `, [studentId]);

  if (result.rows.length === 0) return 0;

  const months = result.rows.map(r => r.response_month);
  let consecutive = 1;
  
  for (let i = 0; i < months.length - 1; i++) {
    const current = new Date(months[i] + '-01');
    const next = new Date(months[i + 1] + '-01');
    
    // 1ヶ月の差があるかチェック
    const diffMonths = (current.getFullYear() - next.getFullYear()) * 12 + 
                       (current.getMonth() - next.getMonth());
    
    if (diffMonths === 1) {
      consecutive++;
    } else {
      break;
    }
  }

  return consecutive;
}

export default app;
