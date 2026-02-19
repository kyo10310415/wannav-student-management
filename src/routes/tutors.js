import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchTutors } from '../services/notionService.js';
import { fetchTutorsFromCache, getCacheSyncTime } from '../services/cacheService.js';

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
 * Sync tutors from cache spreadsheet to database (fast)
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
    
    // Fetch tutors from cache
    const tutors = await fetchTutorsFromCache(cacheSpreadsheetId);
    
    // Filter out tutors without employee_id or name
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

    console.log(`Found ${tutors.length} tutors, ${validTutors.length} valid, ${skippedTutors.length} skipped`);
    
    // Upsert tutors into database
    let successCount = 0;
    let errorCount = 0;

    for (const tutor of validTutors) {
      try {
        await query(
          `INSERT INTO tutors 
            (employee_id, name, tutor_name, email, team, notion_name, job_type, status, monthly_available_hours, notion_page_id, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
          ON CONFLICT (employee_id) 
          DO UPDATE SET
            name = EXCLUDED.name,
            tutor_name = EXCLUDED.tutor_name,
            email = EXCLUDED.email,
            team = EXCLUDED.team,
            notion_name = EXCLUDED.notion_name,
            job_type = EXCLUDED.job_type,
            status = EXCLUDED.status,
            monthly_available_hours = EXCLUDED.monthly_available_hours,
            notion_page_id = EXCLUDED.notion_page_id,
            updated_at = CURRENT_TIMESTAMP`,
          [
            tutor.employee_id,
            tutor.name,
            tutor.tutor_name,
            tutor.email,
            tutor.team,
            tutor.notion_name,
            tutor.job_type,
            tutor.status,
            null, // monthly_available_hours not in cache
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
      message: `Synced ${successCount} tutors from cache (${errorCount} errors, ${skippedTutors.length} skipped)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedTutors.length,
      lastCacheSync: syncMeta?.lastSync
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
