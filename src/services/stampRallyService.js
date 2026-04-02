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

    // 全生徒のアンケート統計を取得（特典対象判定を含む）
    const response = await axios.get('http://localhost:3000/api/survey/stats-all');
    
    if (!response.data.success) {
      console.error('[StampRally] Failed to fetch survey stats');
      return { success: false, sent: 0, errors: 1 };
    }

    const allStats = response.data.data;

    // 特典対象の生徒のみをフィルタ
    const eligibleStudents = Object.entries(allStats)
      .filter(([studentId, stats]) => {
        if (!stats.isEligible || !stats.isEligible.isEligible) {
          return false;
        }
        // achievementTypeが空の生徒をログ出力
        if (!stats.isEligible.achievementType) {
          console.warn(`[StampRally] Warning: ${studentId} has no achievementType. isEligible:`, JSON.stringify(stats.isEligible));
          return false; // achievementTypeがない場合は除外
        }
        return true;
      })
      .map(([studentId, stats]) => ({
        studentId: studentId,
        name: stats.name,
        continuedMonths: stats.continuedMonths,
        responseCount: stats.responseCount,
        responseRate: stats.responseRate,
        achievementType: stats.isEligible.achievementType,
        probability: stats.resultScore === 'S' ? 100 : 50,
        resultScore: stats.resultScore
      }));

    console.log(`[StampRally] Found ${eligibleStudents.length} eligible students (from ${Object.keys(allStats).length} total students)`);

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
          console.error(`[StampRally] Failed to generate roulette URL for ${student.studentId}: ${generateResponse.data.error || 'Unknown error'}`);
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
        const errorDetail = error.response?.data?.error || error.message;
        console.error(`[StampRally] Error processing ${student.studentId}: ${errorDetail}`);
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

    // 生徒のDiscord Channel URLを取得
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
    const channelUrl = student.discord_url;

    if (!channelUrl) {
      console.error(`[StampRally] No Discord channel URL for ${studentId}`);
      return false;
    }

    console.log(`[StampRally] 📤 Sending Discord notification to ${studentId} (${studentName})`);
    console.log(`[StampRally] Channel URL: ${channelUrl.substring(0, 50)}...`);
    
    // Discord Botを使ってチャンネルに送信
    const { sendStampRallyNotification: sendDiscordMessage } = await import('./discordService.js');
    const result = await sendDiscordMessage(channelUrl, studentName, rouletteUrl);

    console.log(`[StampRally] Discord send result:`, result);

    // Discord送信が成功した場合のみ、通知日時を更新
    if (result.success) {
      await pool.query(`
        UPDATE stamp_rally_achievements
        SET notified_at = NOW()
        WHERE student_id = $1
          AND notified_at IS NULL
      `, [studentId]);

      console.log(`[StampRally] ✅ Discord notification sent to ${studentId} (${studentName})`);
      return true;
    } else {
      console.error(`[StampRally] ❌ Discord send failed for ${studentId}: ${result.error || result.reason}`);
      return false;
    }

  } catch (error) {
    console.error(`[StampRally] ❌ Error sending Discord notification to ${studentId}:`, error.message);
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
