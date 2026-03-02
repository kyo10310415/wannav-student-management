import { google } from 'googleapis';

let sheets;

/**
 * Initialize Google Sheets API
 */
export function getSheets() {
  if (!sheets) {
    let credentials;
    
    try {
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        
        if (credString.startsWith('{') || credString.startsWith('[')) {
          credentials = JSON.parse(credString);
        } else {
          try {
            const decoded = Buffer.from(credString, 'base64').toString('utf-8');
            credentials = JSON.parse(decoded);
          } catch (decodeError) {
            credentials = JSON.parse(credString);
          }
        }
      } else {
        throw new Error('GOOGLE_CREDENTIALS_JSON not found in environment variables');
      }
    } catch (error) {
      console.error('Error parsing Google credentials:', error);
      throw error;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    sheets = google.sheets({ version: 'v4', auth });
  }

  return sheets;
}

/**
 * Fetch lessons from Google Sheets
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name (default: 'レッスン予約データ')
 */
export async function fetchLessonsFromSheet(spreadsheetId, sheetName = 'レッスン予約データ') {
  try {
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:I`, // ヘッダー行をスキップ（A2から開始）
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} rows from Google Sheets`);

    // Convert rows to lesson objects
    const lessons = rows.map(row => {
      let lessonDate = null;
      if (row[4]) {
        // Parse date as JST (Japan Standard Time)
        // Input format: "2026/03/04 10:00:00" or "2026/3/4 10:00:00"
        const dateStr = row[4];
        const match = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          // Create date using local timezone constructor (treats as JST in JST environment)
          // This preserves the time as-is without timezone conversion
          lessonDate = new Date(
            parseInt(year),
            parseInt(month) - 1, // Month is 0-indexed
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second)
          );
        } else {
          // Fallback to original behavior if format doesn't match
          lessonDate = new Date(dateStr);
        }
      }
      
      return {
        calendar_event_id: row[0] || null,
        student_id: row[1] || null,
        tutor_name: row[2] || null,
        tutor_email: row[3] || null,
        lesson_date: lessonDate,
        title: row[5] || null,
        description: row[6] || null,
        meet_link: row[7] || null,
      };
    }).filter(lesson => lesson.student_id); // 学籍番号がないものは除外

    console.log(`Valid lessons with student ID: ${lessons.length}`);
    return lessons;
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
    throw error;
  }
}

/**
 * Get last sync time from metadata sheet
 */
export async function getLastSyncTime(spreadsheetId) {
  try {
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: '同期メタ情報!A2:C2',
    });

    const row = response.data.values?.[0];
    if (!row) return null;

    return {
      lastSync: new Date(row[0]),
      totalEvents: parseInt(row[1]),
      validEvents: parseInt(row[2])
    };
  } catch (error) {
    console.error('Error fetching sync metadata:', error);
    return null;
  }
}

/**
 * Fetch lessons for tomorrow from Google Sheets
 * Used for daily reminder notifications
 */
