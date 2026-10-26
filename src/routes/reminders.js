import { Hono } from 'hono';
import { sendDailyReminders, testReminder } from '../services/reminderService.js';
import { createWebhookTestHandler } from '../security/webhookTest.js';
import { query } from '../db/connection.js';
import axios from 'axios';
import { sendDailyStatsReport } from '../services/statsReportService.js';

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
    console.error('Error sending reminders:');
    return c.json({
      success: false,
      error: 'Reminder operation failed'
    }, 500);
  }
});

/**
 * POST /api/reminders/test
 * Test reminder for a specific student
 * Body: { studentId: "STUDENT_EXAMPLE" }
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
    console.error('Error sending test reminder:');
    return c.json({
      success: false,
      error: 'Reminder operation failed'
    }, 500);
  }
});

// Administrator-only synthetic delivery to a registered Discord webhook.
const webhookTest = createWebhookTestHandler({ query, post: (...args) => axios.post(...args) });
app.post('/test-notification', webhookTest);
app.post('/test-webhook', webhookTest);

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
    
    console.log('[Reminders] Fetching student delivery information');
    
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
      console.warn('[Reminders] Student not found');
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

    console.log('[Reminders] Student delivery information found');

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
    console.error('[Test] Error fetching student info:');
    return c.json({
      success: false,
      error: 'Reminder operation failed',
      details: null
    }, 500);
  }
});

/**
 * GET /api/reminders/test-lesson-data
 * Test fetching tomorrow's lesson data from Google Sheets
 * Returns: Array of lesson objects with all fields
 */
app.get('/test-lesson-data', async (c) => {
  try {
    const { fetchLessonsForTomorrow } = await import('../services/sheetsService.js');
    
    console.log('\n[Test] Fetching tomorrow\'s lessons from Google Sheets...');
    
    const lessons = await fetchLessonsForTomorrow();
    
    console.log(`[Test] Found ${lessons.length} lessons for tomorrow`);
    
    
    return c.json({
      success: true,
      data: {
        totalLessons: lessons.length,
        lessons: lessons.map(lesson => ({
          student_id: lesson.student_id,
          tutor_name: lesson.tutor_name,
          tutor_email: lesson.tutor_email,
          lesson_date: lesson.lesson_date,
          lesson_date_parsed: lesson.lesson_date ? new Date(lesson.lesson_date).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
          title: lesson.title,
          description: lesson.description,
          meet_link: lesson.meet_link,
          has_student_id: !!lesson.student_id,
          has_tutor_name: !!lesson.tutor_name,
          has_meet_link: !!lesson.meet_link
        }))
      }
    });
  } catch (error) {
    console.error('[Test] Error fetching lesson data:');
    return c.json({
      success: false,
      error: 'Reminder operation failed'
    }, 500);
  }
});

/**
 * POST /api/reminders/send-stats-report
 * Manually trigger daily statistics report
 */
app.post('/send-stats-report', async (c) => {
  try {
    await sendDailyStatsReport();
    
    return c.json({
      success: true,
      message: 'Statistics report sent successfully'
    });
  } catch (error) {
    console.error('Error sending statistics report:');
    return c.json({
      success: false,
      error: 'Reminder operation failed'
    }, 500);
  }
});

export default app;
