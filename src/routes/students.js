import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchStudents } from '../services/notionService.js';
import { fetchStudentsFromCache, fetchProgressFromCache, getCacheSyncTime } from '../services/cacheService.js';

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
        
        await query(
          `INSERT INTO students 
            (student_id, name, status, contract_plan, character_name, homeroom_tutor, lesson_progress, 
             notion_page_id, notion_url, discord_url, 
             payment_status_last_month, payment_status_current_month, 
             payment_year_month_last, payment_year_month_current, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
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
            student.payment_year_month_current
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
 * GET /api/students/:id
 * Get student by student_id
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
 * GET /api/students/tutor/:tutorName
 * Get students by homeroom tutor
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

export default app;