export async function fetchLessonsForTomorrow() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo';
    const sheetName = 'レッスン予約データ';
    
    // Calculate tomorrow's date in JST
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // JST is UTC+9
    const jstNow = new Date(now.getTime() + jstOffset);
    
    const tomorrow = new Date(jstNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
    
    console.log(`[Sheets] Fetching lessons for tomorrow: ${tomorrow.toISOString().split('T')[0]}`);
    console.log(`[Sheets] Spreadsheet ID: ${spreadsheetId}`);
    console.log(`[Sheets] Sheet name: ${sheetName}`);
    
    // Fetch all lessons from sheet
    const allLessons = await fetchLessonsFromSheet(spreadsheetId, sheetName);
    
    // Get tutor information from database
    const { query } = await import('../db/connection.js');
    const studentsResult = await query('SELECT student_id, homeroom_tutor FROM students WHERE homeroom_tutor IS NOT NULL');
    const studentTutorMap = new Map();
    studentsResult.rows.forEach(row => {
      studentTutorMap.set(row.student_id, row.homeroom_tutor);
    });
    
    console.log(`[Sheets] Loaded ${studentTutorMap.size} student-tutor mappings from database`);
    
    // Filter lessons for tomorrow and only include "レッスン" schedules
    const tomorrowLessons = allLessons
      .filter(lesson => {
        if (!lesson.lesson_date) return false;
        
        const lessonDate = new Date(lesson.lesson_date);
        return lessonDate >= tomorrow && lessonDate < dayAfterTomorrow;
      })
      .filter(lesson => {
        // Only include schedules with "レッスン" in title
        return lesson.title && lesson.title.includes('レッスン');
      })
      .map(lesson => {
        // Replace tutor_name with actual homeroom tutor from database
        const actualTutor = studentTutorMap.get(lesson.student_id);
        return {
          ...lesson,
          tutor_name: actualTutor || lesson.tutor_name
        };
      });
    
    console.log(`[Sheets] Total lessons in sheet: ${allLessons.length}`);
    console.log(`[Sheets] Lessons for tomorrow (with "レッスン" filter): ${tomorrowLessons.length}`);
    
    if (tomorrowLessons.length > 0) {
      console.log(`[Sheets] Sample lessons:`);
      tomorrowLessons.slice(0, 3).forEach((lesson, i) => {
        console.log(`[Sheets]   Lesson ${i + 1}:`);
        console.log(`[Sheets]     Student: ${lesson.student_id}`);
        console.log(`[Sheets]     Tutor (from DB): ${lesson.tutor_name}`);
        console.log(`[Sheets]     Date: ${lesson.lesson_date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
        console.log(`[Sheets]     Title: ${lesson.title}`);
      });
    }
    
    return tomorrowLessons;
  } catch (error) {
    console.error('[Sheets] Error fetching tomorrow\'s lessons:', error);
    throw error;
  }
}

/**
 * Fetch tutor schedules from Google Sheets (特定イベント一覧)
 */
export async function fetchSchedulesFromSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo';
  const sheetName = '特定イベント一覧';
  
  try {
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:K`, // A2からK列まで（ヘッダーをスキップ）
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} rows from ${sheetName}`);

    const schedules = rows.map(row => {
      // E列（開始日時）をパース
      let startDate = null;
      let scheduleDate = null;
      let scheduleTime = null;
      
      if (row[4]) {
        try {
          // Google Sheetsの日時文字列（例: "2026/02/28 23:00" または "2026/02/28 23:00:00"）を
          // JSTとして解釈する
          const dateStr = row[4];
          console.log('[DEBUG] Original date string from Sheets:', dateStr);
          
          // 日時文字列を直接JSTとして解釈
          // "YYYY/MM/DD HH:MM:SS" または "YYYY/MM/DD HH:MM" 形式を想定
          const match = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
          
          if (match) {
            const [_, year, month, day, hour, minute, second] = match;
            console.log('[DEBUG] Parsed components:', { year, month, day, hour, minute, second: second || '0' });
            
            // 日付部分（YYYY/MM/DD）- JSTで表示
            scheduleDate = `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
            
            // 時間部分（HH:MM）- JSTで表示
            scheduleTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
            
            console.log('[DEBUG] Display values (JST):', { scheduleDate, scheduleTime });
            
            // JSTのタイムゾーンオフセット（UTC+9）
            const jstOffset = 9 * 60; // 9時間を分に変換
            
            // UTC時間として作成してからJSTオフセットを適用
            const utcDate = new Date(Date.UTC(
              parseInt(year),
              parseInt(month) - 1, // 月は0始まり
              parseInt(day),
              parseInt(hour),
              parseInt(minute),
              parseInt(second || '0')
            ));
            
            // JSTオフセットを引く（JSTからUTCへ変換）
            startDate = new Date(utcDate.getTime() - jstOffset * 60 * 1000);
            
            console.log('[DEBUG] Stored UTC date:', startDate.toISOString());
          } else {
            console.log('[DEBUG] Date string did not match expected format, using fallback');
            // フォールバック: 通常のDate解析（使われないはず）
            startDate = new Date(dateStr);
            
            scheduleDate = dateStr.split(' ')[0];
            scheduleTime = dateStr.split(' ')[1] || '';
            
            console.log('[DEBUG] Fallback values:', { scheduleDate, scheduleTime });
          }
        } catch (error) {
          console.error('Date parse error:', error);
        }
      }
      
      return {
        event_id: row[0] || null,           // A列: イベントID
        unique_event_key: `${row[0] || 'unknown'}_${scheduleDate}_${scheduleTime}`.replace(/[\/:\s]/g, '-'), // ユニークキー（event_id + 日付 + 時間）
        account: row[1] || null,            // B列: アカウント（メールアドレス）
        matched_keyword: row[2] || null,    // C列: 一致キーワード
        title: row[3] || null,              // D列: タイトル
        start_time: startDate,              // E列: 開始日時（Date型、UTCで保存）
        schedule_date: scheduleDate,        // 日付部分（例: 2026/02/28）- JST表示
        schedule_time: scheduleTime,        // 時間部分（例: 23:00）- JST表示
        end_time: row[5] ? new Date(row[5]) : null, // F列: 終了日時
        location: row[6] || null,           // G列: 場所
        description: row[7] || null,        // H列: 説明
        meet_link: row[8] || null,          // I列: Meetリンク
        attendees: row[9] || null,          // J列: 参加者
        fetched_at: row[10] ? new Date(row[10]) : null // K列: 取得日時
      };
    });

    console.log(`Valid schedules: ${schedules.length}`);
    return schedules;
  } catch (error) {
    console.error('Error fetching schedules from Google Sheets:', error);
    throw error;
  }
}


