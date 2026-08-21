import { Hono } from 'hono';
import { fetchLessonCompletionStatus } from '../services/cacheService.js';
import { query } from '../db/connection.js';
import {
  getCompletedStudentIdsForMonth,
  resolveLessonCompletionItems
} from '../services/lessonCompletionService.js';

const app = new Hono();

// Cache for lesson completion status (1 hour)
let lessonCompletionCache = null;
let lessonCompletionCacheTime = null;

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Normalize student_id for consistent matching
 */
function normalizeStudentId(id) {
  if (!id) return '';
  return id.toString()
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/－/g, '-')
    .toUpperCase();
}

/**
 * GET /api/lesson-completion/check
 * Check lesson completion status for a student on a specific date
 * Query params: studentId, lessonDate (YYYY-MM-DD)
 * 
 * データ取得優先順位:
 * 1. レッスン報告データベース（lesson_reports）
 * 2. スプレッドシート（フォールバック）
 */
app.get('/check', async (c) => {
  try {
    const { studentId, lessonDate } = c.req.query();
    
    if (!studentId || !lessonDate) {
      return c.json({
        success: false,
        error: 'studentId and lessonDate are required'
      }, 400);
    }
    
    // 【優先】レッスン報告データベースから取得
    try {
      const result = await query(
        `SELECT * FROM lesson_reports 
         WHERE student_id = $1 
         AND DATE(lesson_date) = DATE($2::date)`,
        [studentId, lessonDate]
      );
      
      if (result.rows.length > 0) {
        const report = result.rows[0];
        return c.json({
          success: true,
          data: {
            studentId,
            lessonDate,
            completed: report.lesson_result === '実施済み',
            lessonResult: report.lesson_result,
            timestamp: report.reported_at,
            source: 'database'
          }
        });
      }
    } catch (dbError) {
      console.error('❌ Database query error:', dbError);
      // エラーの場合はスプレッドシートにフォールバック
    }
    
    // 【フォールバック】データベースにない場合、スプレッドシートから取得
    const now = Date.now();
    if (!lessonCompletionCache || !lessonCompletionCacheTime || (now - lessonCompletionCacheTime >= CACHE_DURATION)) {
      const progressSpreadsheetId = process.env.PROGRESS_SPREADSHEET_ID;
      
      if (progressSpreadsheetId) {
        try {
          lessonCompletionCache = await fetchLessonCompletionStatus(progressSpreadsheetId);
          lessonCompletionCacheTime = now;
        } catch (cacheError) {
          console.error('❌ Cache fetch error:', cacheError);
        }
      }
    }
    
    if (lessonCompletionCache) {
      const normalizedId = normalizeStudentId(studentId);
      
      // Check lesson date ±2 days range
      let completionData = null;
      
      for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
        const checkDate = new Date(lessonDate);
        checkDate.setDate(checkDate.getDate() + dayOffset);
        
        const year = checkDate.getFullYear();
        const month = String(checkDate.getMonth() + 1).padStart(2, '0');
        const day = String(checkDate.getDate()).padStart(2, '0');
        const checkDateStr = `${year}-${month}-${day}`;
        
        const key = `${normalizedId}_${checkDateStr}`;
        const data = lessonCompletionCache.get(key);
        
        // If found "実施済み", use this data
        if (data && data.completed) {
          completionData = data;
          break;
        }
        
        // Keep first found data (even if not completed) as fallback
        if (!completionData && data) {
          completionData = data;
        }
      }
      
      if (completionData) {
        return c.json({
          success: true,
          data: {
            studentId,
            lessonDate,
            completed: completionData.completed,
            lessonResult: completionData.lessonResult,
            timestamp: completionData.timestamp,
            source: 'spreadsheet'
          }
        });
      }
    }
    
    // データが見つからない場合
    return c.json({
      success: true,
      data: {
        studentId,
        lessonDate,
        completed: false,
        lessonResult: null,
        timestamp: null,
        source: 'none'
      }
    });
    
  } catch (error) {
    console.error('Error checking lesson completion:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/lesson-completion/batch
 * Check lesson completion status for multiple student-date combinations
 * Body: { items: [{ studentId, lessonDate }, ...] }
 */
app.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const { items } = body;
    
    if (!items || !Array.isArray(items)) {
      return c.json({
        success: false,
        error: 'items array is required'
      }, 400);
    }
    
    console.log(`[Lesson Completion Batch] Processing ${items.length} items`);
    const results = await resolveLessonCompletionItems(items);
    
    console.log(`[Lesson Completion Batch] Returning ${results.length} results`);
    
    return c.json({
      success: true,
      data: results,
      count: results.length
    });
    
  } catch (error) {
    console.error('Error in batch lesson completion check:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-completion/completed-students
 * Return students with at least one completed lesson in the requested month.
 * Uses the same reservation-date + DB/spreadsheet fallback rules as the
 * reservation management page.
 * Query param: yearMonth (YYYY-MM)
 */
app.get('/completed-students', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    const data = await getCompletedStudentIdsForMonth(yearMonth);

    return c.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching completed students for month:', error);
    return c.json({
      success: false,
      error: error.message
    }, 400);
  }
});

/**
 * GET /api/lesson-completion/month
 * Get lesson completion status for all students in a specific month
 * Query param: yearMonth (YYYY-MM)
 */
app.get('/month', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    
    if (!yearMonth) {
      return c.json({
        success: false,
        error: 'yearMonth is required (format: YYYY-MM)'
      }, 400);
    }
    
    // レッスン報告データベースから月次データを取得
    const result = await query(
      `SELECT 
        student_id,
        lesson_date,
        lesson_result,
        reported_at
      FROM lesson_reports
      WHERE TO_CHAR(lesson_date, 'YYYY-MM') = $1
      ORDER BY lesson_date ASC, student_id ASC`,
      [yearMonth]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      source: 'database'
    });
    
  } catch (error) {
    console.error('Error fetching monthly lesson completion:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
