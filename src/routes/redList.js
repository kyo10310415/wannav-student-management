import { Hono } from 'hono';
import { calculateRedListScore, updateRedList, updateAllRedLists, getRedList, getAllRedLists } from '../services/redListService.js';

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

/**
 * POST /api/red-list/update
 * Update red list for all students
 */
app.post('/update', async (c) => {
  try {
    const { yearMonth } = await c.req.json();
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
    const { yearMonth } = await c.req.json();
    
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

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default app;
