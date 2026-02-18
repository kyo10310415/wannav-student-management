import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchTutors } from '../services/notionService.js';

const app = new Hono();

/**
 * GET /api/tutors
 * Get all tutors
 */
app.get('/', async (c) => {
  try {
    const result = await query(
      'SELECT * FROM tutors ORDER BY name ASC'
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching tutors:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/tutors/sync
 * Sync tutors from Notion to database
 */
app.get('/sync', async (c) => {
  try {
    const tutors = await fetchTutors();
    
    // Upsert tutors into database
    for (const tutor of tutors) {
      await query(
        `INSERT INTO tutors 
          (employee_id, name, email, team, notion_name, monthly_available_hours, notion_page_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (employee_id) 
        DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          team = EXCLUDED.team,
          notion_name = EXCLUDED.notion_name,
          monthly_available_hours = EXCLUDED.monthly_available_hours,
          notion_page_id = EXCLUDED.notion_page_id,
          updated_at = CURRENT_TIMESTAMP`,
        [
          tutor.employee_id,
          tutor.name,
          tutor.email,
          tutor.team,
          tutor.notion_name,
          tutor.monthly_available_hours,
          tutor.notion_page_id
        ]
      );
    }
    
    return c.json({
      success: true,
      message: `Synced ${tutors.length} tutors from Notion`,
      count: tutors.length
    });
  } catch (error) {
    console.error('Error syncing tutors:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/tutors/:id
 * Get tutor by employee_id
 */
app.get('/:id', async (c) => {
  try {
    const employeeId = c.req.param('id');
    
    const result = await query(
      'SELECT * FROM tutors WHERE employee_id = $1',
      [employeeId]
    );
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Tutor not found'
      }, 404);
    }
    
    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching tutor:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
