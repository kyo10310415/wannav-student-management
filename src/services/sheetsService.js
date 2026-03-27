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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/spreadsheets' // 書き込み権限も追加
      ],
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
      range: `${sheetName}!A2:J`, // ヘッダー行をスキップ（A2から開始）、J列まで取得
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} rows from Google Sheets`);

    // Convert rows to lesson objects
    const lessons = rows.map(row => {
      return {
        calendar_event_id: row[0] || null,
        student_id: row[1] || null,
        tutor_name: row[2] || null,
        tutor_email: row[3] || null,
        lesson_date: row[4] || null,  // Keep as string from spreadsheet (e.g., "2026/03/04 10:00:00")
        lesson_date_raw: row[4] || null,  // Store raw string for display
        title: row[5] || null,
        description: row[6] || null,
        meet_link: row[7] || null,
        lesson_time: row[9] || null, // J列: 時間 (HH:MM形式)
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
    
    // Format as YYYY/M/D for comparison (match spreadsheet format)
    const tomorrowStr = `${tomorrow.getFullYear()}/${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
    
    console.log(`[Sheets] Fetching lessons for tomorrow: ${tomorrowStr}`);
    console.log(`[Sheets] Spreadsheet ID: ${spreadsheetId}`);
    console.log(`[Sheets] Sheet name: ${sheetName}`);
    
    // Fetch all lessons from sheet
    const allLessons = await fetchLessonsFromSheet(spreadsheetId, sheetName);
    
    // Get tutor information from database (get both homeroom_tutor and actual tutor_name)
    const { query } = await import('../db/connection.js');
    
    // Get student homeroom tutor (Notion name)
    const studentsResult = await query('SELECT student_id, homeroom_tutor FROM students WHERE homeroom_tutor IS NOT NULL');
    const studentNotionTutorMap = new Map();
    studentsResult.rows.forEach(row => {
      studentNotionTutorMap.set(row.student_id, row.homeroom_tutor);
    });
    
    // Get Notion name to Tutor name mapping
    const tutorsResult = await query('SELECT notion_name, tutor_name FROM tutors WHERE notion_name IS NOT NULL AND tutor_name IS NOT NULL');
    const notionToTutorNameMap = new Map();
    tutorsResult.rows.forEach(row => {
      notionToTutorNameMap.set(row.notion_name, row.tutor_name);
    });
    
    console.log(`[Sheets] Loaded ${studentNotionTutorMap.size} student-tutor mappings from database`);
    console.log(`[Sheets] Loaded ${notionToTutorNameMap.size} Notion-to-Tutor name mappings`);
    
    // Filter lessons for tomorrow and only include "レッスン" schedules
    const tomorrowLessons = allLessons
      .filter(lesson => {
        if (!lesson.lesson_date) return false;
        
        // Compare date string (lesson_date format: "2026/3/4 10:00:00")
        // Extract date part and compare with tomorrow
        const dateMatch = lesson.lesson_date.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!dateMatch) return false;
        
        const lessonDateStr = `${dateMatch[1]}/${parseInt(dateMatch[2])}/${parseInt(dateMatch[3])}`;
        return lessonDateStr === tomorrowStr;
      })
      .filter(lesson => {
        // Only include schedules with "レッスン" in title
        return lesson.title && lesson.title.includes('レッスン');
      })
      .map(lesson => {
        // Get homeroom tutor (Notion name) from database
        const notionName = studentNotionTutorMap.get(lesson.student_id);
        
        // Convert Notion name to Tutor name
        const tutorName = notionName ? notionToTutorNameMap.get(notionName) : null;
        
        return {
          ...lesson,
          tutor_name: tutorName || lesson.tutor_name || notionName || '担任未設定'
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
        console.log(`[Sheets]     Date (raw): ${lesson.lesson_date}`);
        console.log(`[Sheets]     Title: ${lesson.title}`);
      });
    }
    
    return tomorrowLessons;
  } catch (error) {
    console.error('[Sheets] Error fetching tomorrow\'s lessons:', error);
    throw error;
  }
}

// Cache for Wanami usage data
let wanamiCache = null;
let wanamiCacheTimestamp = null;
const WANAMI_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Fetch all Wanami-san usage counts for all students (with 24-hour cache)
 * @param {number} year - Year to filter (optional, defaults to current year)
 * @param {number} month - Month to filter (optional, defaults to current month)
 * @returns {Object} - Map of student_id to count
 */
