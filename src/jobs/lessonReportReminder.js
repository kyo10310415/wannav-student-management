import { query } from '../db/connection.js';
import { fetchLessonCompletionStatus } from '../services/cacheService.js';
import axios from 'axios';

/**
 * Normalize student ID for comparison
 */
function normalizeStudentId(id) {
  if (!id) return '';
  return id.toString()
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/－/g, '-')
    .toUpperCase();
}

/**
 * Send lesson report reminder to Discord
 */
async function sendLessonReportReminder() {
  try {
    console.log('[Lesson Report Reminder] Starting job...');
    
    const progressSpreadsheetId = process.env.PROGRESS_SPREADSHEET_ID;
    
    if (!progressSpreadsheetId) {
      console.error('[Lesson Report Reminder] PROGRESS_SPREADSHEET_ID not configured');
      return;
    }
    
    // Calculate yesterday's date in JST
    const now = new Date();
    const jstOffset = 9 * 60; // JST is UTC+9
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    
    // Get yesterday
    const yesterday = new Date(jstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${year}-${month}-${day}`;
    
    console.log(`[Lesson Report Reminder] Checking lessons for ${yesterdayStr}`);
    
    // Fetch lesson completion data from spreadsheet
    const lessonCompletionMap = await fetchLessonCompletionStatus(progressSpreadsheetId);
    
    // Get all lessons scheduled for yesterday
    const lessonsResult = await query(`
      SELECT 
        l.id,
        l.student_id,
        l.lesson_date,
        l.lesson_time,
        s.name as student_name,
        s.homeroom_tutor,
        t.tutor_name,
        t.team,
        t.email as tutor_email
      FROM lessons l
      JOIN students s ON l.student_id = s.student_id
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
      WHERE l.lesson_date = $1
      ORDER BY l.lesson_time
    `, [yesterdayStr]);
    
    const lessons = lessonsResult.rows;
    
    console.log(`[Lesson Report Reminder] Found ${lessons.length} lessons for ${yesterdayStr}`);
    
    if (lessons.length === 0) {
      console.log('[Lesson Report Reminder] No lessons found for yesterday');
      return;
    }
    
    // Get all users with Discord settings
    const usersResult = await query(`
      SELECT 
        u.id,
        u.email,
        u.discord_webhook_url,
        u.discord_user_id,
        t.tutor_name,
        t.team
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE u.discord_webhook_url IS NOT NULL
    `);
    
    const usersByEmail = {};
    const usersByTeam = {};
    
    usersResult.rows.forEach(user => {
      if (user.email) {
        usersByEmail[user.email.toLowerCase()] = user;
      }
      if (user.team) {
        if (!usersByTeam[user.team]) {
          usersByTeam[user.team] = [];
        }
        usersByTeam[user.team].push(user);
      }
    });
    
    console.log(`[Lesson Report Reminder] Found ${usersResult.rows.length} users with Discord settings`);
    
    // Get all leaders by team
    const leadersResult = await query(`
      SELECT 
        u.id,
        u.email,
        u.discord_webhook_url,
        u.discord_user_id,
        t.tutor_name,
        t.team
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE u.role IN ('admin', 'leader')
        AND u.discord_webhook_url IS NOT NULL
    `);
    
    const leadersByTeam = {};
    
    leadersResult.rows.forEach(leader => {
      if (leader.team) {
        if (!leadersByTeam[leader.team]) {
          leadersByTeam[leader.team] = [];
        }
        leadersByTeam[leader.team].push(leader);
      }
    });
    
    console.log(`[Lesson Report Reminder] Found ${leadersResult.rows.length} leaders with Discord settings`);
    
    // Check each lesson
    let remindersSent = 0;
    
    for (const lesson of lessons) {
      const normalizedId = normalizeStudentId(lesson.student_id);
      
      // PRIORITY 1: Check if lesson report exists in DATABASE
      let hasReport = false;
      
      try {
        const dbReportResult = await query(
          `SELECT id FROM lesson_reports 
           WHERE student_id = $1 AND lesson_date = $2 
           LIMIT 1`,
          [lesson.student_id, yesterdayStr]
        );
        
        if (dbReportResult.rows.length > 0) {
          hasReport = true;
          console.log(`[Lesson Report Reminder] Lesson ${lesson.student_id} on ${yesterdayStr}: Report found in DATABASE`);
        }
      } catch (dbError) {
        console.error(`[Lesson Report Reminder] Database check error:`, dbError);
      }
      
      // PRIORITY 2: If not in database, check SPREADSHEET (fallback)
      if (!hasReport) {
        for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
          const checkDate = new Date(yesterdayStr);
          checkDate.setDate(checkDate.getDate() + dayOffset);
          
          const checkYear = checkDate.getFullYear();
          const checkMonth = String(checkDate.getMonth() + 1).padStart(2, '0');
          const checkDay = String(checkDate.getDate()).padStart(2, '0');
          const checkDateStr = `${checkYear}-${checkMonth}-${checkDay}`;
          
          const key = `${normalizedId}_${checkDateStr}`;
          const completionData = lessonCompletionMap.get(key);
          
          if (completionData) {
            hasReport = true;
            console.log(`[Lesson Report Reminder] Lesson ${lesson.student_id} on ${yesterdayStr}: Report found in SPREADSHEET on ${checkDateStr}`);
            break;
          }
        }
      }
      
      // If NO report exists in EITHER source, send reminder
      if (!hasReport) {
        console.log(`[Lesson Report Reminder] Lesson ${lesson.student_id} on ${yesterdayStr}: NO REPORT - Sending reminder`);
        
        // Get tutor user
        const tutorUser = lesson.tutor_email ? usersByEmail[lesson.tutor_email.toLowerCase()] : null;
        
        if (tutorUser && tutorUser.discord_webhook_url) {
          // Send to tutor
          await sendDiscordReminder(
            tutorUser.discord_webhook_url,
            tutorUser.discord_user_id,
            lesson,
            'tutor'
          );
          remindersSent++;
          
          // Also send to team leaders
          const teamLeaders = leadersByTeam[lesson.team] || [];
          
          for (const leader of teamLeaders) {
            // Don't send duplicate if leader is also the tutor
            if (leader.email?.toLowerCase() !== lesson.tutor_email?.toLowerCase()) {
              await sendDiscordReminder(
                leader.discord_webhook_url,
                leader.discord_user_id,
                lesson,
                'leader'
              );
              remindersSent++;
            }
          }
        } else {
          console.warn(`[Lesson Report Reminder] No Discord settings found for tutor: ${lesson.tutor_email}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`[Lesson Report Reminder] Job completed. Sent ${remindersSent} reminders.`);
    
  } catch (error) {
    console.error('[Lesson Report Reminder] Error:', error);
  }
}

