import axios from 'axios';

const WEBHOOK_URL = process.env.DISCORD_HELPER_WEBHOOK_URL;

/**
 * Send Discord notification when a helper request is created
 */
export async function notifyHelperRequestCreated(request) {
  if (!WEBHOOK_URL) {
    console.log('Discord webhook URL not configured, skipping notification');
    return;
  }

  try {
    const lessonDate = new Date(request.lesson_date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo'
    });

    const deadline = new Date(request.deadline).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Format lesson time as "17時～"
    let lessonTimeFormatted = '未設定';
    if (request.lesson_time) {
      const [hours] = request.lesson_time.split(':');
      lessonTimeFormatted = `${parseInt(hours)}時～`;
    }

    const embed = {
      title: '🆘 新しい助っ人Tutor依頼',
      color: 0xFF9800, // Orange
      fields: [
        {
          name: 'レッスン日',
          value: lessonDate,
          inline: true
        },
        {
          name: 'レッスン時間',
          value: lessonTimeFormatted,
          inline: true
        },
        {
          name: '生徒名',
          value: `${request.student_name} (${request.student_id})`,
          inline: false
        },
        {
          name: '依頼Tutor',
          value: request.requesting_tutor_name,
          inline: true
        },
        {
          name: 'レッスン進捗',
          value: `${request.lesson_progress}回`,
          inline: true
        },
        {
          name: '依頼理由',
          value: request.reason.substring(0, 1000) // Discord limit
        },
        {
          name: '依頼期限',
          value: deadline,
          inline: false
        }
      ],
      footer: {
        text: `依頼ID: #${request.id}`
      },
      timestamp: new Date().toISOString()
    };

    if (request.notes) {
      embed.fields.splice(6, 0, {
        name: '備考',
        value: request.notes.substring(0, 1000)
      });
    }
    
    // Add helper requests list URL
    const helpersPageUrl = process.env.APP_URL || 'https://wannav-student-management.onrender.com';
    embed.fields.push({
      name: '📋 助っ人待ち一覧',
      value: `${helpersPageUrl}/#helpers`,
      inline: false
    });
    
    // Add Notion page URL
    embed.fields.push({
      name: 'Notionページ',
      value: request.notion_url,
      inline: false
    });

    await axios.post(WEBHOOK_URL, {
      content: '@everyone',
      embeds: [embed]
    });

    console.log(`Discord notification sent for helper request #${request.id}`);
  } catch (error) {
    console.error('Error sending Discord notification:', error);
  }
}

/**
 * Send Discord notification when a helper request is accepted
 */
export async function notifyHelperRequestAccepted(request) {
  if (!WEBHOOK_URL) {
    console.log('Discord webhook URL not configured, skipping notification');
    return;
  }

  try {
    const lessonDate = new Date(request.lesson_date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });

    const acceptedAt = new Date(request.accepted_at).toLocaleString('ja-JP');

    const embed = {
      title: '✅ 助っ人Tutor依頼が受諾されました',
      color: 0x4CAF50, // Green
      fields: [
        {
          name: '📅 レッスン日',
          value: lessonDate,
          inline: true
        },
        {
          name: '⏰ レッスン時間',
          value: request.lesson_time || '未設定',
          inline: true
        },
        {
          name: '👤 生徒名',
          value: request.student_name,
          inline: true
        },
        {
          name: '🆔 学籍番号',
          value: request.student_id,
          inline: true
        },
        {
          name: '👨‍🏫 依頼Tutor',
          value: request.requesting_tutor_name,
          inline: true
        },
        {
          name: '🙋 受諾Tutor',
          value: `**${request.accepted_by_tutor_name}**`,
          inline: true
        },
        {
          name: '📝 依頼理由',
          value: request.reason.substring(0, 1000)
        },
        {
          name: '✅ 受諾日時',
          value: acceptedAt,
          inline: false
        },
        {
          name: '🔗 Notionページ',
          value: request.notion_url,
          inline: false
        }
      ],
      footer: {
        text: `依頼ID: #${request.id}`
      },
      timestamp: new Date().toISOString()
    };

    await axios.post(WEBHOOK_URL, {
      embeds: [embed]
    });

    console.log(`Discord notification sent for accepted helper request #${request.id}`);
  } catch (error) {
    console.error('Error sending Discord notification:', error);
  }
}

/**
 * Send Discord notification when helper requests are rescheduled
 */
export async function notifyHelperRequestsRescheduled(requests) {
  if (!WEBHOOK_URL) {
    console.log('Discord webhook URL not configured, skipping notification');
    return;
  }

  if (requests.length === 0) return;

  try {
    const helpersPageUrl = process.env.APP_URL || 'https://wannav-student-management.onrender.com';
    
    const embed = {
      title: '📅 期限切れ依頼がリスケジュールされました',
      color: 0xF44336, // Red
      description: `${requests.length}件の依頼が期限切れによりリスケジュールされました。\n\n[助っ人待ち一覧を開く](${helpersPageUrl}/#helpers)`,
      fields: requests.slice(0, 10).map(req => ({
        name: `#${req.id} - ${req.student_name}`,
        value: `依頼Tutor: ${req.requesting_tutor_name}\nレッスン日: ${new Date(req.lesson_date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n期限: ${new Date(req.deadline).toLocaleString('ja-JP', { 
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })}`,
        inline: false
      })),
      footer: {
        text: requests.length > 10 ? `他${requests.length - 10}件` : `合計${requests.length}件`
      },
      timestamp: new Date().toISOString()
    };

    await axios.post(WEBHOOK_URL, {
      content: '@everyone',
      embeds: [embed]
    });

    console.log(`Discord notification sent for ${requests.length} rescheduled requests`);
  } catch (error) {
    console.error('Error sending Discord notification:', error);
  }
}