export async function fetchAllWanamiUsageCounts(year = null, month = null) {
  try {
    const now = new Date();
    
    // Default to current year/month if not specified
    year = year || now.getFullYear();
    month = month || now.getMonth() + 1;
    
    // Check cache validity (24 hours)
    if (wanamiCache && wanamiCacheTimestamp) {
      const cacheAge = now.getTime() - wanamiCacheTimestamp;
      if (cacheAge < WANAMI_CACHE_DURATION) {
        console.log(`[Wanami Cache] Using cached data (age: ${Math.round(cacheAge / 1000 / 60)} minutes)`);
        return wanamiCache[`${year}-${month}`] || {};
      }
    }
    
    console.log('[Wanami Cache] Cache expired or not found, fetching from Google Sheets...');
    
    const spreadsheetId = '1vKrYCzaw-miJOY52oskNoMfn-uEHIolBMhC7uMxxN_M';
    const sheetName = 'Q&A記録';
    
    const sheets = getSheets();
    
    // Fetch all records (A and O columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:O`, // Skip header row
    });

    const rows = response.data.values || [];
    console.log(`[Wanami] Fetched ${rows.length} Q&A records for caching`);

    // Group by year-month and student ID
    const monthlyData = {};
    
    rows.forEach(row => {
      const timestamp = row[0]; // A列 (index 0)
      const studentIdInRow = row[14]; // O列 (index 14)
      
      if (!timestamp || !studentIdInRow) return;
      
      try {
        const date = new Date(timestamp);
        const recordYear = date.getFullYear();
        const recordMonth = date.getMonth() + 1;
        const key = `${recordYear}-${recordMonth}`;
        
        if (!monthlyData[key]) {
          monthlyData[key] = {};
        }
        
        monthlyData[key][studentIdInRow] = (monthlyData[key][studentIdInRow] || 0) + 1;
      } catch (error) {
        // Skip invalid timestamps
      }
    });
    
    // Update cache
    wanamiCache = monthlyData;
    wanamiCacheTimestamp = now.getTime();
    
    console.log(`[Wanami Cache] Cache updated. Found data for ${Object.keys(monthlyData).length} months`);
    
    return monthlyData[`${year}-${month}`] || {};
  } catch (error) {
    console.error('[Wanami] Error fetching all usage counts:', error);
    return {};
  }
}

/**
 * Fetch Wanami-san usage count from Q&A records sheet
 * @param {string} studentId - Student ID to search
 * @param {number} year - Year to filter (optional, defaults to current year)
 * @param {number} month - Month to filter (optional, defaults to current month)
 * @returns {number} - Count of records for the student in the specified month
 */
export async function fetchWanamiUsageCount(studentId, year = null, month = null) {
  try {
    const spreadsheetId = '1vKrYCzaw-miJOY52oskNoMfn-uEHIolBMhC7uMxxN_M';
    const sheetName = 'Q&A記録';
    
    const sheets = getSheets();
    
    // Fetch all records (A and O columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:O`, // Skip header row
    });

    const rows = response.data.values || [];
    console.log(`[Wanami] Fetched ${rows.length} Q&A records`);

    // Default to current year/month if not specified
    if (!year || !month) {
      const now = new Date();
      year = year || now.getFullYear();
      month = month || now.getMonth() + 1; // getMonth() is 0-indexed
    }

    // Filter records by student ID and month
    const matchingRecords = rows.filter(row => {
      const timestamp = row[0]; // A列 (index 0)
      const studentIdInRow = row[14]; // O列 (index 14)
      
      if (!timestamp || !studentIdInRow) return false;
      if (studentIdInRow !== studentId) return false;
      
      // Parse timestamp (format: "2025-11-28T10:44:45.838Z")
      try {
        const date = new Date(timestamp);
        const recordYear = date.getFullYear();
        const recordMonth = date.getMonth() + 1;
        
        return recordYear === year && recordMonth === month;
      } catch (error) {
        return false;
      }
    });

    const count = matchingRecords.length;
    console.log(`[Wanami] Student ${studentId}: ${count} records in ${year}/${month}`);
    
    return count;
  } catch (error) {
    console.error('[Wanami] Error fetching usage count:', error);
    return 0; // Return 0 on error instead of throwing
  }
}

/**
 * Fetch Wanami-san usage history (all months)
 * @param {string} studentId - Student ID to search
 * @returns {Array} - Array of {year, month, count} objects
 */
