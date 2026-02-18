import { Hono } from 'hono';
import { sendDailyReminders, testReminder } from '../services/reminderService.js';

const app = new Hono();

/**
 * POST /api/reminders/send
 * Manually trigger daily reminders
 */
app.post('/send', async (c) => {
  try {
    const results = await sendDailyReminders();
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    return c.json({
      success: true,
      message: `Sent ${successCount} reminders successfully, ${failCount} failed`,
      results
    });
  } catch (error) {
    console.error('Error sending reminders:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/reminders/test
 * Test reminder for a specific student
 * Body: { studentId: "OLTS240488-AR" }
 */
app.post('/test', async (c) => {
  try {
    const { studentId } = await c.req.json();
    
    if (!studentId) {
      return c.json({
        success: false,
        error: 'studentId is required'
      }, 400);
    }
    
    await testReminder(studentId);
    
    return c.json({
      success: true,
      message: `Test reminder sent for student ${studentId}`
    });
  } catch (error) {
    console.error('Error sending test reminder:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
