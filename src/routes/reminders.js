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
 * POST /api/reminders/test-notification
 * Test reminder notification with actual lesson data
 * Body: { webhookUrl: "...", discordUserId: "..." }
 */
app.post('/test-notification', async (c) => {
  try {
    const { webhookUrl, discordUserId } = await c.req.json();
    
    if (!webhookUrl) {
      return c.json({
        success: false,
        error: 'webhookUrl is required'
      }, 400);
    }
    
    console.log('[Test Notification] Fetching tomorrow\'s lessons...');
    
    // Get tomorrow's lessons
    const { fetchLessonsForTomorrow } = await import('../services/sheetsService.js');
    const lessons = await fetchLessonsForTomorrow();
    
    if (lessons.length === 0) {
      return c.json({
        success: false,
        error: 'No lessons found for tomorrow'
      }, 404);
    }
    
    // Pick first lesson
    const lesson = lessons[0];
    console.log('[Test Notification] Using lesson:', {
      student_id: lesson.student_id,
      tutor_name: lesson.tutor_name,
      lesson_date: lesson.lesson_date
    });
    
    // Format lesson date
    const lessonDate = new Date(lesson.lesson_date);
    const dateStr = lessonDate.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      timeZone: 'Asia/Tokyo'
    });
    const timeStr = lessonDate.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo'
    });
    
    // Build reminder message
    let content = '';
    if (discordUserId) {
      content = `<@${discordUserId}>`;
    }
    
    // Create embed
    const embed = {
      title: '📅 レッスンリマインド（テスト）',
      description: '明日のレッスンのお知らせです！',
      color: 0x5865F2, // Discord blue
      fields: [
        {
          name: '日時',
          value: `${dateStr} ${timeStr}`,
          inline: false
        },
        {
          name: '講師',
          value: lesson.tutor_name || '未設定',
          inline: true
        },
        {
          name: '生徒ID',
          value: lesson.student_id,
          inline: true
        }
      ],
      footer: {
        text: 'WannaV レッスンリマインドシステム（テスト送信）'
      },
      timestamp: new Date().toISOString()
    };
    
    // Send webhook
    const axios = (await import('axios')).default;
    await axios.post(webhookUrl, {
      content: content,
      embeds: [embed]
    });
    
    console.log('[Test Notification] ✅ Test notification sent successfully');
    
    return c.json({
      success: true,
      message: 'Test notification sent successfully',
      lesson: {
        student_id: lesson.student_id,
        tutor_name: lesson.tutor_name,
        lesson_date: lessonDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        title: lesson.title
      }
    });
  } catch (error) {
    console.error('[Test Notification] Error:', error);
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
    
    if (lessons.length > 0) {
      console.log('[Test] Sample lesson data:');
      lessons.slice(0, 3).forEach((lesson, index) => {
        console.log(`\n[Test] Lesson ${index + 1}:`);
        console.log(`[Test]   Student ID: ${lesson.student_id || '(not found)'}`);
        console.log(`[Test]   Tutor: ${lesson.tutor_name || '(not found)'}`);
        console.log(`[Test]   Date: ${lesson.lesson_date}`);
        console.log(`[Test]   Title: ${lesson.title || '(not found)'}`);
      });
    }
    
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
          has_student_id: !!lesson.student_id,
          has_tutor_name: !!lesson.tutor_name
        }))
      }
    });
  } catch (error) {
    console.error('[Test] Error fetching lesson data:', error);
    return c.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, 500);
  }
});

export default app;