export async function fetchWanamiUsageHistory(studentId) {
  try {
    const spreadsheetId = '1vKrYCzaw-miJOY52oskNoMfn-uEHIolBMhC7uMxxN_M';
    const sheetName = 'Q&A記録';
    
    const sheets = getSheets();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A2:O`,
    });

    const rows = response.data.values || [];
    
    // Group by year/month
    const monthlyCount = {};
    
    rows.forEach(row => {
      const timestamp = row[0];
      const studentIdInRow = row[14];
      
      if (!timestamp || !studentIdInRow || studentIdInRow !== studentId) return;
      
      try {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const key = `${year}-${month}`;
        
        monthlyCount[key] = (monthlyCount[key] || 0) + 1;
      } catch (error) {
        // Skip invalid timestamps
      }
    });
    
    // Convert to array and sort by year/month descending
    const history = Object.keys(monthlyCount).map(key => {
      const [year, month] = key.split('-').map(Number);
      return {
        year,
        month,
        count: monthlyCount[key]
      };
    }).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    console.log(`[Wanami] Student ${studentId} history:`, history);
    
    return history;
  } catch (error) {
    console.error('[Wanami] Error fetching usage history:', error);
    return [];
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

/**
 * Fetch suspension data from Google Sheets
 * @returns {Array} - Array of suspension records
 */
export async function fetchSuspensionData() {
  try {
    const spreadsheetId = '17ys2PZpDpffG3j4EQrXiLlwGbFxiNosBqMivL2quVEA';
    const sheetName = 'フォームの回答 1';
    
    const sheets = getSheets();
    
    // Fetch G, H, K, L columns (生徒名, 学籍番号, 休会期間, 休会開始日)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!G2:L`, // Skip header row
    });

    const rows = response.data.values || [];
    console.log(`[Suspension] Fetched ${rows.length} records from Google Sheets`);

    const suspensions = [];
    
    rows.forEach((row, index) => {
      const studentName = row[0] ? row[0].trim() : null;      // G列 (index 0)
      const studentId = row[1] ? row[1].trim() : null;        // H列 (index 1)
      const suspensionMonths = row[4] ? parseInt(row[4]) : 0; // K列 (index 4)
      const suspensionStartDate = row[5] ? row[5].trim() : null; // L列 (index 5)
      
      if (!studentName || !studentId || !suspensionStartDate) {
        return; // Skip invalid rows
      }
      
      // Calculate suspension end date
      let suspensionEndDate = null;
      if (suspensionStartDate && suspensionMonths > 0) {
        try {
          const startDate = new Date(suspensionStartDate);
          const endDate = new Date(startDate);
          endDate.setMonth(endDate.getMonth() + suspensionMonths);
          endDate.setDate(endDate.getDate() - 1); // -1日
          suspensionEndDate = endDate.toISOString().split('T')[0];
        } catch (error) {
          console.error(`Error calculating end date for row ${index + 2}:`, error);
        }
      }
      
      suspensions.push({
        studentName,
        studentId,
        suspensionMonths,
        suspensionStartDate,
        suspensionEndDate
      });
    });

    console.log(`[Suspension] Processed ${suspensions.length} valid suspension records`);
    return suspensions;
  } catch (error) {
    console.error('Error fetching suspension data from Google Sheets:', error);
    throw error;
  }
}

/**
 * Fetch suspension months map by student ID
 * @returns {Object} - Map of student_id to suspension_months
 */
export async function fetchSuspensionMonthsMap() {
  try {
    const suspensions = await fetchSuspensionData();
    
    // Create map: student_id -> total suspension months
    const suspensionMap = {};
    
    suspensions.forEach(s => {
      if (s.studentId && s.suspensionMonths > 0) {
        // If multiple suspension records exist, sum them up
        suspensionMap[s.studentId] = (suspensionMap[s.studentId] || 0) + s.suspensionMonths;
      }
    });
    
    console.log(`[Suspension Map] Created map for ${Object.keys(suspensionMap).length} students with suspension history`);
    return suspensionMap;
  } catch (error) {
    console.error('Error creating suspension months map:', error);
    return {};
  }
}

/**
 * Fetch student broadcast info from Google Sheets
 * @returns {Array} - Array of student broadcast info
 */
export async function fetchStudentBroadcastInfo() {
  try {
    const spreadsheetId = '1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM';
    const sheetName = '❶RAW_生徒様情報';
    
    const sheets = getSheets();
    
    // Fetch B (学籍番号), G (Discord ID), H (お知らせWH), I (お役立ちWH), M (チャットURL)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!B2:M`, // Skip header row
    });

    const rows = response.data.values || [];
    console.log(`[Broadcast Info] Fetched ${rows.length} student records`);

    const studentInfo = [];
    
    rows.forEach((row, index) => {
      const studentId = row[0] ? row[0].trim() : null;          // B列 (index 0)
      const discordId = row[5] ? row[5].trim() : null;          // G列 (index 5)
      const noticeWebhook = row[6] ? row[6].trim() : null;      // H列 (index 6)
      const tipsWebhook = row[7] ? row[7].trim() : null;        // I列 (index 7)
      const chatUrl = row[11] ? row[11].trim() : null;          // M列 (index 11)
      
      if (studentId) {
        studentInfo.push({
          studentId,
          discordId,
          noticeWebhook,
          tipsWebhook,
          chatUrl
        });
      }
    });

    console.log(`[Broadcast Info] Processed ${studentInfo.length} valid student records`);
    return studentInfo;
  } catch (error) {
    console.error('[Broadcast Info] Error fetching student broadcast info:', error);
    throw error;
  }
}

