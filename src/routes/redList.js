import { Hono } from 'hono';
import { calculateRedListScore, updateRedList, updateAllRedLists, getRedList, getAllRedLists } from '../services/redListService.js';
import { query } from '../db/connection.js';

const app = new Hono();

/**
 * GET /api/red-list
 * Get red list for current month
 */
app.get('/', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    const redLists = await getAllRedLists(yearMonth);
    
    return c.json({
      success: true,
      data: redLists,
      count: redLists.length
    });
  } catch (error) {
    console.error('Error fetching red lists:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/red-list/update
 * Update red list for all students
 */
app.post('/update', async (c) => {
  try {
    let yearMonth = null;
    
    // Try to parse JSON body, but don't fail if it's empty
    try {
      const body = await c.req.json();
      yearMonth = body.yearMonth;
    } catch (e) {
      // Body is empty or invalid, use default (current month)
    }
    
    const result = await updateAllRedLists(yearMonth);
    
    return c.json({
      success: true,
      message: `Red list updated: ${result.updated} students, ${result.errors} errors`,
      data: result
    });
  } catch (error) {
    console.error('Error updating red lists:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/red-list/update/:studentId
 * Update red list for a specific student
 */
app.post('/update/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    let yearMonth = null;
    
    // Try to parse JSON body, but don't fail if it's empty
    try {
      const body = await c.req.json();
      yearMonth = body.yearMonth;
    } catch (e) {
      // Body is empty or invalid, use default (current month)
    }
    
    const scores = await updateRedList(studentId, yearMonth);
    
    return c.json({
      success: true,
      message: `Red list updated for ${studentId}`,
      data: scores
    });
  } catch (error) {
    console.error('Error updating red list:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/red-list/history
 * Get red list history for a specific month
 */
app.get('/history', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    
    if (!yearMonth) {
      return c.json({
        success: false,
        error: 'yearMonth is required'
      }, 400);
    }
    
    const result = await query(
      `SELECT 
        rlh.*,
        s.name as student_name,
        s.homeroom_tutor
       FROM red_list_history rlh
       LEFT JOIN students s ON rlh.student_id = s.student_id
       WHERE rlh.year_month = $1
       ORDER BY rlh.final_score DESC, rlh.student_id`,
      [yearMonth]
    );
    
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching red list history:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/red-list/:studentId
 * Get red list for a specific student
 */
app.get('/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const { yearMonth } = c.req.query();
    
    const redList = await getRedList(studentId, yearMonth);
    
    if (!redList) {
      // Calculate and save if not exists
      const scores = await calculateRedListScore(studentId, yearMonth || getCurrentYearMonth());
      await updateRedList(studentId, yearMonth);
      
      return c.json({
        success: true,
        data: scores,
        message: 'Calculated and saved'
      });
    }
    
    return c.json({
      success: true,
      data: redList
    });
  } catch (error) {
    console.error('Error fetching red list:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default app;
