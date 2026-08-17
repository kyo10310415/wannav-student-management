import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchStudents } from '../services/notionService.js';
import { fetchStudentsFromCache, fetchProgressFromCache, getCacheSyncTime, getSpreadsheetMetadata } from '../services/cacheService.js';
import { fetchWanamiUsageCount, fetchWanamiUsageHistory, fetchAllWanamiUsageCounts, fetchSuspensionMonthsMap } from '../services/sheetsService.js';
import { fetchLessonStartDates, calculateContinuedMonths } from '../services/externalDbService.js';
import { calculateStudentLessonStats } from '../services/lessonReportService.js';

const app = new Hono();

/**
 * Calculate PRO plan continued months
 * @param {Date|string} proStartDate - PRO plan start date
 * @returns {number} Number of months (1-based, 1 = first month)
 */
function calculateProPlanMonths(proStartDate) {
  if (!proStartDate) return null;
  
  const start = new Date(proStartDate);
  const now = new Date();
  
  // Calculate month difference
  const yearDiff = now.getFullYear() - start.getFullYear();
  const monthDiff = now.getMonth() - start.getMonth();
  
  // Total months difference (0-based) + 1 for 1-based counting
  const totalMonths = yearDiff * 12 + monthDiff + 1;
  
  return totalMonths > 0 ? totalMonths : null;
}

/**
 * GET /api/students
 * Get all students
 */
