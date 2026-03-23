import { Hono } from 'hono';
import { fetchLessonCompletionStatus } from '../services/cacheService.js';

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
    
    // Get completion data from cache or fetch fresh
    const now = Date.now();
    if (!lessonCompletionCache || !lessonCompletionCacheTime || (now - lessonCompletionCacheTime >= CACHE_DURATION)) {
      const progressSpreadsheetId = process.env.PROGRESS_SPREADSHEET_ID;
      
      if (!progressSpreadsheetId) {
        return c.json({
          success: false,
          error: 'PROGRESS_SPREADSHEET_ID not configured'
        }, 500);
      }
      
      lessonCompletionCache = await fetchLessonCompletionStatus(progressSpreadsheetId);
      lessonCompletionCacheTime = now;
    }
    
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
          timestamp: completionData.timestamp
        }
      });
    } else {
      return c.json({
        success: true,
        data: {
          studentId,
          lessonDate,
          completed: false,
          lessonResult: '未記入',
          timestamp: null
        }
      });
    }
  } catch (error) {
    console.error('[Lesson Completion] Error checking completion:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-completion/batch
 * Batch check lesson completion status for multiple students/dates
 * Body: { items: [{ studentId, lessonDate }, ...] }
 */
app.post('/batch', async (c) => {
  try {
    const { items } = await c.req.json();
    
    if (!items || !Array.isArray(items)) {
      return c.json({
        success: false,
        error: 'items array is required'
      }, 400);
    }
    
    // Get completion data from cache or fetch fresh
    const now = Date.now();
    if (!lessonCompletionCache || !lessonCompletionCacheTime || (now - lessonCompletionCacheTime >= CACHE_DURATION)) {
      const progressSpreadsheetId = process.env.PROGRESS_SPREADSHEET_ID;
      
      if (!progressSpreadsheetId) {
        return c.json({
          success: false,
          error: 'PROGRESS_SPREADSHEET_ID not configured'
        }, 500);
      }
      
      lessonCompletionCache = await fetchLessonCompletionStatus(progressSpreadsheetId);
      lessonCompletionCacheTime = now;
    }
    
    // Build results for all items
    const results = items.map(item => {
      const { studentId, lessonDate } = item;
      const normalizedId = normalizeStudentId(studentId);
      
      // Check lesson date ±2 days range
      // Example: lessonDate = "2026-03-08" -> check 2026-03-08, 2026-03-09, 2026-03-10
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
      
      return {
        studentId,
        lessonDate,
        completed: completionData ? completionData.completed : false,
        lessonResult: completionData ? completionData.lessonResult : '未記入',
        timestamp: completionData ? completionData.timestamp : null
      };
    });
    
    return c.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[Lesson Completion] Error in batch check:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/lesson-completion/clear-cache
 * Clear lesson completion cache
 */
app.post('/clear-cache', async (c) => {
  lessonCompletionCache = null;
  lessonCompletionCacheTime = null;
  
  return c.json({
    success: true,
    message: 'Lesson completion cache cleared successfully'
  });
});

export default app;
