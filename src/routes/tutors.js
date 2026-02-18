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
    
    // Filter out tutors without employee_id or name (required fields)
    const skippedTutors = [];
    const validTutors = tutors.filter(tutor => {
      if (!tutor.employee_id) {
        skippedTutors.push({
          reason: 'no_employee_id',
          name: tutor.name || 'Unknown',
          email: tutor.email,
          notion_page_id: tutor.notion_page_id
        });
        return false;
      }
      if (!tutor.name) {
        skippedTutors.push({
          reason: 'no_name',
          employee_id: tutor.employee_id,
          email: tutor.email,
          notion_page_id: tutor.notion_page_id
        });
        return false;
      }
      return true;
    });

    // Log first 10 skipped tutors for debugging
    if (skippedTutors.length > 0) {
      console.log('=== SKIPPED TUTORS (first 10) ===');
      console.log(JSON.stringify(skippedTutors.slice(0, 10), null, 2));
    }

    console.log(`Found ${tutors.length} tutors, ${validTutors.length} valid (with employee_id and name), ${skippedTutors.length} skipped`);
    
    // Upsert tutors into database
    let successCount = 0;
    let errorCount = 0;

    for (const tutor of validTutors) {
      try {
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
        successCount++;
      } catch (error) {
        console.error(`Error inserting tutor ${tutor.employee_id}:`, error.message);
        errorCount++;
      }
    }
    
    return c.json({
      success: true,
      message: `Synced ${successCount} tutors from Notion (${errorCount} errors, ${skippedTutors.length} skipped)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedTutors.length,
      skipped_sample: skippedTutors.slice(0, 5) // Return first 5 skipped for inspection
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
