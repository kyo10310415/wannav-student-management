import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchTutors } from '../services/notionService.js';
import { fetchTutorsFromCache, fetchSatisfactionFromCache, getCacheSyncTime } from '../services/cacheService.js';

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
    
    // Get list of employee_ids from cache
    const cacheEmployeeIds = validTutors.map(t => t.employee_id);
    console.log(`Cache has ${cacheEmployeeIds.length} valid employee IDs`);
    
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
    
    // Find and delete tutors that are in DB but not in cache
    let deletedCount = 0;
    try {
      // Get all tutors from database
      const dbTutorsResult = await query('SELECT employee_id FROM tutors');
      const dbEmployeeIds = dbTutorsResult.rows.map(row => row.employee_id);
      
      // Find employee_ids that are in DB but not in cache
      const toDelete = dbEmployeeIds.filter(id => !cacheEmployeeIds.includes(id));
      
      if (toDelete.length > 0) {
        console.log(`Found ${toDelete.length} tutors to delete: ${toDelete.join(', ')}`);
        
        // Delete these tutors
        for (const employeeId of toDelete) {
          try {
            await query('DELETE FROM tutors WHERE employee_id = $1', [employeeId]);
            deletedCount++;
            console.log(`✅ Deleted tutor: ${employeeId}`);
          } catch (deleteError) {
            console.error(`❌ Error deleting tutor ${employeeId}:`, deleteError.message);
          }
        }
      } else {
        console.log('No tutors to delete');
      }
    } catch (deleteCheckError) {
      console.error('Error checking for tutors to delete:', deleteCheckError.message);
    }
    
    return c.json({
      success: true,
      message: `Synced ${successCount} tutors from cache (${errorCount} errors, ${skippedTutors.length} skipped, ${deletedCount} deleted)`,
      count: successCount,
      errors: errorCount,
      skipped: skippedTutors.length,
      deleted: deletedCount,
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

/**
 * PUT /api/tutors/:id/capacity
 * Update tutor student capacity
 */
app.put('/:id/capacity', async (c) => {
  try {
    const employeeId = c.req.param('id');
    const { student_capacity } = await c.req.json();
    
    // Validate student_capacity
    if (student_capacity !== null && (isNaN(student_capacity) || student_capacity < 0)) {
      return c.json({
        success: false,
        error: 'Invalid student_capacity value'
      }, 400);
    }
    
    const result = await query(
      `UPDATE tutors 
       SET student_capacity = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE employee_id = $2 
       RETURNING *`,
      [student_capacity, employeeId]
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
    console.error('Error updating tutor capacity:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/tutors/satisfaction/all
 * Get satisfaction data for all tutors with monthly averages
 */
app.get('/satisfaction/all', async (c) => {
  try {
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    
    if (!cacheSpreadsheetId) {
      return c.json({
        success: false,
        error: 'GOOGLE_CACHE_SHEET_ID or GOOGLE_SHEET_ID not configured'
      }, 400);
    }
    
    // Fetch satisfaction data from cache
    const satisfactionData = await fetchSatisfactionFromCache(cacheSpreadsheetId);
    
    // Group by tutor and month, calculate averages
    const tutorMonthlyData = {};
    
    satisfactionData.forEach(record => {
      const tutorName = record.tutor_name;
      const yearMonth = record.year_month; // YYYY/M format
      const score = parseFloat(record.satisfaction_score);
      
      if (!tutorName || !yearMonth || isNaN(score)) return;
      
      if (!tutorMonthlyData[tutorName]) {
        tutorMonthlyData[tutorName] = {};
      }
      
      if (!tutorMonthlyData[tutorName][yearMonth]) {
        tutorMonthlyData[tutorName][yearMonth] = {
          scores: [],
          reasons: [],
          studentNames: []
        };
      }
      
      tutorMonthlyData[tutorName][yearMonth].scores.push(score);
      if (record.reason) {
        tutorMonthlyData[tutorName][yearMonth].reasons.push({
          studentName: record.student_name,
          reason: record.reason,
          score: score
        });
      }
      if (record.student_name) {
        tutorMonthlyData[tutorName][yearMonth].studentNames.push(record.student_name);
      }
    });
    
    // Calculate averages
    const result = {};
    for (const tutorName in tutorMonthlyData) {
      result[tutorName] = {};
      for (const yearMonth in tutorMonthlyData[tutorName]) {
        const data = tutorMonthlyData[tutorName][yearMonth];
        const average = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
        result[tutorName][yearMonth] = {
          average: average, // 丸めない、そのまま保存
          count: data.scores.length,
          reasons: data.reasons,
          studentNames: data.studentNames
        };
      }
    }
    
    return c.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching satisfaction data:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/tutors/monthly-stats/:year/:month
 * Get monthly helper request, accepted, and reschedule counts for all tutors
 */
app.get('/monthly-stats/:year/:month', async (c) => {
  try {
    const year = parseInt(c.req.param('year'));
    const month = parseInt(c.req.param('month'));
    
    if (!year || !month || month < 1 || month > 12) {
      return c.json({
        success: false,
        error: 'Invalid year or month'
      }, 400);
    }
    
    // Calculate start and end dates for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    console.log(`[Tutor Monthly Stats] Fetching stats for ${year}/${month}`);
    console.log(`[Tutor Monthly Stats] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get helper request counts (status='pending' or 'accepted' or 'completed')
    // Group by leader_email (the tutor who requested help)
    const helperRequestResult = await query(`
      SELECT 
        leader_email as tutor_email,
        COUNT(*) as request_count
      FROM helper_requests
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY leader_email
    `, [startDate, endDate]);
    
    // Get helper accepted counts
    // Group by assigned_tutor_email (the tutor who accepted the request)
    const helperAcceptedResult = await query(`
      SELECT 
        assigned_tutor_email as tutor_email,
        COUNT(*) as accepted_count
      FROM helper_requests
      WHERE created_at >= $1 AND created_at <= $2
        AND status IN ('accepted', 'completed')
        AND assigned_tutor_email IS NOT NULL
      GROUP BY assigned_tutor_email
    `, [startDate, endDate]);
    
    // Get reschedule counts
    // Count lessons where reschedule_reason is not null or reschedule_count > 0
    const rescheduleResult = await query(`
      SELECT 
        tutor_name,
        COUNT(*) as reschedule_count
      FROM lessons
      WHERE lesson_date >= $1 AND lesson_date <= $2
        AND (reschedule_reason IS NOT NULL OR reschedule_count > 0)
      GROUP BY tutor_name
    `, [startDate, endDate]);
    
    // Build result object: tutor_email/tutor_name -> counts
    const result = {};
    
    // Add helper request counts
    helperRequestResult.rows.forEach(row => {
      if (!result[row.tutor_email]) {
        result[row.tutor_email] = { helperRequestCount: 0, helperAcceptedCount: 0, rescheduleCount: 0 };
      }
      result[row.tutor_email].helperRequestCount = parseInt(row.request_count);
    });
    
    // Add helper accepted counts
    helperAcceptedResult.rows.forEach(row => {
      if (!result[row.tutor_email]) {
        result[row.tutor_email] = { helperRequestCount: 0, helperAcceptedCount: 0, rescheduleCount: 0 };
      }
      result[row.tutor_email].helperAcceptedCount = parseInt(row.accepted_count);
    });
    
    // Add reschedule counts (by tutor_name, not email)
    const rescheduleByName = {};
    rescheduleResult.rows.forEach(row => {
      rescheduleByName[row.tutor_name] = parseInt(row.reschedule_count);
    });
    
    console.log(`[Tutor Monthly Stats] Helper requests: ${helperRequestResult.rows.length} tutors`);
    console.log(`[Tutor Monthly Stats] Helper accepted: ${helperAcceptedResult.rows.length} tutors`);
    console.log(`[Tutor Monthly Stats] Reschedules: ${rescheduleResult.rows.length} tutors`);
    
    return c.json({
      success: true,
      data: {
        byEmail: result,
        rescheduleByName
      }
    });
  } catch (error) {
    console.error('Error fetching monthly tutor stats:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/tutors/export-satisfaction
 * Export tutor satisfaction data to Google Spreadsheet
 */
app.post('/export-satisfaction', async (c) => {
  try {
    const { rows, sortedMonths } = await c.req.json();
    
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return c.json({
        success: false,
        error: 'Invalid data format'
      }, 400);
    }
    
    const { google } = await import('googleapis');
    const sheets = google.sheets('v4');
    
    // Get service account credentials
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const authClient = await auth.getClient();
    
    // Use existing cache spreadsheet or create new one
    const spreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    
    if (!spreadsheetId) {
      return c.json({
        success: false,
        error: 'GOOGLE_CACHE_SHEET_ID not configured'
      }, 500);
    }
    
    // Sheet name with timestamp
    const now = new Date();
    const sheetName = `Tutor満足度_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Create new sheet
    await sheets.spreadsheets.batchUpdate({
      auth: authClient,
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: {
                rowCount: rows.length + 10,
                columnCount: sortedMonths.length + 5
              }
            }
          }
        }]
      }
    });
    
    // Write data
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: rows
      }
    });
    
    // Apply formatting
    const requests = [];
    
    // Freeze header row
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: (await sheets.spreadsheets.get({
            auth: authClient,
            spreadsheetId,
            ranges: [sheetName]
          })).data.sheets[0].properties.sheetId,
          gridProperties: {
            frozenRowCount: 1,
            frozenColumnCount: 2
          }
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
      }
    });
    
    // Merge cells for tutor names (every 3 rows, column A)
    for (let i = 1; i < rows.length; i += 3) {
      requests.push({
        mergeCells: {
          range: {
            sheetId: (await sheets.spreadsheets.get({
              auth: authClient,
              spreadsheetId,
              ranges: [sheetName]
            })).data.sheets[0].properties.sheetId,
            startRowIndex: i,
            endRowIndex: i + 3,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          mergeType: 'MERGE_ALL'
        }
      });
    }
    
    // Apply formatting
    await sheets.spreadsheets.batchUpdate({
      auth: authClient,
      spreadsheetId,
      resource: {
        requests
      }
    });
    
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${(await sheets.spreadsheets.get({
      auth: authClient,
      spreadsheetId,
      ranges: [sheetName]
    })).data.sheets[0].properties.sheetId}`;
    
    console.log(`[Export] Satisfaction data exported to ${sheetName}`);
    
    return c.json({
      success: true,
      spreadsheetUrl,
      sheetName
    });
  } catch (error) {
    console.error('Error exporting satisfaction data:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
