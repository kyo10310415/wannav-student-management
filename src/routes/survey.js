import { Hono } from 'hono';
import { getPool } from '../db/connection.js';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';
import { 
  fetchSurveyResponsesFromCache, 
  fetchCurrentMonthSurveyResponses, 
  fetchMonthlyResponseHistory,
  fetchExtensionResultsFromCache 
} from '../services/cacheService.js';

const app = new Hono();

// Cache for survey response counts (1 hour for faster updates)
let surveyResponseCache = null;
let surveyResponseCacheTime = null;

// Cache for current month responders (1 hour)
let currentMonthRespondersCache = null;
let currentMonthRespondersCacheTime = null;

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
 * Check if student has 6 consecutive months of responses
 * @param {Set<string>} responseMonths - Set of 'YYYY/M' strings
 * @param {Date} startDate - Start checking from this month (default: current month)
 * @returns {boolean}
 */
function hasConsecutive6Months(responseMonths, startDate = new Date()) {
  const months = [];
  const endDate = new Date(startDate);
  
  // Get last 6 months (including current)
  for (let i = 0; i < 6; i++) {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}/${d.getMonth() + 1}`);
  }
  
  // Check if all 6 months are in responseMonths
  return months.every(month => responseMonths.has(month));
}

/**
 * Check if student has 100% response rate from 2026/4 until they reach 6 months
 * @param {Set<string>} responseMonths - Set of 'YYYY/M' strings
 * @param {number} continuedMonths - Total continued months
 * @param {Date} lessonStartDate - Lesson start date
 * @returns {boolean}
 */
function has100PercentFrom202604(responseMonths, continuedMonths, lessonStartDate) {
  if (continuedMonths >= 6) return false; // This check is only for < 6 months
  
  const april2026 = new Date('2026-04-01');
  const now = new Date();
  
  // Get all months from 2026/4 to current month
  const requiredMonths = [];
  const current = new Date(april2026);
  
  while (current <= now) {
    requiredMonths.push(`${current.getFullYear()}/${current.getMonth() + 1}`);
    current.setMonth(current.getMonth() + 1);
  }
  
  // Check if all required months are in responseMonths
  const allPresent = requiredMonths.every(month => responseMonths.has(month));
  
  return allPresent;
}

/**
 * Check roulette eligibility based on lesson start date and survey responses
 * 
 * Conditions:
 * ① Started before 2026/3: Response rate >= 80%
 * ② Started from 2026/4 onwards: 6 consecutive months of responses
 * ③ Started before 2026/3 but continued_months < 6: 100% response rate from 2026/4 until 6 months
 * ④ Extension result = "延長"
 * ⑤ Status = "アクティブ"
 * 
 * @param {Object} params
 * @param {string} params.lessonStartDate - Lesson start date (YYYY-MM-DD)
 * @param {number} params.continuedMonths - Continued months
 * @param {number} params.responseCount - Total response count
 * @param {number} params.responseRate - Response rate (%)
 * @param {Array} params.recentResponses - Recent 6 months responses (boolean array)
 * @param {string} params.status - Student status
 * @param {string} params.extensionResult - Extension result
 * @returns {Object} { isEligible: boolean, reason: string, condition: string }
 */
function checkRouletteEligibility({
  lessonStartDate,
  continuedMonths,
  responseCount,
  responseRate,
  recentResponses,
  status,
  extensionResult
}) {
  // ⑤ Status must be "アクティブ"
  if (status !== 'アクティブ') {
    return {
      isEligible: false,
      reason: 'ステータスがアクティブではありません',
      condition: 'status_check'
    };
  }
  
  // ④ Extension result must be "延長"
  if (extensionResult !== '延長') {
    return {
      isEligible: false,
      reason: '延長審査の結果が「延長」ではありません',
      condition: 'extension_check'
    };
  }
  
  // Determine which condition applies
  const startDate = new Date(lessonStartDate);
  const cutoffDate = new Date('2026-04-01');
  const april2026 = new Date('2026-04-01');
  
  // ① Started before 2026/4 (includes null/invalid dates as legacy)
  if (!lessonStartDate || startDate < cutoffDate) {
    // ③ If continued_months < 6, need 100% response rate from 2026/4
    if (continuedMonths < 6) {
      const now = new Date();
      if (now >= april2026) {
        // Calculate months from 2026/4 to now
        const monthsFrom2026April = Math.floor((now - april2026) / (1000 * 60 * 60 * 24 * 30));
        const requiredMonths = Math.min(6 - continuedMonths, monthsFrom2026April + 1);
        
        // Check if all recent months have responses
        const recentResponseCount = recentResponses.filter(Boolean).length;
        const hasAllRecentResponses = recentResponseCount >= requiredMonths;
        
        if (hasAllRecentResponses && continuedMonths >= 6) {
          return {
            isEligible: true,
            reason: `条件③達成: 2026/4以降${requiredMonths}ヶ月連続回答（100%）で6ヶ月達成`,
            condition: 'condition_3'
          };
        } else {
          return {
            isEligible: false,
            reason: `条件③未達成: 2026/4以降6ヶ月になるまで100%回答が必要（現在${recentResponseCount}/${requiredMonths}ヶ月）`,
            condition: 'condition_3'
          };
        }
      } else {
        // Before 2026/4, use legacy 80% rule
        if (responseRate >= 80) {
          return {
            isEligible: true,
            reason: `条件①達成: 回答率${responseRate}% (≥80%)`,
            condition: 'condition_1'
          };
        } else {
          return {
            isEligible: false,
            reason: `条件①未達成: 回答率${responseRate}% (<80%)`,
            condition: 'condition_1'
          };
        }
      }
    }
    
    // ① Legacy students with continued_months >= 6
    if (responseRate >= 80) {
      return {
        isEligible: true,
        reason: `条件①達成: 回答率${responseRate}% (≥80%)`,
        condition: 'condition_1'
      };
    } else {
      return {
        isEligible: false,
        reason: `条件①未達成: 回答率${responseRate}% (<80%)`,
        condition: 'condition_1'
      };
    }
  }
  
  // ② Started from 2026/4 onwards: Need 6 consecutive months of responses
  const consecutiveMonths = recentResponses.reduce((count, responded) => {
    if (!responded) return 0; // Reset on missed month
    return count + 1;
  }, 0);
  
  if (consecutiveMonths >= 6) {
    return {
      isEligible: true,
      reason: `条件②達成: 6ヶ月連続回答（${consecutiveMonths}ヶ月）`,
      condition: 'condition_2'
    };
  } else {
    return {
      isEligible: false,
      reason: `条件②未達成: 6ヶ月連続回答が必要（現在${consecutiveMonths}ヶ月）`,
      condition: 'condition_2'
    };
  }
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
 * Get current month survey responders from cache spreadsheet
 */
async function getCurrentMonthResponders() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (currentMonthRespondersCache && currentMonthRespondersCacheTime && (now - currentMonthRespondersCacheTime < CACHE_DURATION)) {
    console.log('[Survey] Using cached current month responders');
    return currentMonthRespondersCache;
  }
  
  // Fetch fresh data
  const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
  if (!cacheSpreadsheetId) {
    console.warn('[Survey] GOOGLE_CACHE_SHEET_ID or GOOGLE_SHEET_ID not configured');
    return new Set();
  }
  
  try {
    currentMonthRespondersCache = await fetchCurrentMonthSurveyResponses(cacheSpreadsheetId);
    currentMonthRespondersCacheTime = now;
    console.log(`[Survey] Current month responders fetched and cached: ${currentMonthRespondersCache.size} students`);
    return currentMonthRespondersCache;
  } catch (error) {
    console.error('[Survey] Error fetching current month responders:', error);
    return currentMonthRespondersCache || new Set(); // Return old cache if available
  }
}

/**
 * GET /api/survey/debug/:studentId
 * 特定の生徒のアンケート判定デバッグ情報
 */
app.get('/debug/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param();
    const pool = getPool();
    
    // Get survey response counts from spreadsheet
    const surveyResponseCounts = await getSurveyResponseCounts();
    
    // Get current month responders from spreadsheet
    const currentMonthResponders = await getCurrentMonthResponders();
    
    // Get monthly response history from spreadsheet
    const satisfactionSpreadsheetId = process.env.SATISFACTION_SPREADSHEET_ID || process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    let monthlyResponseHistory = new Map();
    
    if (satisfactionSpreadsheetId) {
      monthlyResponseHistory = await fetchMonthlyResponseHistory(satisfactionSpreadsheetId);
    }
    
    // Get extension results from cache
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    let extensionResultsFromCache = {};
    
    if (cacheSpreadsheetId) {
      try {
        extensionResultsFromCache = await fetchExtensionResultsFromCache(cacheSpreadsheetId);
      } catch (error) {
        console.error('[Survey Debug] Failed to load extension results from cache:', error.message);
      }
    }
    
    // Get achievement records
    const achievementsResult = await pool.query(`
      SELECT 
        student_id,
        achievement_type,
        achievement_date,
        notified_at
      FROM stamp_rally_achievements
      WHERE student_id = $1 AND notified_at IS NOT NULL
      ORDER BY achievement_date DESC
      LIMIT 1
    `, [studentId]);
    
    // Get student info
    const studentResult = await pool.query(`
      SELECT 
        student_id,
        name,
        status,
        continued_months,
        lesson_start_date,
        result_overall
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
    const normalizedStudentId = normalizeStudentId(studentId);
    
    // Get response data
    const responseCount = surveyResponseCounts[normalizedStudentId] || 0;
    const continuedMonths = student.continued_months || 0;
    const responseRate = continuedMonths > 0 ? (responseCount / continuedMonths) * 100 : 0;
    const responseRateRounded = Math.round(responseRate);
    const respondedThisMonth = currentMonthResponders.has(normalizedStudentId);
    
    // Get monthly response history
    const studentResponseMonths = monthlyResponseHistory.get(normalizedStudentId) || new Set();
    const responseMonthsArray = Array.from(studentResponseMonths).sort();
    
    // Get extension result
    const extensionResult = extensionResultsFromCache[normalizedStudentId];
    const isExtensionApproved = extensionResult === '延長';
    const isActive = student.status === 'アクティブ';
    
    // Parse lesson start date
    const lessonStartDate = student.lesson_start_date ? new Date(student.lesson_start_date) : null;
    const april2026 = new Date('2026-04-01');
    const march2026End = new Date('2026-03-31');
    
    // Check if student has achieved before
    const previousAchievement = achievementsResult.rows[0] || null;
    const hasAchievedBefore = previousAchievement && previousAchievement.notified_at;
    
    // Determine eligibility
    let isEligible = false;
    let eligibilityReason = '';
    let conditionApplied = '';
    
    if (!isActive) {
      eligibilityReason = 'Status is not アクティブ';
      conditionApplied = 'pre-check';
    } else if (!isExtensionApproved) {
      eligibilityReason = `Extension result is not 延長 (current: ${extensionResult || 'null'})`;
      conditionApplied = 'pre-check';
    } else if (hasAchievedBefore) {
      conditionApplied = 'reset';
      if (hasConsecutive6Months(studentResponseMonths)) {
        isEligible = true;
        eligibilityReason = 'Eligible: 6 consecutive months (after reset)';
      } else {
        eligibilityReason = 'Need 6 consecutive months of responses (after previous achievement)';
      }
    } else if (!lessonStartDate) {
      conditionApplied = 'condition_1_no_date';
      if (responseRateRounded >= 80) {
        isEligible = true;
        eligibilityReason = `Eligible: Response rate >= 80% (actual: ${responseRate.toFixed(2)}%)`;
      } else {
        eligibilityReason = `Response rate < 80% (actual: ${responseRate.toFixed(2)}%)`;
      }
    } else if (lessonStartDate >= april2026) {
      conditionApplied = 'condition_2';
      if (hasConsecutive6Months(studentResponseMonths)) {
        isEligible = true;
        eligibilityReason = 'Eligible: 6 consecutive months (started after 2026/4)';
      } else {
        eligibilityReason = 'Need 6 consecutive months of responses (started after 2026/4)';
      }
    } else if (lessonStartDate <= march2026End && continuedMonths < 6) {
      conditionApplied = 'condition_3';
      if (has100PercentFrom202604(studentResponseMonths, continuedMonths, lessonStartDate)) {
        isEligible = true;
        eligibilityReason = 'Eligible: 100% response from 2026/4 (less than 6 months)';
      } else {
        eligibilityReason = 'Need 100% response rate from 2026/4 until 6 months';
      }
    } else {
      conditionApplied = 'condition_1';
      if (responseRateRounded >= 80) {
        isEligible = true;
        eligibilityReason = `Eligible: Response rate >= 80% (actual: ${responseRate.toFixed(2)}%)`;
      } else {
        eligibilityReason = `Response rate < 80% (actual: ${responseRate.toFixed(2)}%)`;
      }
    }
    
    // Return debug info
    return c.json({
      success: true,
      debug: {
        student_info: {
          student_id: studentId,
          normalized_student_id: normalizedStudentId,
          name: student.name,
          status: student.status,
          continued_months: continuedMonths,
          lesson_start_date: student.lesson_start_date,
          result_overall: student.result_overall
        },
        survey_data: {
          response_count: responseCount,
          response_rate: responseRate,
          response_rate_rounded: responseRateRounded,
          responded_this_month: respondedThisMonth,
          response_months: responseMonthsArray,
          has_6_consecutive_months: hasConsecutive6Months(studentResponseMonths),
          spreadsheet_match: surveyResponseCounts[normalizedStudentId] !== undefined
        },
        extension_data: {
          extension_result: extensionResult || null,
          is_extension_approved: isExtensionApproved
        },
        achievement_data: {
          has_achieved_before: hasAchievedBefore,
          previous_achievement: previousAchievement
        },
        eligibility: {
          is_eligible: isEligible,
          reason: eligibilityReason,
          condition_applied: conditionApplied
        },
        date_checks: {
          lesson_start_date: lessonStartDate ? lessonStartDate.toISOString() : null,
          is_after_april_2026: lessonStartDate ? lessonStartDate >= april2026 : null,
          is_before_march_2026: lessonStartDate ? lessonStartDate <= march2026End : null,
          april_2026_threshold: april2026.toISOString(),
          march_2026_end_threshold: march2026End.toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error in survey debug:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

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
    
    // Get current month responders from spreadsheet
    const currentMonthResponders = await getCurrentMonthResponders();
    
    // Get monthly response history from spreadsheet
    const satisfactionSpreadsheetId = process.env.SATISFACTION_SPREADSHEET_ID || process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    let monthlyResponseHistory = new Map();
    
    if (satisfactionSpreadsheetId) {
      try {
        monthlyResponseHistory = await fetchMonthlyResponseHistory(satisfactionSpreadsheetId);
        console.log(`[Survey] Monthly response history loaded: ${monthlyResponseHistory.size} students`);
      } catch (error) {
        console.error('[Survey] Failed to load monthly response history:', error.message);
      }
    }
    
    // Get achievement records to check if student already achieved once (for reset logic)
    const achievementsResult = await pool.query(`
      SELECT 
        student_id,
        achievement_type,
        achievement_date,
        notified_at
      FROM stamp_rally_achievements
      WHERE notified_at IS NOT NULL
      ORDER BY achievement_date DESC
    `);
    
    const achievementMap = {};
    achievementsResult.rows.forEach(row => {
      if (!achievementMap[row.student_id]) {
        achievementMap[row.student_id] = row; // Keep only the latest achievement
      }
    });
    
    // Get extension results from cache spreadsheet
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    let extensionResultsFromCache = {};
    
    if (cacheSpreadsheetId) {
      try {
        extensionResultsFromCache = await fetchExtensionResultsFromCache(cacheSpreadsheetId);
        console.log(`[Survey] Extension results loaded from cache: ${Object.keys(extensionResultsFromCache).length} students`);
      } catch (error) {
        console.error('[Survey] Failed to load extension results from cache:', error.message);
      }
    }
    
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
    
    // Get all roulette results (exclude test draws)
    let rouletteResult;
    try {
      rouletteResult = await pool.query(`
        SELECT 
          r.student_id,
          r.result,
          r.probability,
          r.created_at
        FROM roulette_results r
        INNER JOIN (
          SELECT student_id, MAX(created_at) as max_created
          FROM roulette_results
          WHERE is_test = FALSE OR is_test IS NULL
          GROUP BY student_id
        ) latest ON r.student_id = latest.student_id AND r.created_at = latest.max_created
        WHERE r.is_test = FALSE OR r.is_test IS NULL
      `);
      console.log(`[Survey] Roulette results fetched: ${rouletteResult.rows.length} records`);
    } catch (error) {
      console.error('[Survey] Error fetching roulette results:', error.message);
      // If is_test column doesn't exist yet, fallback to simple query
      // Exclude test draws by checking roulette_url prefix
      rouletteResult = await pool.query(`
        SELECT 
          r.student_id,
          r.result,
          r.probability,
          r.created_at
        FROM roulette_results r
        INNER JOIN (
          SELECT student_id, MAX(created_at) as max_created
          FROM roulette_results
          WHERE roulette_url NOT LIKE 'test-draw-%'
          GROUP BY student_id
        ) latest ON r.student_id = latest.student_id AND r.created_at = latest.max_created
        WHERE r.roulette_url NOT LIKE 'test-draw-%'
      `);
      console.log(`[Survey] Roulette results fetched (fallback, excluding test draws): ${rouletteResult.rows.length} records`);
    }
    
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
      
      // Check if student responded this month
      const respondedThisMonth = currentMonthResponders.has(normalizedStudentId);
      
      // Debug: Log first 3 students
      if (debugCount < 3) {
        console.log(`[Survey Debug] Student: "${studentName}" (${studentId})`);
        console.log(`  - DB Student ID: "${studentId}"`);
        console.log(`  - Normalized ID: "${normalizedStudentId}"`);
        console.log(`  - Spreadsheet match: ${surveyResponseCounts[normalizedStudentId] !== undefined ? 'YES' : 'NO'}`);
        console.log(`  - Response count: ${responseCount}`);
        console.log(`  - Responded this month: ${respondedThisMonth ? 'YES' : 'NO'}`);
        console.log(`  - Extension result (cache): ${extensionResultsFromCache[normalizedStudentId]}`);
        debugCount++;
      }
      
      // Check eligibility (using cache spreadsheet for extension result)
      // Fallback to extension DB if cache is not available
      let extensionResult = extensionResultsFromCache[normalizedStudentId] || extensionMap[studentId];
      const isExtensionApproved = extensionResult === '延長';
      const isActive = student.status === 'アクティブ';
      
      // Parse lesson start date to determine eligibility criteria
      const lessonStartDate = student.lesson_start_date ? new Date(student.lesson_start_date) : null;
      const april2026 = new Date('2026-04-01');
      const march2026End = new Date('2026-03-31');
      
      let isEligible = false;
      let eligibilityReason = '';
      
      if (!isActive) {
        eligibilityReason = 'Status is not active';
      } else if (!isExtensionApproved) {
        eligibilityReason = 'Extension result is not 延長';
      } else {
        // Determine eligibility based on lesson start date
        // Get student's monthly response history
        const studentResponseMonths = monthlyResponseHistory.get(normalizedStudentId) || new Set();
        
        // Check if student has already achieved once (reset logic)
        const previousAchievement = achievementMap[studentId];
        const hasAchievedBefore = previousAchievement && previousAchievement.notified_at;
        
        if (hasAchievedBefore) {
          // リセット後: 全員共通で6カ月連続条件
          if (hasConsecutive6Months(studentResponseMonths)) {
            isEligible = true;
            eligibilityReason = 'Eligible: 6 consecutive months (after reset)';
          } else {
            eligibilityReason = 'Need 6 consecutive months of responses (after previous achievement)';
          }
        } else if (!lessonStartDate) {
          // No lesson start date: use default 80% rule
          if (responseRate >= 80) {
            isEligible = true;
            eligibilityReason = 'Eligible: Response rate >= 80% (no start date)';
          } else {
            eligibilityReason = 'Response rate < 80%';
          }
        } else if (lessonStartDate >= april2026) {
          // ② Started after 2026/4: need 6 consecutive months
          if (hasConsecutive6Months(studentResponseMonths)) {
            isEligible = true;
            eligibilityReason = 'Eligible: 6 consecutive months (started after 2026/4)';
          } else {
            eligibilityReason = 'Need 6 consecutive months of responses (started after 2026/4)';
          }
        } else if (lessonStartDate <= march2026End && continuedMonths < 6) {
          // ③ Started before 2026/4 but less than 6 months: need 100% from 2026/4
          if (has100PercentFrom202604(studentResponseMonths, continuedMonths, lessonStartDate)) {
            isEligible = true;
            eligibilityReason = 'Eligible: 100% response from 2026/4 (less than 6 months)';
          } else {
            eligibilityReason = 'Need 100% response rate from 2026/4 until 6 months';
          }
        } else {
          // ① Started before 2026/4 with 6+ months: use 80% rule
          if (responseRate >= 80) {
            isEligible = true;
            eligibilityReason = 'Eligible: Response rate >= 80% (started before 2026/4, 6+ months)';
          } else {
            eligibilityReason = 'Response rate < 80%';
          }
        }
      }
      
      statsMap[studentId] = {
        studentId,
        name: studentName,
        status: student.status,
        continuedMonths,
        responseCount,
        responseRate,
        respondedThisMonth,  // 今月の回答状況を追加
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

    // 最新のルーレット結果取得（テスト抽選を除外）
    let rouletteResult;
    try {
      rouletteResult = await pool.query(`
        SELECT 
          result,
          probability,
          created_at
        FROM roulette_results
        WHERE student_id = $1 AND (is_test = FALSE OR is_test IS NULL)
        ORDER BY created_at DESC
        LIMIT 1
      `, [studentId]);
    } catch (error) {
      console.error('[Survey] Error fetching roulette result with is_test filter:', error.message);
      // Fallback to query without is_test column
      rouletteResult = await pool.query(`
        SELECT 
          result,
          probability,
          created_at
        FROM roulette_results
        WHERE student_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [studentId]);
    }

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
 * POST /api/survey/check-stamp-rally
 * 手動でスタンプラリー達成者チェックを実行
 */
app.post('/check-stamp-rally', async (c) => {
  try {
    console.log('[Survey] Manual stamp rally check triggered');
    
    // checkStampRallyAchievements をインポートして実行
    const { checkStampRallyAchievements } = await import('../services/stampRallyService.js');
    await checkStampRallyAchievements();
    
    return c.json({
      success: true,
      message: 'スタンプラリーチェックを実行しました',
      sent: 0,  // stampRallyService.js のログから確認
      errors: 0
    });
  } catch (error) {
    console.error('[Survey] Error in manual stamp rally check:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/survey/clear-cache
 * Clear survey response cache (force refresh on next request)
 */
app.post('/clear-cache', async (c) => {
  try {
    surveyResponseCache = null;
    surveyResponseCacheTime = null;
    currentMonthRespondersCache = null;
    currentMonthRespondersCacheTime = null;
    
    console.log('[Survey] All survey caches cleared manually');
    
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