/**
 * Fetch individual Discord webhooks and user IDs from Google Sheets
 * @param {string} spreadsheetId - Spreadsheet ID (default: special events spreadsheet)
 * @returns {Object} Map of email to {webhook, discordUserId}
 */
export async function fetchIndividualWebhooks(spreadsheetId = '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo') {
  const sheetName = '個別取得シート';
  
  try {
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:C`, // A列: メールアドレス, B列: Webhook, C列: Discord User ID
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} webhook entries from ${sheetName}`);

    // Create email to {webhook, discordUserId} mapping
    const webhookMap = {};
    rows.forEach(row => {
      const email = row[0] ? row[0].trim().toLowerCase() : null;
      const webhook = row[1] ? row[1].trim() : null;
      const discordUserId = row[2] ? row[2].trim() : null;
      
      if (email && webhook) {
        webhookMap[email] = {
          webhook,
          discordUserId
        };
      }
    });

    console.log(`Valid webhook mappings: ${Object.keys(webhookMap).length}`);
    return webhookMap;
  } catch (error) {
    console.error('Error fetching individual webhooks from Google Sheets:', error);
    throw error;
  }
}

/**
 * Fetch Tutor webhooks from WTCチャットURL sheet
 * @param {string} spreadsheetId - Spreadsheet ID (default: WTCチャットURL sheet)
 * @returns {Object} Tutor name to {webhook, discordUserId} mapping
 */
export async function fetchTutorWebhooks(spreadsheetId = '13rHnYHavM6Mm7JRC3n88X2pTCoAlCZOXMkapDq7uwNs') {
  const sheetName = 'WTCチャットURL';
  
  try {
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:L`, // A列: Tutor名, E列: チャットWebhook, L列: ユーザーID
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} tutor webhook entries from ${sheetName}`);

    // Create tutor name to {webhook, discordUserId} mapping
    const webhookMap = {};
    rows.forEach(row => {
      const tutorName = row[0] ? row[0].trim() : null; // A列
      const webhook = row[4] ? row[4].trim() : null;    // E列
      const discordUserId = row[11] ? row[11].trim() : null; // L列
      
      if (tutorName && webhook) {
        webhookMap[tutorName] = {
          webhook,
          discordUserId
        };
      }
    });

    console.log(`Valid tutor webhook mappings: ${Object.keys(webhookMap).length}`);
    return webhookMap;
  } catch (error) {
    console.error('Error fetching tutor webhooks from Google Sheets:', error);
    throw error;
  }
}
