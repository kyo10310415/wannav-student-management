import { google } from 'googleapis';

let sheets;

/**
 * Initialize Google Sheets API
 */
function getSheets() {
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
    const lessons = rows.map(row => ({
      calendar_event_id: row[0] || null,
      student_id: row[1] || null,
      tutor_name: row[2] || null,
      tutor_email: row[3] || null,
      lesson_date: row[4] ? new Date(row[4]) : null,
      title: row[5] || null,
      description: row[6] || null,
      meet_link: row[7] || null,
    })).filter(lesson => lesson.student_id); // 学籍番号がないものは除外

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
