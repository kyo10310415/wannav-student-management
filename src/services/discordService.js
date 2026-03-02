import { Client, GatewayIntentBits } from 'discord.js';
import { fetchLessonsForTomorrow } from './calendarService.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let isClientReady = false;

// Initialize Discord client
client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  isClientReady = true;
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.error('Failed to login to Discord:', err);
});

/**
 * Fetch student Discord info from Google Sheets
 * This is a placeholder - you'll need to implement actual Google Sheets API
 */
async function getStudentDiscordInfo(studentId) {
  // TODO: Implement Google Sheets API integration
  // For now, return mock data structure
  // URL: https://docs.google.com/spreadsheets/d/1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM/edit
  // Sheet: ❶RAW_生徒様情報
  // B列: 学籍番号
  // M列: チャットURL
  // G列: Discord ID
  
  return {
    studentId: studentId,
    chatUrl: null,  // Extract from column M
    discordId: null // Extract from column G
  };
}

/**
 * Send reminder message to Discord channel
 */
export async function sendReminder(studentId, lessonInfo) {
  if (!isClientReady) {
    throw new Error('Discord client is not ready');
  }

  try {
    // Get student Discord info
    const studentInfo = await getStudentDiscordInfo(studentId);
    
    if (!studentInfo.chatUrl) {
      console.warn(`No Discord chat URL found for student ${studentId}`);
      return;
    }

    // Extract channel ID from Discord URL
    // Discord URLs format: https://discord.com/channels/SERVER_ID/CHANNEL_ID
    const channelIdMatch = studentInfo.chatUrl.match(/channels\/\d+\/(\d+)/);
    if (!channelIdMatch) {
      console.warn(`Invalid Discord URL for student ${studentId}: ${studentInfo.chatUrl}`);
      return;
    }

    const channelId = channelIdMatch[1];
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      console.warn(`Channel ${channelId} not found or is not a text channel`);
      return;
    }

    // Format lesson date
    const lessonDate = new Date(lessonInfo.lesson_date);
    const dateStr = lessonDate.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const timeStr = lessonDate.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Build reminder message
    let message = '';
    
    if (studentInfo.discordId) {
      message += `<@${studentInfo.discordId}>\n\n`;
    }
    
    message += `📅 **レッスンリマインド**\n\n`;
    message += `明日のレッスンのお知らせです！\n\n`;
    message += `**日時**: ${dateStr} ${timeStr}\n`;
    
    if (lessonInfo.tutor_name) {
      message += `**講師**: ${lessonInfo.tutor_name}\n`;
    }
    
    if (lessonInfo.meet_link) {
      message += `**Google Meet**: ${lessonInfo.meet_link}\n`;
    }
    
    message += `\nよろしくお願いいたします！`;

    // Send message
    await channel.send(message);
    console.log(`Reminder sent to student ${studentId} in channel ${channelId}`);
    
    return true;
  } catch (error) {
    console.error(`Error sending reminder for student ${studentId}:`, error);
    throw error;
  }
}

/**
 * Send daily reminders for all tomorrow's lessons
 */
