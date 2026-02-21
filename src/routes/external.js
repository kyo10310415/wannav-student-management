import { Hono } from 'hono';
import { fetchLessonStartDates } from '../services/externalDbService.js';

const app = new Hono();

/**
 * GET /api/external/lesson-start-dates
 * Get lesson start dates from external DB
 */
app.get('/lesson-start-dates', async (c) => {
  try {
    const lessonStartDates = await fetchLessonStartDates();
    
    return c.json({
      success: true,
      data: lessonStartDates,
      count: Object.keys(lessonStartDates).length
    });
  } catch (error) {
    console.error('Error fetching lesson start dates:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