app.get('/', async (c) => {
  try {
    const result = await query(
      'SELECT * FROM students ORDER BY name ASC'
    );
    
    // Get lesson statistics from lesson reports
    let lessonStats = {};
    try {
      lessonStats = await calculateStudentLessonStats();
    } catch (error) {
      console.warn('Warning: Could not calculate lesson stats for GET /students:', error.message);
    }
    
    // Calculate PRO plan continued months and merge lesson stats for each student
    const studentsWithStats = result.rows.map(student => {
      const stats = lessonStats[student.student_id] || {
        lesson_progress: null,
        absence_count: 0,
        completed_count: 0,
        total_reports: 0
      };
      
      return {
        ...student,
        pro_plan_continued_months: calculateProPlanMonths(student.pro_plan_start_date),
        // レッスン報告から取得したデータで上書き
        lesson_progress: stats.lesson_progress || student.lesson_progress,
        absence_count: stats.absence_count
      };
    });
    
    return c.json({
      success: true,
      data: studentsWithStats,
      count: studentsWithStats.length
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/sync
 * Sync students from cache spreadsheet to database (fast)
 */
app.get('/sync', async (c) => {
  try {
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    
    if (!cacheSpreadsheetId) {
      return c.json({
        success: false,
        error: 'GOOGLE_CACHE_SHEET_ID or GOOGLE_SHEET_ID not configured'
      }, 400);
    }
    
    // Get last sync time
    let syncMeta = null;
    try {
      syncMeta = await getCacheSyncTime(cacheSpreadsheetId);
      console.log('Cache last sync:', syncMeta);
    } catch (error) {
      console.warn('Warning: Could not get cache sync time:', error.message);
      // Continue without sync time
    }
    
    // Fetch students from cache
    let students = [];
    let cacheUnavailable = false;
    try {
      students = await fetchStudentsFromCache(cacheSpreadsheetId);
    } catch (error) {
      console.error('Error fetching students from cache:', error.message);
      // Google API が一時的に失敗した場合はDBの既存データで続行
      cacheUnavailable = true;
      console.warn('⚠️ Cache unavailable — skipping sync, using existing DB data');
    }
    
    // Cache が使えない場合はスキップして成功を返す（DBの既存データをそのまま使用）
    if (cacheUnavailable) {
      return c.json({
        success: true,
        message: 'Cache unavailable (Google API error) — using existing DB data',
        count: 0,
        errors: 0,
        skipped: 0,
        cache_error: true
      });
    }
    
    // Check if cache is empty
    if (students.length === 0) {
      return c.json({
        success: false,
        error: 'Cache spreadsheet is empty. Please run the cache update script first.',
        hint: 'The cache spreadsheet may need to be populated with data from Notion.'
      }, 400);
    }
    
    // Fetch progress data
    let progressMap = {};
    try {
      progressMap = await fetchProgressFromCache(cacheSpreadsheetId);
      console.log(`Loaded ${Object.keys(progressMap).length} progress records`);
    } catch (error) {
      console.warn('Warning: Could not fetch progress data:', error.message);
      // Continue without progress data
    }
    
    // Fetch lesson start dates from external DB
    let lessonStartDates = {};
    try {
      lessonStartDates = await fetchLessonStartDates();
      console.log(`Loaded ${Object.keys(lessonStartDates).length} lesson start dates`);
    } catch (error) {
      console.warn('Warning: Could not fetch lesson start dates from external DB:', error.message);
      // Continue without lesson start dates
    }
    
    // Fetch suspension months map
    const suspensionMonthsMap = await fetchSuspensionMonthsMap();
    console.log(`Loaded suspension data for ${Object.keys(suspensionMonthsMap).length} students`);
    
    // Get lesson statistics from lesson reports (優先使用)
    let lessonStats = {};
    try {
      lessonStats = await calculateStudentLessonStats();
      console.log(`Calculated lesson stats for ${Object.keys(lessonStats).length} students from lesson reports`);
    } catch (error) {
      console.warn('Warning: Could not calculate lesson stats:', error.message);
      // Continue without lesson stats
    }
    
    // Filter out students without student_id
    const skippedStudents = [];
    const validStudents = students.filter(student => {
      if (!student.student_id) {
        skippedStudents.push({
          name: student.name || 'Unknown',
          status: student.status,
          notion_page_id: student.notion_page_id
        });
        return false;
      }
      return true;
    });

    console.log(`Found ${students.length} students, ${validStudents.length} valid, ${skippedStudents.length} skipped`);
    
    // Upsert students into database with progress
    let successCount = 0;
    let errorCount = 0;

    for (const student of validStudents) {
      try {
        // レッスン報告から取得した統計を優先、なければスプレッドシートのデータを使用
        const stats = lessonStats[student.student_id];
        const lessonProgress = stats?.lesson_progress || progressMap[student.student_id] || null;
        const absenceCount = stats?.absence_count !== undefined ? stats.absence_count : (student.absence_count || 0);
        
        // Calculate continued_months from lesson_start_date
        const lessonStartDate = student.lesson_start_date || lessonStartDates[student.student_id];
        let continuedMonths = lessonStartDate ? calculateContinuedMonths(lessonStartDate) : 0;
        
        // Subtract suspension months if exists
        const suspensionMonths = suspensionMonthsMap[student.student_id] || 0;
        if (suspensionMonths > 0) {
          continuedMonths = Math.max(0, continuedMonths - suspensionMonths);
        }
        
        await query(
          `INSERT INTO students 
            (student_id, name, status, contract_plan, character_name, homeroom_tutor, lesson_progress, 
             notion_page_id, notion_url, discord_url, 
             payment_status_last_month, payment_status_current_month, 
             payment_year_month_last, payment_year_month_current,
             result_absence, result_late, result_mission, result_payment,
             result_active_listening, result_understanding, result_overall,
             absence_count, lesson_start_date, continued_months, suspension_months, 
             youtube_channel_id, x_account_id, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, CURRENT_TIMESTAMP)
          ON CONFLICT (student_id) 
          DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            contract_plan = EXCLUDED.contract_plan,
            character_name = EXCLUDED.character_name,
            homeroom_tutor = EXCLUDED.homeroom_tutor,
            lesson_progress = EXCLUDED.lesson_progress,
            notion_page_id = EXCLUDED.notion_page_id,
            notion_url = EXCLUDED.notion_url,
            discord_url = EXCLUDED.discord_url,
            payment_status_last_month = EXCLUDED.payment_status_last_month,
            payment_status_current_month = EXCLUDED.payment_status_current_month,
            payment_year_month_last = EXCLUDED.payment_year_month_last,
            payment_year_month_current = EXCLUDED.payment_year_month_current,
            result_absence = EXCLUDED.result_absence,
            result_late = EXCLUDED.result_late,
            result_mission = EXCLUDED.result_mission,
            result_payment = EXCLUDED.result_payment,
            result_active_listening = EXCLUDED.result_active_listening,
            result_understanding = EXCLUDED.result_understanding,
            result_overall = EXCLUDED.result_overall,
            absence_count = EXCLUDED.absence_count,
            lesson_start_date = EXCLUDED.lesson_start_date,
            continued_months = EXCLUDED.continued_months,
            suspension_months = EXCLUDED.suspension_months,
            youtube_channel_id = EXCLUDED.youtube_channel_id,
            x_account_id = EXCLUDED.x_account_id,
            updated_at = CURRENT_TIMESTAMP`,
          [
            student.student_id,
            student.name,
            student.status,
            student.contract_plan,
            student.character_name,
            student.homeroom_tutor,
            lessonProgress,
            student.notion_page_id,
            student.notion_url,
            student.discord_url,
            student.payment_status_last_month,
            student.payment_status_current_month,
            student.payment_year_month_last,
            student.payment_year_month_current,
            student.result_absence,
            student.result_late,
            student.result_mission,
            student.result_payment,
            student.result_active_listening,
            student.result_understanding,
            student.result_overall,
            absenceCount,  // レッスン報告から取得した欠席回数を使用
            lessonStartDate,
            continuedMonths,
            suspensionMonths,
            student.youtube_channel_id || null,
            student.x_account_id || null
          ]
        );
        successCount++;
      } catch (error) {
        console.error(`Error inserting student ${student.student_id}:`, error.message);
        errorCount++;
      }
    }

    // スプレッドシートに存在しない生徒をDBから削除
    // ⚠️ 安全策: 削除対象がDB全体の20%を超える場合はキャッシュ異常とみなしてスキップ
    let deletedCount = 0;
    try {
      const cacheStudentIds = validStudents.map(s => s.student_id);
      const dbStudentsResult = await query('SELECT student_id FROM students');
      const dbStudentIds = dbStudentsResult.rows.map(r => r.student_id);
      const toDelete = dbStudentIds.filter(id => !cacheStudentIds.includes(id));

      if (toDelete.length > 0) {
        const deletionRatio = toDelete.length / dbStudentIds.length;
        if (deletionRatio > 0.2) {
          console.warn(`⚠️ 削除対象が全体の${Math.round(deletionRatio * 100)}%（${toDelete.length}/${dbStudentIds.length}人）のため、キャッシュ異常とみなして削除をスキップします`);
        } else {
          console.log(`Found ${toDelete.length} students to delete: ${toDelete.join(', ')}`);
          for (const studentId of toDelete) {
            try {
              await query('DELETE FROM students WHERE student_id = $1', [studentId]);
              deletedCount++;
              console.log(`✅ Deleted student: ${studentId}`);
            } catch (deleteError) {
              console.error(`❌ Error deleting student ${studentId}:`, deleteError.message);
            }
          }
        }
      } else {
        console.log('No students to delete');
      }
    } catch (deleteCheckError) {
      console.error('Error checking for students to delete:', deleteCheckError.message);
    }

    return c.json({
      success: true,
      message: `Synced ${successCount} students from cache (${errorCount} errors, ${skippedStudents.length} skipped, ${deletedCount} deleted)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedStudents.length,
      deleted: deletedCount,
      lastCacheSync: syncMeta?.lastSync
    });
  } catch (error) {
    console.error('Error syncing students:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/tutor/:tutorName
 * Get students by homeroom tutor
 * IMPORTANT: Specific routes with path prefixes come before dynamic /:id routes
 */
app.get('/tutor/:tutorName', async (c) => {
  try {
    const tutorName = c.req.param('tutorName');
    
    const result = await query(
      'SELECT * FROM students WHERE homeroom_tutor = $1 ORDER BY name ASC',
      [tutorName]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching students by tutor:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/wanami-usage-all
 * Get Wanami-san usage counts for all students (cached for 24 hours)
 * Query params: ?year=2025&month=11 (optional, defaults to current month)
 * IMPORTANT: This must be defined BEFORE /:id and /:studentId routes
 */
app.get('/wanami-usage-all', async (c) => {
  try {
    console.log('[Wanami API] Fetching all usage counts...');
    const year = c.req.query('year') ? parseInt(c.req.query('year')) : null;
    const month = c.req.query('month') ? parseInt(c.req.query('month')) : null;
    
    const usageCounts = await fetchAllWanamiUsageCounts(year, month);
    
    console.log(`[Wanami API] Found ${Object.keys(usageCounts).length} students with usage data`);
    
    return c.json({
      success: true,
      data: {
        year: year || new Date().getFullYear(),
        month: month || (new Date().getMonth() + 1),
        usage_counts: usageCounts
      }
    });
  } catch (error) {
    console.error('Error fetching all Wanami usage counts:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/:id
 * Get student by student_id
 * IMPORTANT: This dynamic route must come AFTER all specific routes
 */
app.get('/:id', async (c) => {
  try {
    const studentId = c.req.param('id');
    
    const result = await query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Student not found'
      }, 404);
    }
    
    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/:studentId/wanami-usage
 * Get Wanami-san usage count for a specific student
 * Query params: ?year=2025&month=11 (optional, defaults to current month)
 */
app.get('/:studentId/wanami-usage', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const year = c.req.query('year') ? parseInt(c.req.query('year')) : null;
    const month = c.req.query('month') ? parseInt(c.req.query('month')) : null;
    
    const count = await fetchWanamiUsageCount(studentId, year, month);
    
    return c.json({
      success: true,
      data: {
        student_id: studentId,
        year: year || new Date().getFullYear(),
        month: month || (new Date().getMonth() + 1),
        count: count
      }
    });
  } catch (error) {
    console.error('Error fetching Wanami usage count:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/:studentId/wanami-history
 * Get Wanami-san usage history (all months) for a specific student
 */
app.get('/:studentId/wanami-history', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    
    const history = await fetchWanamiUsageHistory(studentId);
    
    return c.json({
      success: true,
      data: {
        student_id: studentId,
        history: history
      }
    });
  } catch (error) {
    console.error('Error fetching Wanami usage history:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * PATCH /api/students/:id/pro-plan
 * Update PRO plan start date for a student
 */
app.patch('/:id/pro-plan', async (c) => {
  try {
    const studentId = c.req.param('id');
    const { proPlanStartDate } = await c.req.json();
    
    // Validate date format and ensure it's the 1st of the month
    let formattedDate = null;
    if (proPlanStartDate) {
      const date = new Date(proPlanStartDate);
      // Force to 1st of the month
      date.setDate(1);
      formattedDate = date.toISOString().split('T')[0];
    }
    
    // Update student
    const result = await query(
      `UPDATE students 
       SET pro_plan_start_date = $1
       WHERE student_id = $2
       RETURNING *`,
      [formattedDate, studentId]
    );
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Student not found'
      }, 404);
    }
    
    const student = result.rows[0];
    
    return c.json({
      success: true,
      data: {
        ...student,
        pro_plan_continued_months: calculateProPlanMonths(student.pro_plan_start_date)
      }
    });
  } catch (error) {
    console.error('Error updating PRO plan start date:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/students/debug-sheets
 * Debug endpoint to check spreadsheet structure
 */
app.get('/debug-sheets', async (c) => {
  try {
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    
    if (!cacheSpreadsheetId) {
      return c.json({
        success: false,
        error: 'No spreadsheet ID configured',
        env: {
          GOOGLE_CACHE_SHEET_ID: !!process.env.GOOGLE_CACHE_SHEET_ID,
          GOOGLE_SHEET_ID: !!process.env.GOOGLE_SHEET_ID
        }
      });
    }
    
    const metadata = await getSpreadsheetMetadata(cacheSpreadsheetId);
    
    return c.json({
      success: true,
      spreadsheetId: cacheSpreadsheetId,
      usingCache: !!process.env.GOOGLE_CACHE_SHEET_ID,
      metadata
    });
  } catch (error) {
    console.error('Error in debug-sheets:', error);
    return c.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, 500);
  }
});

export default app;
