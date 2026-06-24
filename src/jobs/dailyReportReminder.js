import { query } from '../db/connection.js';
import axios from 'axios';

/**
 * 毎日14時JST に前日の日報未提出Tutorに Discord 通知を送る
 * 除外条件: 前日にレッスン予定がない
 */
async function sendDailyReportReminder() {
  try {
    console.log('[DailyReportReminder] Starting job...');

    // 前日の日付（JST）
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yesterday = new Date(jstNow);
    yesterday.setDate(yesterday.getDate() - 1);

    const year  = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day   = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${year}-${month}-${day}`;

    console.log(`[DailyReportReminder] Target date: ${yesterdayStr}`);

    // 前日にレッスンがあったTutor一覧を取得（除外条件判定用）
    const lessonTutorResult = await query(`
      SELECT DISTINCT t.id AS tutor_id
      FROM lessons l
      JOIN students s ON l.student_id = s.student_id
      JOIN tutors   t ON s.homeroom_tutor = t.notion_name
      WHERE l.lesson_date = $1
    `, [yesterdayStr]);

    const tutorIdsWithLesson = new Set(lessonTutorResult.rows.map(r => r.tutor_id));
    console.log(`[DailyReportReminder] Tutors with lessons on ${yesterdayStr}: ${tutorIdsWithLesson.size}`);

    if (tutorIdsWithLesson.size === 0) {
      console.log('[DailyReportReminder] No lessons found for yesterday. Skipping.');
      return;
    }

    // 前日に日報を提出済みのTutor
    const submittedResult = await query(`
      SELECT tutor_id FROM daily_reports WHERE report_date = $1
    `, [yesterdayStr]);
    const submittedIds = new Set(submittedResult.rows.map(r => r.tutor_id));

    // 未提出かつ前日レッスンありのTutor
    const unsubmittedIds = [...tutorIdsWithLesson].filter(id => !submittedIds.has(id));
    console.log(`[DailyReportReminder] Unsubmitted tutors: ${unsubmittedIds.length}`);

    if (unsubmittedIds.length === 0) {
      console.log('[DailyReportReminder] All tutors submitted. No reminders needed.');
      return;
    }

    // 未提出TutorのDiscord情報を取得
    const tutorResult = await query(`
      SELECT
        t.id   AS tutor_id,
        t.tutor_name,
        t.team,
        t.email,
        u.discord_webhook_url,
        u.discord_user_id
      FROM tutors t
      LEFT JOIN users u ON LOWER(t.email) = LOWER(u.email)
      WHERE t.id = ANY($1::int[])
    `, [unsubmittedIds]);

    // チームリーダーのDiscord情報
    const leaderResult = await query(`
      SELECT
        u.discord_webhook_url,
        u.discord_user_id,
        u.role,
        t.team,
        t.tutor_name
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE u.role IN ('admin', 'leader')
        AND u.discord_webhook_url IS NOT NULL
    `);

    const leadersByTeam = {};
    leaderResult.rows.forEach(l => {
      if (l.team) {
        if (!leadersByTeam[l.team]) leadersByTeam[l.team] = [];
        leadersByTeam[l.team].push(l);
      }
    });

    let remindersSent = 0;

    for (const tutor of tutorResult.rows) {
      // Tutor本人への通知
      if (tutor.discord_webhook_url) {
        await sendDiscordMessage(
          tutor.discord_webhook_url,
          tutor.discord_user_id,
          tutor,
          yesterdayStr,
          'tutor'
        );
        remindersSent++;
      } else {
        console.warn(`[DailyReportReminder] No Discord webhook for tutor: ${tutor.tutor_name}`);
      }

      // チームリーダーへの通知
      const leaders = leadersByTeam[tutor.team] || [];
      for (const leader of leaders) {
        if (leader.discord_webhook_url &&
            leader.discord_webhook_url !== tutor.discord_webhook_url) {
          await sendDiscordMessage(
            leader.discord_webhook_url,
            leader.discord_user_id,
            tutor,
            yesterdayStr,
            'leader'
          );
          remindersSent++;
        }
      }

      // レート制限対策
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[DailyReportReminder] Job completed. Sent ${remindersSent} notifications.`);
  } catch (error) {
    console.error('[DailyReportReminder] Error:', error);
  }
}

async function sendDiscordMessage(webhookUrl, userId, tutor, dateStr, recipientType) {
  try {
    const mention   = userId ? `<@${userId}>` : '';
    const roleLabel = recipientType === 'leader' ? '【チームリーダー通知】' : '';

    const [y, m, d] = dateStr.split('-');
    const formattedDate = `${y}/${parseInt(m)}/${parseInt(d)}`;

    const embed = {
      title:       `${roleLabel}日報未提出のお知らせ`,
      description: `**${tutor.tutor_name}** さんの ${formattedDate} の日報が提出されていません。\n提出をお願いします！`,
      color:       0xF59E0B, // amber
      fields: [
        { name: '📅 対象日',   value: formattedDate,       inline: true },
        { name: '👨‍🏫 Tutor名', value: tutor.tutor_name,   inline: true },
        { name: '🏢 チーム',   value: tutor.team || '-',   inline: true }
      ],
      footer:    { text: '日報管理ページから提出してください' },
      timestamp: new Date().toISOString()
    };

    await axios.post(webhookUrl, { content: mention, embeds: [embed] });
    console.log(`[DailyReportReminder] Sent to ${recipientType}: ${tutor.tutor_name}`);
  } catch (error) {
    console.error(`[DailyReportReminder] Failed to send Discord message:`, error.message);
  }
}

export default sendDailyReportReminder;
