import { Hono } from 'hono';
import { query, getClient } from '../db/connection.js';
import { fetchLessonsForMonth } from '../services/calendarService.js';
import { fetchLessonsFromSheet, getLastSyncTime } from '../services/sheetsService.js';

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
    console.error('Lesson list fetch failed');
    return c.json({
      success: false,
      error: 'Failed to fetch lessons'
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
    
    console.log(`Fetched ${lessons.length} lessons from Google Calendar`);
    
    // Get student-tutor mapping from database
    // Students table has homeroom_tutor, Tutors table has notion_name
    // We need to match: student.homeroom_tutor == tutor.notion_name
    const studentTutorMapping = await query(`
      SELECT 
        s.student_id,
        s.homeroom_tutor,
        t.email as tutor_email,
        t.notion_name as tutor_notion_name
      FROM students s
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
      WHERE s.student_id IS NOT NULL
    `);
    
    // Create lookup map: student_id -> tutor_email
    const studentTutorMap = new Map();
    studentTutorMapping.rows.forEach(row => {
      if (row.tutor_email) {
        studentTutorMap.set(row.student_id, {
          email: row.tutor_email,
          notion_name: row.tutor_notion_name,
          homeroom_tutor: row.homeroom_tutor
        });
      }
    });
    
    console.log(`Built student-tutor mapping for ${studentTutorMap.size} students`);
    
    // Get tutor emails for calendar ID mapping
    const tutorEmails = await query('SELECT email, notion_name FROM tutors WHERE email IS NOT NULL');
    const calendarIdToTutorMap = new Map();
    tutorEmails.rows.forEach(row => {
      calendarIdToTutorMap.set(row.email.toLowerCase(), row.notion_name);
    });
    
    // Filter and upsert lessons
    let validLessons = 0;
    let invalidLessons = 0;
    let unmatchedStudents = 0;
    let mismatchedTutors = 0;
    
    for (const lesson of lessons) {
      // Check if this lesson belongs to the student's homeroom tutor
      const studentTutor = studentTutorMap.get(lesson.student_id);
      
      if (!studentTutor) {
        unmatchedStudents++;
        continue;
      }
      
      // Verify that the lesson's calendar matches the student's homeroom tutor
      // lesson.tutor_calendar_id should match studentTutor.email
      if (lesson.tutor_calendar_id && studentTutor.email) {
        if (lesson.tutor_calendar_id.toLowerCase() !== studentTutor.email.toLowerCase()) {
          mismatchedTutors++;
          continue; // Skip lessons that don't belong to the student's homeroom tutor
        }
      }
      
      // Insert the lesson
      try {
        await query(
          `INSERT INTO lessons 
            (calendar_event_id, student_id, tutor_name, lesson_date, title, description, meet_link, lesson_time, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
          ON CONFLICT (calendar_event_id) 
          DO UPDATE SET
            student_id = EXCLUDED.student_id,
            tutor_name = EXCLUDED.tutor_name,
            lesson_date = EXCLUDED.lesson_date,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            meet_link = EXCLUDED.meet_link,
            lesson_time = EXCLUDED.lesson_time,
            updated_at = CURRENT_TIMESTAMP`,
          [
            lesson.calendar_event_id,
            lesson.student_id,
            lesson.tutor_name,
            lesson.lesson_date,
            lesson.title,
            lesson.description,
            lesson.meet_link,
            lesson.lesson_time
          ]
        );
        validLessons++;
      } catch (insertError) {
        console.error('Calendar lesson upsert failed');
        invalidLessons++;
      }
    }
    
    console.log(`Validation results: ${validLessons} valid, ${invalidLessons} invalid, ${unmatchedStudents} unmatched students, ${mismatchedTutors} mismatched tutors`);
    
    return c.json({
      success: true,
      message: `Synced ${validLessons} lessons for ${year}/${month} (${unmatchedStudents} unmatched, ${mismatchedTutors} tutor mismatches)`,
      count: validLessons,
      skipped: unmatchedStudents + mismatchedTutors,
      errors: invalidLessons
    });
  } catch (error) {
    console.error('Calendar lesson sync failed');
    return c.json({
      success: false,
      error: 'Failed to sync lessons'
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
    console.error('Monthly lesson fetch failed');
    return c.json({
      success: false,
      error: 'Failed to fetch monthly lessons'
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
    console.error('Student lesson fetch failed');
    return c.json({
      success: false,
      error: 'Failed to fetch student lessons'
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
    console.error('Lesson statistics fetch failed');
    return c.json({
      success: false,
      error: 'Failed to fetch lesson statistics'
    }, 500);
  }
});

/**
 * GET /api/lessons/sync-from-sheet
 * Sync lessons from Google Sheets (populated by GAS)
 */
app.get('/sync-from-sheet', async (c) => {
  let client;
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    if (!spreadsheetId) {
      return c.json({
        success: false,
        error: 'GOOGLE_SHEET_ID not configured in environment variables'
      }, 400);
    }
    
    // Get last sync time
    let syncMeta = null;
    try {
      syncMeta = await getLastSyncTime(spreadsheetId);
      console.log('GAS sync metadata loaded');
    } catch (error) {
      console.warn('GAS sync metadata lookup failed');
      // Continue without sync time
    }
    
    // Fetch lessons from sheet
    let lessons = [];
    try {
      lessons = await fetchLessonsFromSheet(spreadsheetId);
      console.log(`Fetched ${lessons.length} lessons from Google Sheets`);
    } catch (error) {
      console.error('Google Sheets lesson fetch failed');
      // Google API が一時的に失敗した場合はスキップして成功を返す
      console.warn('⚠️ Google Sheets unavailable — skipping lesson sync, using existing DB data');
      return c.json({
        success: true,
        message: 'Google Sheets unavailable (Google API error) — using existing DB data',
        synced: 0,
        errors: 0,
        cache_error: true
      });
    }
    
    // A blank or malformed source is not an authoritative request to remove lessons.
    if (!Array.isArray(lessons) || lessons.length === 0 || lessons.some(lesson =>
      !lesson || typeof lesson.calendar_event_id !== 'string' ||
      !lesson.calendar_event_id.trim() || lesson.calendar_event_id.includes('\u0000'))) {
      return c.json({ success: false, error: 'Lesson source is empty or invalid; existing lessons were preserved' }, 400);
    }

    // Get student-tutor mapping from database
    const studentTutorMapping = await query(`
      SELECT 
        s.student_id,
        s.homeroom_tutor,
        t.email as tutor_email,
        t.notion_name as tutor_notion_name
      FROM students s
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
      WHERE s.student_id IS NOT NULL
    `);
    
    const studentTutorMap = new Map();
    studentTutorMapping.rows.forEach(row => {
      if (row.tutor_email) {
        studentTutorMap.set(row.student_id, {
          email: row.tutor_email,
          notion_name: row.tutor_notion_name,
          homeroom_tutor: row.homeroom_tutor
        });
      }
    });
    
    console.log(`Built student-tutor mapping for ${studentTutorMap.size} students`);
    
    let validLessons = 0;
    let invalidLessons = 0;
    let unmatchedStudents = 0;
    let mismatchedTutors = 0;

    client = await getClient();
    await client.query('BEGIN');
    
    for (const lesson of lessons) {
      // Check if student exists and has a tutor
      const studentTutor = studentTutorMap.get(lesson.student_id);
      
      if (!studentTutor) {
        unmatchedStudents++;
        continue;
      }
      
      // Verify tutor email matches
      if (lesson.tutor_email && studentTutor.email) {
        if (lesson.tutor_email.toLowerCase() !== studentTutor.email.toLowerCase()) {
          mismatchedTutors++;
          continue;
        }
      }
      
      // Insert lesson
      try {
        await client.query(
          `INSERT INTO lessons 
            (calendar_event_id, student_id, tutor_name, lesson_date, title, description, meet_link, lesson_time, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
          ON CONFLICT (calendar_event_id) 
          DO UPDATE SET
            student_id = EXCLUDED.student_id,
            tutor_name = EXCLUDED.tutor_name,
            lesson_date = EXCLUDED.lesson_date,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            meet_link = EXCLUDED.meet_link,
            lesson_time = EXCLUDED.lesson_time,
            updated_at = CURRENT_TIMESTAMP`,
          [
            lesson.calendar_event_id,
            lesson.student_id,
            lesson.tutor_name,
            lesson.lesson_date,
            lesson.title,
            lesson.description,
            lesson.meet_link,
            lesson.lesson_time
          ]
        );
        validLessons++;
        
      } catch (insertError) {
        console.error('Sheet lesson upsert failed');
        invalidLessons++;
        throw insertError;
      }
    }
    
    console.log(`Validation results: ${validLessons} valid, ${invalidLessons} invalid, ${unmatchedStudents} unmatched, ${mismatchedTutors} tutor mismatches`);
    
    await client.query('COMMIT');
    // Source completeness is not guaranteed. Absence alone must not delete stored lessons.
    console.log('Automatic lesson deletion skipped: source completeness is unverified');
    
    return c.json({
      success: true,
      message: `Synced ${validLessons} lessons from Google Sheets`,
      count: validLessons,
      skipped: unmatchedStudents + mismatchedTutors,
      errors: invalidLessons,
      deleted: 0,
      cleanup_skipped: true,
      lastGasSync: syncMeta?.lastSync,
      totalEventsInSheet: lessons.length
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch { console.error('Sheet lesson rollback failed'); }
    }
    console.error('Sheet lesson sync failed');
    return c.json({
      success: false,
      error: 'Failed to sync lessons from sheet'
    }, 500);
  } finally {
    client?.release();
  }
});

export default app;