/**
 * VQ診断結果をスプレッドシートから取得
 * @param {number} startRow - 開始行（1始まり、ヘッダー含む）。デフォルトは2（ヘッダーの次）
 */
export async function fetchVQDiagnosisResults(startRow = 2) {
  try {
    const spreadsheetId = '1_yJtJn8DMFkQBtdIkDWHNBE8-kpHyE3-0FY_oe0EhJ0';
    const sheetName = '診断結果';
    
    const sheets = getSheets();
    
    // A列からS列まで取得（タイムスタンプ～詳細＋メール送信済み）
    const range = `${sheetName}!A${startRow}:S`;
    
    console.log(`📊 VQ診断データ取得開始: 行 ${startRow} から`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    
    const rows = response.data.values || [];
    console.log(`📊 取得した行数: ${rows.length}`);
    
    if (rows.length === 0) {
      return {
        results: [],
        lastRow: startRow - 1
      };
    }
    
    const results = [];
    
    rows.forEach((row, index) => {
      const actualRow = startRow + index;
      
      // B列（学籍番号）が空の場合はスキップ
      const studentId = String(row[1] || '').trim();
      if (!studentId) {
        console.log(`⚠️ 行 ${actualRow}: 学籍番号が空のためスキップ`);
        return;
      }
      
      // P列（診断タイプ）が空の場合はスキップ（まだ診断未完了）
      const diagnosisType = String(row[15] || '').trim();
      if (!diagnosisType) {
        console.log(`⚠️ 行 ${actualRow}: 診断タイプが空のためスキップ (${studentId})`);
        return;
      }
      
      // R列（メール送信済み）をチェック
      const emailSent = String(row[17] || '').trim();
      if (emailSent === '完了') {
        console.log(`✅ 行 ${actualRow}: 送信済みのためスキップ (${studentId})`);
        return;
      }
      
      // A列からタイムスタンプ取得（日付のみ抽出）
      const timestamp = String(row[0] || '').trim();
      let diagnosisDate = null;
      if (timestamp) {
        // "2025/05/28 15:08:59" → "2025/05/28"
        const datePart = timestamp.split(' ')[0];
        diagnosisDate = datePart;
      }
      
      // スコア取得（数値に変換）
      const typeAScore = parseFloat(row[6]) || 0;  // G列
      const typeQScore = parseFloat(row[8]) || 0;  // I列
      const typeVQScore = parseFloat(row[10]) || 0; // K列
      const totalScore = typeAScore + typeQScore + typeVQScore;
      
      // 概要と詳細
      const overview = String(row[18] || '').trim();  // S列
      const details = String(row[19] || '').trim();   // T列
      
      results.push({
        rowNumber: actualRow,
        studentId,
        diagnosisDate,
        totalScore,
        typeAScore,
        typeQScore,
        typeVQScore,
        diagnosisType,
        overview,
        details,
        emailSent
      });
    });
    
    const lastRow = startRow + rows.length - 1;
    
    console.log(`📊 処理対象: ${results.length}件 (最終行: ${lastRow})`);
    
    return {
      results,
      lastRow
    };
    
  } catch (error) {
    console.error('❌ VQ診断データ取得エラー:', error);
    throw error;
  }
}

/**
 * スプレッドシートのR列（メール送信済み）を更新
 * @param {number} rowNumber - 行番号（1始まり）
 * @param {string} value - 設定する値（デフォルト: "完了"）
 */
export async function updateVQDiagnosisEmailStatus(rowNumber, value = '完了') {
  try {
    const spreadsheetId = '1_yJtJn8DMFkQBtdIkDWHNBE8-kpHyE3-0FY_oe0EhJ0';
    const sheetName = '診断結果';
    
    const sheets = getSheets();
    
    const range = `${sheetName}!R${rowNumber}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[value]]
      }
    });
    
    console.log(`✅ R列更新成功: 行 ${rowNumber} → "${value}"`);
    
  } catch (error) {
    console.error(`❌ R列更新エラー (行 ${rowNumber}):`, error);
    throw error;
  }
}

/**
 * 複数行のR列を一括更新
 * @param {Array<{rowNumber: number, value: string}>} updates - 更新対象の配列
 */
export async function batchUpdateVQDiagnosisEmailStatus(updates) {
  try {
    const spreadsheetId = '1_yJtJn8DMFkQBtdIkDWHNBE8-kpHyE3-0FY_oe0EhJ0';
    const sheetName = '診断結果';
    
    const sheets = getSheets();
    
    const data = updates.map(update => ({
      range: `${sheetName}!R${update.rowNumber}`,
      values: [[update.value || '完了']]
    }));
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data
      }
    });
    
    console.log(`✅ R列一括更新成功: ${updates.length}件`);
    
  } catch (error) {
    console.error('❌ R列一括更新エラー:', error);
    throw error;
  }
}