/**
 * Format date to Japanese format (YYYY/M/D)
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  
  // Handle both YYYY-MM-DD and ISO format
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed
  const day = date.getDate();
  
  return `${year}/${month}/${day}`;
}

/**
 * Send Discord reminder message
 */
async function sendDiscordReminder(webhookUrl, userId, lesson, recipientType) {
  try {
    const mention = userId ? `<@${userId}>` : '';
    const roleLabel = recipientType === 'leader' ? '【チームリーダー通知】' : '';
    
    // Format date to YYYY/M/D
    const formattedDate = formatDate(lesson.lesson_date);
    
    const embed = {
      title: `${roleLabel}レッスン報告未提出のお知らせ`,
      description: `レッスン報告が提出されていないようです。提出をお願いします！`,
      color: 0xFF6B6B, // Red color
      fields: [
        {
          name: '📅 レッスン日',
          value: formattedDate,
          inline: true
        },
        {
          name: '🕐 レッスン時間',
          value: lesson.lesson_time || '-',
          inline: true
        },
        {
          name: '👤 生徒名',
          value: lesson.student_name,
          inline: true
        },
        {
          name: '🆔 学籍番号',
          value: lesson.student_id,
          inline: true
        },
        {
          name: '👨‍🏫 担任Tutor',
          value: lesson.tutor_name || lesson.homeroom_tutor || '-',
          inline: true
        },
        {
          name: '🏢 チーム',
          value: lesson.team || '-',
          inline: true
        }
      ],
      footer: {
        text: 'レッスン報告フォームから提出してください'
      },
      timestamp: new Date().toISOString()
    };
    
    // IMPORTANT: Mentions must be in content, not in embed description
    const payload = {
      content: mention, // Mention goes here, not in embed
      embeds: [embed]
    };
    
    await axios.post(webhookUrl, payload);
    
    console.log(`[Lesson Report Reminder] Sent reminder to ${recipientType} for lesson ${lesson.student_id}`);
    
  } catch (error) {
    console.error(`[Lesson Report Reminder] Failed to send Discord message:`, error.message);
  }
}

export default sendLessonReportReminder;
