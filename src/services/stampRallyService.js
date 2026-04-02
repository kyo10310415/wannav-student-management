import { getPool } from '../db/connection.js';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';
import axios from 'axios';

/**
 * 日次でスタンプラリー達成者をチェックし、Discord通知を送信
 */
export async function checkStampRallyAchievements() {
  console.log('[StampRally] Starting daily achievement check...');
  
  try {
    const pool = getPool();
    
    // 通知設定を確認
    const settingResult = await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = 'survey_notification_enabled'
    `);
    
    const notificationEnabled = settingResult.rows[0]?.setting_value === 'true';
    
    if (!notificationEnabled) {
      console.log('[StampRally] Notifications are DISABLED. Skipping achievement check.');
      return;
    }
    
    console.log('[StampRally] Notifications are ENABLED. Proceeding with achievement check...');

    // 特典対象の生徒を取得
    const response = await axios.get('http://localhost:3000/api/survey/eligible-students');
    
    if (!response.data.success) {
      console.error('[StampRally] Failed to fetch eligible students');
      return;
    }

    const eligibleStudents = response.data.data;
    console.log(`[StampRally] Found ${eligibleStudents.length} eligible students`);

    let notificationsSent = 0;
    let errors = 0;

    for (const student of eligibleStudents) {
      try {
        // 既に通知済みかチェック
        const achievementResult = await pool.query(`
          SELECT id, notified_at
          FROM stamp_rally_achievements
          WHERE student_id = $1 AND achievement_type = $2
          ORDER BY achievement_date DESC
          LIMIT 1
        `, [student.studentId, student.achievementType]);

        // 既に達成記録があり、通知済みならスキップ
        if (achievementResult.rows.length > 0 && achievementResult.rows[0].notified_at) {
          console.log(`[StampRally] ${student.studentId} already notified`);
          continue;
        }

        // ルーレットURL生成
        const generateResponse = await axios.post('http://localhost:3000/api/roulette/generate', {
          studentId: student.studentId,
          achievementType: student.achievementType
        });

        if (!generateResponse.data.success) {
          console.error(`[StampRally] Failed to generate roulette URL for ${student.studentId}`);
          errors++;
          continue;
        }

        const { rouletteUrl, probability } = generateResponse.data.data;

        // Discord通知を送信
        const notified = await sendStampRallyNotification(
          student.studentId,
          student.name,
          rouletteUrl,
          probability
        );

        if (notified) {
          notificationsSent++;
          console.log(`[StampRally] Notification sent to ${student.studentId} (${notificationsSent}/${eligibleStudents.length})`);
        } else {
          errors++;
        }

        // Rate limiting: Wait 2 seconds between each notification to avoid Discord rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`[StampRally] Error processing ${student.studentId}:`, error.message);
        errors++;
        
        // Wait even on error to avoid hammering the API
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`[StampRally] Daily check completed: ${notificationsSent} sent, ${errors} errors`);
    
    return {
      success: true,
      sent: notificationsSent,
      errors: errors,
      total: eligibleStudents.length
    };
  } catch (error) {
    console.error('[StampRally] Error in daily achievement check:', error);
    return {
      success: false,
      error: error.message,
      sent: 0,
      errors: 0,
      total: 0
    };
  }
}

/**
 * Discord通知を送信
 */
async function sendStampRallyNotification(studentId, studentName, rouletteUrl, probability) {
  try {
    const pool = getPool();

    // 生徒のDiscord Webhook URLを取得
    const studentResult = await pool.query(`
      SELECT discord_url
      FROM students
      WHERE student_id = $1
    `, [studentId]);

    if (studentResult.rows.length === 0) {
      console.error(`[StampRally] Student ${studentId} not found`);
      return false;
    }

    const student = studentResult.rows[0];
    const webhookUrl = student.discord_url;

    if (!webhookUrl) {
      console.error(`[StampRally] No Discord webhook URL for ${studentId}`);
      return false;
    }

    // Discord Embed形式のメッセージ
    const embed = {
      title: '🎉 おめでとうございます！ 🎉',
      description: '**見事アンケートスタンプラリーを達成しました！！**',
      color: 0xFFD700, // 金色
      fields: [
        {
          name: '対象者',
          value: `${studentName} 様`,
          inline: false
        },
        {
          name: 'メッセージ',
          value: '日頃からアンケートにご協力いただき、誠にありがとうございます。\nこの度、**アンケートスタンプラリーの条件を達成**されましたので、特典をご用意いたしました！',
          inline: false
        },
        {
          name: '🎰 ルーレットに挑戦！',
          value: `下記のURLをクリックしてルーレットを回してください\n\n${rouletteUrl}`,
          inline: false
        },
        {
          name: '🎁 特典内容',
          value: '**弊社事務所マネージャーによる**1時間コンサル権\n※ 当選された方には、別途ご連絡させていただきます。',
          inline: false
        }
      ],
      footer: {
        text: '今後ともWannaVをよろしくお願いいたします 🙏'
      },
      timestamp: new Date().toISOString()
    };

    // Discord Webhook送信
    await axios.post(webhookUrl, {
      username: 'WannaV Bot',
      avatar_url: 'https://cdn-icons-png.flaticon.com/512/2593/2593635.png',
      embeds: [embed]
    });

    // 通知日時を更新
    await pool.query(`
      UPDATE stamp_rally_achievements
      SET notified_at = NOW()
      WHERE student_id = $1
        AND notified_at IS NULL
    `, [studentId]);

    console.log(`[StampRally] Discord notification sent to ${studentId}`);
    return true;

  } catch (error) {
    console.error(`[StampRally] Error sending Discord notification to ${studentId}:`, error.message);
    return false;
  }
}

/**
 * 手動でアンケート回答を記録（テスト用）
 */
export async function recordSurveyResponse(studentId, responseMonth) {
  try {
    const response = await axios.post('http://localhost:3000/api/survey/responses', {
      studentId,
      responseMonth
    });

    if (response.data.success) {
      console.log(`[StampRally] Response recorded: ${studentId} - ${responseMonth}`);
      return true;
    } else {
      console.error(`[StampRally] Failed to record response: ${response.data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`[StampRally] Error recording response:`, error.message);
    return false;
  }
}
