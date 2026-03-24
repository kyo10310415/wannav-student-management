import { getPool } from '../db/connection.js';
import axios from 'axios';
import { google } from 'googleapis';

/**
 * Fetch current month responders from spreadsheet
 */
async function fetchCurrentMonthResponders(spreadsheetId) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Read satisfaction survey data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: '生徒様満足度アンケート!A2:G'
    });

    const rows = response.data.values || [];
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    const responders = new Set();
    
    rows.forEach(row => {
      const timestamp = row[0]; // A列: タイムスタンプ
      const studentId = row[5];  // F列: 学籍番号
      
      if (!timestamp || !studentId) return;
      
      try {
        const date = new Date(timestamp);
        if (date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth) {
          const normalized = normalizeStudentId(studentId);
          responders.add(normalized);
        }
      } catch (error) {
        // Invalid date, skip
      }
    });
    
    console.log(`[Survey Reminder] Loaded ${responders.size} current month responders from spreadsheet`);
    return responders;
    
  } catch (error) {
    console.error('[Survey Reminder] Error fetching current month responders:', error.message);
    return new Set();
  }
}

/**
 * レッスン予定の12時間後にアンケート未回答の生徒にリマインド通知を送信
 */
export async function sendSurveyReminderNotifications() {
  console.log('[Survey Reminder] Starting survey reminder check...');
  
  try {
    const pool = getPool();
    
    // システム設定から特典通知トグルの状態を取得
    const settingsResult = await pool.query(`
      SELECT setting_value 
      FROM system_settings 
      WHERE setting_key = 'enable_privilege_notifications'
    `);
    
    const isEnabled = settingsResult.rows.length > 0 && settingsResult.rows[0].setting_value === 'true';
    
    if (!isEnabled) {
      console.log('[Survey Reminder] Privilege notifications are disabled. Skipping.');
      return;
    }
    
    // 現在時刻（JST）
    const now = new Date();
    const jstOffset = 9 * 60; // JST = UTC+9
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    
    // 12時間前の時刻を計算（レッスン予定時刻）
    const targetTime = new Date(jstNow.getTime() - 12 * 60 * 60 * 1000);
    
    // 対象日付（YYYY-MM-DD）
    const targetDate = targetTime.toISOString().split('T')[0];
    
    // 今月の年月
    const currentYear = jstNow.getFullYear();
    const currentMonth = jstNow.getMonth() + 1;
    
    console.log(`[Survey Reminder] Target date: ${targetDate}, Current month: ${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    
    // スプレッドシートから今月のアンケート回答者を取得
    const satisfactionSpreadsheetId = process.env.SATISFACTION_SPREADSHEET_ID || process.env.GOOGLE_CACHE_SHEET_ID;
    let currentMonthResponders = new Set();
    
    if (satisfactionSpreadsheetId) {
      try {
        currentMonthResponders = await fetchCurrentMonthResponders(satisfactionSpreadsheetId);
        console.log(`[Survey Reminder] Current month responders: ${currentMonthResponders.size}`);
      } catch (error) {
        console.error('[Survey Reminder] Failed to fetch current month responders:', error.message);
      }
    }
    
    // 対象日にレッスン予定がある生徒を取得
    const studentsResult = await pool.query(`
      SELECT DISTINCT
        s.student_id,
        s.name,
        s.status,
        s.discord_user_id,
        s.lesson_start_date
      FROM students s
      INNER JOIN reservations r ON s.student_id = r.student_id
      WHERE r.reservation_date::date = $1
        AND s.status = 'アクティブ'
        AND s.discord_user_id IS NOT NULL
        AND s.discord_user_id != ''
    `, [targetDate]);
    
    console.log(`[Survey Reminder] Found ${studentsResult.rows.length} students with lessons on ${targetDate}`);
    
    let notificationsSent = 0;
    let notificationsFailed = 0;
    
    for (const student of studentsResult.rows) {
      try {
        // 今月のアンケート回答済みかチェック
        const normalizedId = normalizeStudentId(student.student_id);
        const hasResponded = currentMonthResponders.has(normalizedId);
        
        if (hasResponded) {
          console.log(`[Survey Reminder] ${student.student_id} (${student.name}) - Already responded this month, skipping`);
          continue;
        }
        
        // すでに通知済みかチェック
        const existingNotification = await pool.query(`
          SELECT id FROM survey_reminder_notifications
          WHERE student_id = $1 
            AND lesson_date = $2 
            AND notification_type = 'survey_reminder_12h'
        `, [student.student_id, targetDate]);
        
        if (existingNotification.rows.length > 0) {
          console.log(`[Survey Reminder] ${student.student_id} - Already notified, skipping`);
          continue;
        }
        
        // Discord通知を送信
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
          console.warn('[Survey Reminder] DISCORD_WEBHOOK_URL not configured');
          continue;
        }
        
        const message = `<@${student.discord_user_id}>
お世話になっております！
アンケート回答のリマインドでございます！

**# 【WannaV 生徒様満足度アンケート】**
https://forms.gle/8ezQkdUheP82F2r2A
**※今月にすでに1度ご回答いただいた方は、2回目もお答えいただく必要はございません。**
※送信完了しましたら、担当の先生にメンションをつけてご連絡ください！

この通知が届いてから**24時間以内に**回答いただけないと
**今月のスタンプが押されません！！**
スタンプが押されないと半年ごとの特典を受ける事が出来なくなってしまうので早めのご回答をお願い致します！！`;
        
        const response = await axios.post(webhookUrl, {
          content: message,
          username: 'WannaV アンケートリマインド'
        });
        
        // 通知履歴を保存
        await pool.query(`
          INSERT INTO survey_reminder_notifications 
            (student_id, lesson_date, notification_type, discord_message_id, status)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (student_id, lesson_date, notification_type) 
          DO NOTHING
        `, [student.student_id, targetDate, 'survey_reminder_12h', response.data?.id || null, 'sent']);
        
        notificationsSent++;
        console.log(`[Survey Reminder] ✅ Sent to ${student.student_id} (${student.name})`);
        
        // Rate limiting: 1 message per second
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[Survey Reminder] ❌ Failed to send to ${student.student_id}:`, error.message);
        
        // エラーを記録
        try {
          await pool.query(`
            INSERT INTO survey_reminder_notifications 
              (student_id, lesson_date, notification_type, status, error_message)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (student_id, lesson_date, notification_type) 
            DO UPDATE SET 
              status = EXCLUDED.status,
              error_message = EXCLUDED.error_message,
              sent_at = CURRENT_TIMESTAMP
          `, [student.student_id, targetDate, 'survey_reminder_12h', 'failed', error.message]);
        } catch (dbError) {
          console.error('[Survey Reminder] Failed to log error:', dbError.message);
        }
        
        notificationsFailed++;
      }
    }
    
    console.log(`[Survey Reminder] Complete - Sent: ${notificationsSent}, Failed: ${notificationsFailed}`);
    
  } catch (error) {
    console.error('[Survey Reminder] Error:', error);
  }
}

/**
 * Normalize student ID (trim, remove full-width chars, uppercase)
 */
function normalizeStudentId(studentId) {
  if (!studentId) return '';
  return studentId
    .trim()
    .replace(/[　\s]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toUpperCase();
}
