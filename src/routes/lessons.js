import { Hono } from 'hono';
import { query } from '../db/connection.js';
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
        if (unmatchedStudents <= 5) {
          console.log(`Student not found or no tutor assigned: ${lesson.student_id}`);
        }
        continue;
      }
      
      // Verify that the lesson's calendar matches the student's homeroom tutor
      // lesson.tutor_calendar_id should match studentTutor.email
      if (lesson.tutor_calendar_id && studentTutor.email) {
        if (lesson.tutor_calendar_id.toLowerCase() !== studentTutor.email.toLowerCase()) {
          mismatchedTutors++;
          if (mismatchedTutors <= 5) {
            console.log(`Tutor mismatch for ${lesson.student_id}: calendar=${lesson.tutor_calendar_id}, expected=${studentTutor.email}`);
          }
          continue; // Skip lessons that don't belong to the student's homeroom tutor
        }
      }
      
      // Insert the lesson
      try {
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
        validLessons++;
      } catch (insertError) {
        console.error(`Error inserting lesson ${lesson.calendar_event_id}:`, insertError.message);
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

/**
 * GET /api/lessons/sync-from-sheet
 * Sync lessons from Google Sheets (populated by GAS)
 */
app.get('/sync-from-sheet', async (c) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    if (!spreadsheetId) {
      return c.json({
        success: false,
        error: 'GOOGLE_SHEET_ID not configured in environment variables'
      }, 400);
    }
    
    // Get last sync time
    const syncMeta = await getLastSyncTime(spreadsheetId);
    console.log('Last GAS sync:', syncMeta);
    
    // Fetch lessons from sheet
    const lessons = await fetchLessonsFromSheet(spreadsheetId);
    console.log(`Fetched ${lessons.length} lessons from Google Sheets`);
    
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
    
    for (const lesson of lessons) {
      // Check if student exists and has a tutor
      const studentTutor = studentTutorMap.get(lesson.student_id);
      
      if (!studentTutor) {
        unmatchedStudents++;
        if (unmatchedStudents <= 5) {
          console.log(`Student not found or no tutor assigned: ${lesson.student_id}`);
        }
        continue;
      }
      
      // Verify tutor email matches
      if (lesson.tutor_email && studentTutor.email) {
        if (lesson.tutor_email.toLowerCase() !== studentTutor.email.toLowerCase()) {
          mismatchedTutors++;
          if (mismatchedTutors <= 5) {
            console.log(`Tutor mismatch for ${lesson.student_id}: sheet=${lesson.tutor_email}, expected=${studentTutor.email}`);
          }
          continue;
        }
      }
      
      // Insert lesson
      try {
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
        validLessons++;
      } catch (insertError) {
        console.error(`Error inserting lesson ${lesson.calendar_event_id}:`, insertError.message);
        invalidLessons++;
      }
    }
    
    console.log(`Validation results: ${validLessons} valid, ${invalidLessons} invalid, ${unmatchedStudents} unmatched, ${mismatchedTutors} tutor mismatches`);
    
    return c.json({
      success: true,
      message: `Synced ${validLessons} lessons from Google Sheets`,
      count: validLessons,
      skipped: unmatchedStudents + mismatchedTutors,
      errors: invalidLessons,
      lastGasSync: syncMeta?.lastSync,
      totalEventsInSheet: lessons.length
    });
  } catch (error) {
    console.error('Error syncing lessons from sheet:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
