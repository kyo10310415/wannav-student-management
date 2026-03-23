import { Hono } from 'hono';
import sendLessonReportReminder from '../jobs/lessonReportReminder.js';

const app = new Hono();

/**
 * POST /api/lesson-report-reminder/trigger
 * Manually trigger lesson report reminder job (for testing)
 */
app.post('/trigger', async (c) => {
  try {
    console.log('[API] Manual trigger: Lesson report reminder');
    
    // Run the job
    await sendLessonReportReminder();
    
    return c.json({
      success: true,
      message: 'Lesson report reminder job executed successfully'
    });
    
  } catch (error) {
    console.error('[API] Error triggering lesson report reminder:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
