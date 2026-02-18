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
    
    // Filter out students without student_id (required field)
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

    // Log first 10 skipped students for debugging
    if (skippedStudents.length > 0) {
      console.log('=== SKIPPED STUDENTS (first 10) ===');
      console.log(JSON.stringify(skippedStudents.slice(0, 10), null, 2));
    }

    console.log(`Found ${students.length} students, ${validStudents.length} valid (with student_id), ${skippedStudents.length} skipped`);
    
    // Upsert students into database
    let successCount = 0;
    let errorCount = 0;

    for (const student of validStudents) {
      try {
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
        successCount++;
      } catch (error) {
        console.error(`Error inserting student ${student.student_id}:`, error.message);
        errorCount++;
      }
    }
    
    return c.json({
      success: true,
      message: `Synced ${successCount} students from Notion (${errorCount} errors, ${skippedStudents.length} skipped)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedStudents.length,
      skipped_sample: skippedStudents.slice(0, 5) // Return first 5 skipped for inspection
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
