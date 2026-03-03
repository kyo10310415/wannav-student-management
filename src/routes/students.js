import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchStudents } from '../services/notionService.js';
import { fetchStudentsFromCache, fetchProgressFromCache, getCacheSyncTime } from '../services/cacheService.js';
import { fetchWanamiUsageCount, fetchWanamiUsageHistory, fetchAllWanamiUsageCounts } from '../services/sheetsService.js';
import { fetchLessonStartDates, calculateContinuedMonths } from '../services/externalDbService.js';

const app = new Hono();

/**
 * GET /api/students
 * Get all students
 */
app.get('/', async (c) => {
  try {
    const result = await query(
      'SELECT * FROM students ORDER BY name ASC'
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
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
    const syncMeta = await getCacheSyncTime(cacheSpreadsheetId);
    console.log('Cache last sync:', syncMeta);
    
    // Fetch students from cache
    const students = await fetchStudentsFromCache(cacheSpreadsheetId);
    
    // Fetch progress data
    const progressMap = await fetchProgressFromCache(cacheSpreadsheetId);
    console.log(`Loaded ${Object.keys(progressMap).length} progress records`);
    
    // Fetch lesson start dates from external DB
    const lessonStartDates = await fetchLessonStartDates();
    console.log(`Loaded ${Object.keys(lessonStartDates).length} lesson start dates`);
    
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
        const lessonProgress = progressMap[student.student_id] || null;
        
        // Calculate continued_months from lesson_start_date
        const lessonStartDate = student.lesson_start_date || lessonStartDates[student.student_id];
        const continuedMonths = lessonStartDate ? calculateContinuedMonths(lessonStartDate) : 0;
        
        await query(
          `INSERT INTO students 
            (student_id, name, status, contract_plan, character_name, homeroom_tutor, lesson_progress, 
             notion_page_id, notion_url, discord_url, 
             payment_status_last_month, payment_status_current_month, 
             payment_year_month_last, payment_year_month_current,
             result_absence, result_late, result_mission, result_payment,
             result_active_listening, result_understanding, result_overall,
             absence_count, lesson_start_date, continued_months, suspension_months, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, CURRENT_TIMESTAMP)
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
            student.absence_count,
            lessonStartDate,
            continuedMonths,
            student.suspension_months
          ]
        );
        successCount++;
      } catch (error) {
        console.error(`Error inserting student ${student.student_id}:`, error.message);
        errorCount++;
      }
    }
    
    return c.json({
      success: true,
      message: `Synced ${successCount} students from cache (${errorCount} errors, ${skippedStudents.length} skipped)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedStudents.length,
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

export default app;
