import { Hono } from 'hono';
import { sendDailyReminders, testReminder } from '../services/reminderService.js';
import { sendTestWebhook } from '../services/discordService.js';

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

/**
 * POST /api/reminders/test-webhook
 * Test webhook notification
 * Body: { webhookUrl: "...", discordUserId: "...", message: "..." }
 */
app.post('/test-webhook', async (c) => {
  try {
    const { webhookUrl, discordUserId, message } = await c.req.json();
    
    if (!webhookUrl) {
      return c.json({
        success: false,
        error: 'webhookUrl is required'
      }, 400);
    }
    
    const result = await sendTestWebhook(webhookUrl, discordUserId, message);
    
    if (result.success) {
      return c.json({
        success: true,
        message: 'Test webhook sent successfully'
      });
    } else {
      return c.json({
        success: false,
        error: result.error || result.reason
      }, 500);
    }
  } catch (error) {
    console.error('Error sending test webhook:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/reminders/test-student-info/:studentId
 * Test fetching student Discord info from Google Sheets
 * Returns: { studentId, chatUrl, discordId }
 */
app.get('/test-student-info/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    
    if (!studentId) {
      return c.json({
        success: false,
        error: 'studentId is required'
      }, 400);
    }
    
    // Import getStudentDiscordInfo (internal function)
    const { getSheets } = await import('../services/sheetsService.js');
    
    const sheets = getSheets();
    const spreadsheetId = '1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM';
    const sheetName = '❶RAW_生徒様情報';
    
    console.log(`\n[Test] Fetching student info for: ${studentId}`);
    console.log(`[Test] Spreadsheet: ${spreadsheetId}`);
    console.log(`[Test] Sheet: ${sheetName}`);
    
    // Fetch data from Google Sheets (B, G, M columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!B2:M`,
    });

    const rows = response.data.values || [];
    console.log(`[Test] Fetched ${rows.length} student records`);

    // Find student by ID (B列 = index 0)
    const studentRow = rows.find(row => row[0] === studentId);
    
    if (!studentRow) {
      console.warn(`[Test] Student ${studentId} not found`);
      return c.json({
        success: false,
        error: `Student ${studentId} not found in Google Sheets`,
        totalRecords: rows.length
      }, 404);
    }

    // Extract data
    // B列 = index 0 (学籍番号)
    // G列 = index 5 (Discord ID)
    // M列 = index 11 (チャットURL)
    const discordId = studentRow[5] ? studentRow[5].trim() : null;
    const chatUrl = studentRow[11] ? studentRow[11].trim() : null;

    console.log(`[Test] ✅ Student ${studentId} found:`);
    console.log(`[Test]   Discord ID: ${discordId || '(not set)'}`);
    console.log(`[Test]   Chat URL: ${chatUrl || '(not set)'}`);

    return c.json({
      success: true,
      data: {
        studentId: studentId,
        chatUrl: chatUrl,
        discordId: discordId,
        hasDiscordId: !!discordId,
        hasChatUrl: !!chatUrl
      }
    });
  } catch (error) {
    console.error('[Test] Error fetching student info:', error);
    return c.json({
      success: false,
      error: error.message,
      details: error.response?.data?.error || null
    }, 500);
  }
});

export default app;
