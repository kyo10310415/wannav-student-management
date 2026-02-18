import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchLessonsForMonth } from '../services/calendarService.js';

const app = new Hono();

/**
 * GET /api/lessons
 * Get all lessons
 */
app.get('/', async (c) => {
  try {
    const result = await query(
      'SELECT * FROM lessons ORDER BY lesson_date DESC'
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching lessons:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lessons/sync/:year/:month
 * Sync lessons from Google Calendar for a specific month
 */
app.get('/sync/:year/:month', async (c) => {
  try {
    const year = parseInt(c.req.param('year'));
    const month = parseInt(c.req.param('month'));
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return c.json({
        success: false,
        error: 'Invalid year or month'
      }, 400);
    }
    
    const lessons = await fetchLessonsForMonth(year, month);
    
    // Upsert lessons into database
    for (const lesson of lessons) {
      await query(
        `INSERT INTO lessons 
          (calendar_event_id, student_id, tutor_name, lesson_date, title, description, meet_link, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (calendar_event_id) 
        DO UPDATE SET
          student_id = EXCLUDED.student_id,
          tutor_name = EXCLUDED.tutor_name,
          lesson_date = EXCLUDED.lesson_date,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          meet_link = EXCLUDED.meet_link,
          updated_at = CURRENT_TIMESTAMP`,
        [
          lesson.calendar_event_id,
          lesson.student_id,
          lesson.tutor_name,
          lesson.lesson_date,
          lesson.title,
          lesson.description,
          lesson.meet_link
        ]
      );
    }
    
    return c.json({
      success: true,
      message: `Synced ${lessons.length} lessons for ${year}/${month}`,
      count: lessons.length
    });
  } catch (error) {
    console.error('Error syncing lessons:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lessons/month/:year/:month
 * Get lessons for a specific month
 */
app.get('/month/:year/:month', async (c) => {
  try {
    const year = parseInt(c.req.param('year'));
    const month = parseInt(c.req.param('month'));
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return c.json({
        success: false,
        error: 'Invalid year or month'
      }, 400);
    }
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const result = await query(
      'SELECT * FROM lessons WHERE lesson_date >= $1 AND lesson_date <= $2 ORDER BY lesson_date ASC',
      [startDate, endDate]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      year,
      month
    });
  } catch (error) {
    console.error('Error fetching lessons for month:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lessons/student/:studentId
 * Get lessons by student ID
 */
app.get('/student/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    
    const result = await query(
      'SELECT * FROM lessons WHERE student_id = $1 ORDER BY lesson_date DESC',
      [studentId]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching lessons by student:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lessons/stats/:year/:month
 * Get lesson statistics for students in a specific month
 */
app.get('/stats/:year/:month', async (c) => {
  try {
    const year = parseInt(c.req.param('year'));
    const month = parseInt(c.req.param('month'));
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return c.json({
        success: false,
        error: 'Invalid year or month'
      }, 400);
    }
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const result = await query(
      `SELECT 
        s.student_id,
        s.name,
        s.homeroom_tutor,
        COUNT(l.id) as lesson_count
      FROM students s
      LEFT JOIN lessons l ON s.student_id = l.student_id 
        AND l.lesson_date >= $1 
        AND l.lesson_date <= $2
      GROUP BY s.student_id, s.name, s.homeroom_tutor
      ORDER BY s.name ASC`,
      [startDate, endDate]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      year,
      month
    });
  } catch (error) {
    console.error('Error fetching lesson stats:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
