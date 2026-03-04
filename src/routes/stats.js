import { Hono } from 'hono';
import { sendDailyStatsReport } from '../services/statsReportService.js';

const app = new Hono();

/**
 * POST /api/stats/send
 * 日次統計レポートを手動送信
 */
app.post('/send', async (c) => {
  try {
    console.log('📊 Manual stats report triggered');
    
    await sendDailyStatsReport();
    
    return c.json({
      success: true,
      message: '日次統計レポートを送信しました'
    });
  } catch (error) {
    console.error('Error sending manual stats report:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
