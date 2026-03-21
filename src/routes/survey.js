import { Hono } from 'hono';
import { getPool } from '../db/connection.js';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';
import { fetchSurveyResponsesFromCache } from '../services/cacheService.js';

const app = new Hono();

// Cache for survey response counts (1 hour for faster updates)
let surveyResponseCache = null;
let surveyResponseCacheTime = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour (was 24 hours)

/**
 * Normalize student_id for consistent matching
 * Handles: leading/trailing spaces, full-width hyphens, case differences
 */
function normalizeStudentId(id) {
  if (!id) return '';
  return id.toString()
    .trim()                    // Remove leading/trailing spaces
    .replace(/[\s　]/g, '')    // Remove all spaces (half-width and full-width)
    .replace(/－/g, '-')       // Replace full-width hyphen with half-width
    .toUpperCase();            // Normalize to uppercase
}

/**
 * Get survey response counts from cache spreadsheet
 */
async function getSurveyResponseCounts() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (surveyResponseCache && surveyResponseCacheTime && (now - surveyResponseCacheTime < CACHE_DURATION)) {
    console.log('[Survey] Using cached survey response counts');
    return surveyResponseCache;
  }
  
  // Fetch fresh data
  const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
  if (!cacheSpreadsheetId) {
    console.warn('[Survey] GOOGLE_CACHE_SHEET_ID or GOOGLE_SHEET_ID not configured');
    return {};
  }
  
  try {
    surveyResponseCache = await fetchSurveyResponsesFromCache(cacheSpreadsheetId);
    surveyResponseCacheTime = now;
    console.log(`[Survey] Survey response counts fetched and cached for ${Object.keys(surveyResponseCache).length} students`);
    return surveyResponseCache;
  } catch (error) {
    console.error('[Survey] Error fetching survey response counts:', error);
    return surveyResponseCache || {}; // Return old cache if available
  }
}

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
 * GET /api/survey/stats-all
 * 全生徒のアンケート統計を一括取得（スプレッドシートから）
 */
app.get('/stats-all', async (c) => {
  try {
    const pool = getPool();
    
    // Get survey response counts from spreadsheet
    const surveyResponseCounts = await getSurveyResponseCounts();
    
    // Get all students with their continued months and lesson start date
    const studentsResult = await pool.query(`
      SELECT 
        s.student_id,
        s.name,
        s.status,
        s.continued_months,
        s.lesson_start_date,
        s.result_overall
      FROM students s
      WHERE s.status IN ('アクティブ', 'レッスン準備中')
    `);
    
    // Get all roulette results
    const rouletteResult = await pool.query(`
      SELECT 
        r.student_id,
        r.result,
        r.probability,
        r.created_at
      FROM roulette_results r
      INNER JOIN (
        SELECT student_id, MAX(created_at) as max_created
        FROM roulette_results
        GROUP BY student_id
      ) latest ON r.student_id = latest.student_id AND r.created_at = latest.max_created
    `);
    
    // Get extension results
    const extensionPool = getExtensionPool();
    let extensionResults = [];
    
    if (extensionPool) {
      try {
        const extResult = await extensionPool.query(`
          SELECT student_id, examination_result_2
          FROM student_extensions
          WHERE examination_result_2 IS NOT NULL
        `);
        extensionResults = extResult.rows;
      } catch (error) {
        console.warn('[Survey] Extension DB not available:', error.message);
      }
    }
    
    // Create lookup maps
    const rouletteMap = {};
    rouletteResult.rows.forEach(row => {
      rouletteMap[row.student_id] = row;
    });
    
    const extensionMap = {};
    extensionResults.forEach(row => {
      extensionMap[row.student_id] = row.examination_result_2;
    });
    
    // Build stats for each student
    const statsMap = {};
    
    // Debug: Log first 3 students for comparison
    let debugCount = 0;
    
    studentsResult.rows.forEach(student => {
      const studentId = student.student_id;
      const studentName = student.name;
      const normalizedStudentId = normalizeStudentId(studentId);
      
      // Get response count from spreadsheet by normalized student_id (column G)
      const responseCount = surveyResponseCounts[normalizedStudentId] || 0;
      const continuedMonths = student.continued_months || 0;
      const responseRate = continuedMonths > 0 ? Math.round((responseCount / continuedMonths) * 100) : 0;
      
      // Debug: Log first 3 students
      if (debugCount < 3) {
        console.log(`[Survey Debug] Student: "${studentName}" (${studentId})`);
        console.log(`  - DB Student ID: "${studentId}"`);
        console.log(`  - Normalized ID: "${normalizedStudentId}"`);
        console.log(`  - Spreadsheet match: ${surveyResponseCounts[normalizedStudentId] !== undefined ? 'YES' : 'NO'}`);
        console.log(`  - Response count: ${responseCount}`);
        debugCount++;
      }
      
      // Check eligibility (simplified logic for bulk fetch)
      const extensionResult = extensionMap[studentId];
      const isExtensionApproved = extensionResult === '延長';
      const isActive = student.status === 'アクティブ';
      
      let isEligible = false;
      let eligibilityReason = '';
      
      if (!isActive) {
        eligibilityReason = 'Status is not active';
      } else if (!isExtensionApproved) {
        eligibilityReason = 'Extension result is not 延長';
      } else if (responseRate >= 80) {
        isEligible = true;
        eligibilityReason = 'Eligible: Response rate >= 80%';
      } else {
        eligibilityReason = 'Response rate < 80%';
      }
      
      statsMap[studentId] = {
        studentId,
        name: studentName,
        status: student.status,
        continuedMonths,
        responseCount,
        responseRate,
        latestRouletteResult: rouletteMap[studentId] || null,
        isEligible: {
          isEligible,
          reason: eligibilityReason
        },
        extensionResult: extensionResult || null,
        resultScore: student.result_overall || null
      };
    });
    
    console.log(`[Survey] Bulk stats loaded for ${Object.keys(statsMap).length} students (from spreadsheet)`);
    
    return c.json({
      success: true,
      data: statsMap
    });
  } catch (error) {
    console.error('Error fetching bulk survey stats:', error);
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

    // Get survey response count from spreadsheet by normalized student_id (column G)
    const surveyResponseCounts = await getSurveyResponseCounts();
    const normalizedStudentId = normalizeStudentId(studentId);
    const responseCount = surveyResponseCounts[normalizedStudentId] || 0;
    
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
    
    // Get survey response counts from spreadsheet
    const surveyResponseCounts = await getSurveyResponseCounts();

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
      const studentId = student.student_id;
      const normalizedStudentId = normalizeStudentId(studentId);
      
      // Get survey response count from spreadsheet by normalized student_id (column G)
      const responseCount = surveyResponseCounts[normalizedStudentId] || 0;
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

/**
 * POST /api/survey/clear-cache
 * Clear survey response cache (force refresh on next request)
 */
app.post('/clear-cache', async (c) => {
  try {
    surveyResponseCache = null;
    surveyResponseCacheTime = null;
    
    console.log('[Survey] Cache cleared manually');
    
    return c.json({
      success: true,
      message: 'Survey response cache cleared successfully'
    });
  } catch (error) {
    console.error('[Survey] Error clearing cache:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