export async function sendDailyReminders() {
  try {
    console.log('Fetching tomorrow\'s lessons for reminders...');
    const lessons = await fetchLessonsForTomorrow();
    
    console.log(`Found ${lessons.length} lessons for tomorrow`);
    
    const results = [];
    for (const lesson of lessons) {
      try {
        await sendReminder(lesson.student_id, lesson);
        results.push({ success: true, studentId: lesson.student_id });
      } catch (error) {
        console.error(`Failed to send reminder for student ${lesson.student_id}:`, error);
        results.push({ success: false, studentId: lesson.student_id, error: error.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`Sent ${successCount} out of ${lessons.length} reminders successfully`);
    
    return results;
  } catch (error) {
    console.error('Error in sendDailyReminders:', error);
    throw error;
  }
}

/**
 * Manual trigger for testing reminders
 */
export async function testReminder(studentId) {
  // For testing, just send a test message
  const testLesson = {
    student_id: studentId,
    lesson_date: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    tutor_name: 'テスト講師',
    meet_link: 'https://meet.google.com/test-link'
  };
  
  return await sendReminder(studentId, testLesson);
}

export { client };

/**
 * Send absence request notification to leader's Discord webhook
 * @param {string} leaderWebhookUrl - Leader's Discord webhook URL
 * @param {string} discordUserId - Leader's Discord user ID (optional)
 * @param {object} absenceData - Absence request data
 */
export async function notifyAbsenceRequest(leaderWebhookUrl, discordUserId, absenceData, scheduleUrl = null) {
  if (!leaderWebhookUrl) {
    console.log('No webhook URL provided, skipping absence notification');
    return { success: false, reason: 'No webhook URL' };
  }

  try {
    const axios = (await import('axios')).default;
    
    const {
      tutor_name,
      absence_type,
      reason,
      schedule_title,
      schedule_date,
      schedule_time,
      matched_keyword
    } = absenceData;

    // Build mention content
    let content = '';
    if (discordUserId) {
      content = `<@${discordUserId}>`; // Discord user mention
    }

    // Prepare fields
    const fields = [
      {
        name: 'スケジュール',
        value: schedule_title || '（タイトルなし）',
        inline: false
      },
      {
        name: '日時',
        value: `${schedule_date} ${schedule_time}`,
        inline: true
      },
      {
        name: 'キーワード',
        value: matched_keyword || '-',
        inline: true
      },
      {
        name: '申請者',
        value: tutor_name,
        inline: true
      },
      {
        name: '種別',
        value: absence_type === 'cancel' ? 'キャンセル' : 'リスケ',
        inline: true
      },
      {
        name: '理由',
        value: reason || '（理由なし）',
        inline: false
      }
    ];

    // Add schedule URL if provided
    if (scheduleUrl) {
      fields.push({
        name: 'Tutorスケジュール',
        value: `[申請を確認する](${scheduleUrl})`,
        inline: false
      });
    }

    // Create Discord embed message (simplified with fewer emojis)
    const embed = {
      title: '不参加申請通知',
      description: `${tutor_name} さんから不参加申請がありました`,
      color: absence_type === 'cancel' ? 0xFF0000 : 0xFFA500, // Red for cancel, Orange for reschedule
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'WannaV スケジュール管理システム'
      }
    };

    // Send webhook
    const payload = {
      embeds: [embed]
    };
    
    // Add content (mention) if Discord user ID is provided
    if (content) {
      payload.content = content;
    }
    
    await axios.post(leaderWebhookUrl, payload);

    console.log(`Absence notification sent to leader's webhook for ${tutor_name}`);
    return { success: true };
    
  } catch (error) {
    console.error('Error sending absence notification:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send approval notification to tutor via Discord webhook
 * @param {string} tutorWebhookUrl - Tutor's Discord webhook URL
 * @param {string} discordUserId - Tutor's Discord user ID (for mention)
 * @param {Object} approvalData - Approval data
 * @returns {Promise<Object>} Result object
 */
export async function notifyAbsenceApproval(tutorWebhookUrl, discordUserId, approvalData) {
  if (!tutorWebhookUrl) {
    console.log('No webhook URL provided, skipping approval notification');
    return { success: false, reason: 'No webhook URL' };
  }

  try {
    const axios = (await import('axios')).default;
    
    const {
      tutor_name,
      absence_type,
      schedule_title,
      schedule_date,
      schedule_time,
      matched_keyword,
      leader_name
    } = approvalData;

    // Build mention content
    let content = '';
    if (discordUserId) {
      content = `<@${discordUserId}>`; // Discord user mention
    }

    // Create Discord embed message
    const embed = {
      title: '✅ 不参加申請が受理されました',
      description: `${tutor_name} さんの不参加申請が受理されました`,
      color: 0x00FF00, // Green for approval
      fields: [
        {
          name: 'スケジュール',
          value: schedule_title || '（タイトルなし）',
          inline: false
        },
        {
          name: '日時',
          value: `${schedule_date} ${schedule_time}`,
          inline: true
        },
        {
          name: 'キーワード',
          value: matched_keyword || '-',
          inline: true
        },
        {
          name: '種別',
          value: absence_type === 'cancel' ? 'キャンセル' : 'リスケ',
          inline: true
        },
        {
          name: '受理者',
          value: leader_name || 'リーダー',
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'WannaV スケジュール管理システム'
      }
    };

    // Send webhook
    const payload = {
      embeds: [embed]
    };
    
    // Add content (mention) if Discord user ID is provided
    if (content) {
      payload.content = content;
    }
    
    await axios.post(tutorWebhookUrl, payload);

    console.log(`Approval notification sent to tutor's webhook for ${tutor_name}`);
    return { success: true };
    
  } catch (error) {
    console.error('Error sending approval notification:', error.message);
    return { success: false, error: error.message };
  }
}
