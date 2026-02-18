import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchStudents } from '../services/notionService.js';

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
 * Sync students from Notion to database
 */
app.get('/sync', async (c) => {
  try {
    const students = await fetchStudents();
    
    // Upsert students into database
    for (const student of students) {
      await query(
        `INSERT INTO students 
          (student_id, name, status, contract_plan, character_name, homeroom_tutor, notion_page_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (student_id) 
        DO UPDATE SET
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          contract_plan = EXCLUDED.contract_plan,
          character_name = EXCLUDED.character_name,
          homeroom_tutor = EXCLUDED.homeroom_tutor,
          notion_page_id = EXCLUDED.notion_page_id,
          updated_at = CURRENT_TIMESTAMP`,
        [
          student.student_id,
          student.name,
          student.status,
          student.contract_plan,
          student.character_name,
          student.homeroom_tutor,
          student.notion_page_id
        ]
      );
    }
    
    return c.json({
      success: true,
      message: `Synced ${students.length} students from Notion`,
      count: students.length
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
