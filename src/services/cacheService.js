import { google } from 'googleapis';

/**
 * Get Google Sheets client
 */
function getSheetsClient() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Fetch students from cache spreadsheet
 */
export async function fetchStudentsFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: '生徒データ!A2:Y', // 25 columns (A-Y) - added YouTube ID and X ID
    });

    const rows = response.data.values || [];
    
    if (rows.length === 0) {
      console.warn('⚠️ Cache spreadsheet is empty. Please run the cache update script.');
      return [];
    }
    
    console.log(`Fetched ${rows.length} students from cache spreadsheet`);

    return rows.map(row => {
      let yearMonthInfo = {};
      try {
        yearMonthInfo = row[11] ? JSON.parse(row[11]) : {};
      } catch (e) {
        yearMonthInfo = {};
      }
      
      return {
        notion_page_id: row[0] || null,
        student_id: row[1] || null,
        name: row[2] || null,
        status: row[3] || null,
        contract_plan: row[4] || null,
        character_name: row[5] || null,
        homeroom_tutor: row[6] || null,
        notion_url: row[7] || null,
        discord_url: row[8] || null,
        payment_status_last_month: row[9] || '未払い',
        payment_status_current_month: row[10] || '未払い',
        payment_year_month_last: yearMonthInfo.last || '',
        payment_year_month_current: yearMonthInfo.current || '',
        result_absence: row[12] || '',
        result_late: row[13] || '',
        result_mission: row[14] || '',
        result_payment: row[15] || '',
        result_active_listening: row[16] || '',
        result_understanding: row[17] || '',
        result_overall: row[18] || '',
        absence_count: row[19] || 0,
        lesson_start_date: row[20] || '',
        suspension_months: row[21] || 0,
        youtube_channel_id: row[22] || '',
        x_account_id: row[23] || '',
      };
    });
  } catch (error) {
    console.error('Error fetching students from cache:', error);
    throw error;
  }
}

/**
 * Fetch tutors from cache spreadsheet
 */
export async function fetchTutorsFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Tutorデータ!A2:I', // Headers in row 1, data starts from row 2, now includes job_type and status
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} tutors from cache spreadsheet`);

    return rows.map(row => ({
      notion_page_id: row[0] || null,
      employee_id: row[1] || null,
      name: row[2] || null,
      tutor_name: row[3] || null,
      email: row[4] ? row[4].toLowerCase() : null, // Convert to lowercase
      team: row[5] || null,
      notion_name: row[6] || null,
      job_type: row[7] || null,
      status: row[8] || null,
    }));
  } catch (error) {
    console.error('Error fetching tutors from cache:', error);
    throw error;
  }
}

/**
 * Fetch lesson progress from cache spreadsheet
 */
export async function fetchProgressFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'レッスン進捗データ!A2:B', // Headers in row 1, data starts from row 2
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} progress records from cache spreadsheet`);

    // Convert to object for easy lookup
    const progressMap = {};
    rows.forEach(row => {
      const studentId = row[0];
      const lessonNumber = row[1];
      if (studentId && lessonNumber) {
        progressMap[studentId] = lessonNumber;
      }
    });

    return progressMap;
  } catch (error) {
    console.error('Error fetching progress from cache:', error);
    throw error;
  }
}

/**
 * Fetch satisfaction data from cache spreadsheet
 */
export async function fetchSatisfactionFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'レッスン満足度データ!A2:F', // タイムスタンプ, 年月, 生徒名, Tutor名, 満足度, 理由
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} satisfaction records from cache spreadsheet`);

    return rows.map(row => ({
      timestamp: row[0] || null,
      year_month: row[1] || null,  // YYYY/M 形式
      student_name: row[2] || null,
      tutor_name: row[3] || null,
      satisfaction_score: row[4] || null,
      reason: row[5] || null,
    }));
  } catch (error) {
    console.error('Error fetching satisfaction from cache:', error);
    throw error;
  }
}

/**
 * Fetch survey response counts from cache spreadsheet
 * Count rows by student_id from satisfaction data
 */
export async function fetchSurveyResponsesFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'レッスン満足度データ!A2:G', // タイムスタンプ, 年月, 生徒名, Tutor名, 満足度, 理由, 学籍番号
    });

    const rows = response.data.values || [];
    console.log(`Fetched ${rows.length} satisfaction records for survey count`);
    
    // Debug: Show first row structure
    if (rows.length > 0) {
      console.log('[Survey Debug] First row structure:');
      console.log(`  - Column A (row[0]): "${rows[0][0] || '(empty)'}"`);
      console.log(`  - Column B (row[1]): "${rows[0][1] || '(empty)'}"`);
      console.log(`  - Column C (row[2]): "${rows[0][2] || '(empty)'}"`);
      console.log(`  - Column D (row[3]): "${rows[0][3] || '(empty)'}"`);
      console.log(`  - Column E (row[4]): "${rows[0][4] || '(empty)'}"`);
      console.log(`  - Column F (row[5]): "${rows[0][5] || '(empty)'}"`);
      console.log(`  - Column G (row[6]): "${rows[0][6] || '(empty)'}"`);
    }

    // Count occurrences of each student_id (column G)
    const responseCountMap = {};
    
    rows.forEach((row, index) => {
      const studentId = row[6]; // G列: 学籍番号
      if (studentId && studentId.toString().trim() !== '') {
        responseCountMap[studentId] = (responseCountMap[studentId] || 0) + 1;
      }
    });
    
    console.log(`Survey response counts calculated for ${Object.keys(responseCountMap).length} students`);
    
    // Debug: Log first 5 student IDs and their counts
    const sampleIds = Object.keys(responseCountMap).slice(0, 5);
    console.log('[Survey Debug] Sample student IDs from spreadsheet (column G):');
    if (sampleIds.length === 0) {
      console.log('  ⚠️ NO STUDENT IDs FOUND - Column G might be empty!');
    } else {
      sampleIds.forEach(id => {
        console.log(`  - "${id}": ${responseCountMap[id]} responses`);
      });
    }
    
    return responseCountMap;
  } catch (error) {
    console.error('Error fetching survey responses from cache:', error);
    throw error;
  }
}

/**
 * Get last sync time from meta sheet
 */
export async function getCacheSyncTime(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'データ同期メタ情報!A2:B2',
    });

    const rows = response.data.values || [];
    if (rows.length > 0 && rows[0].length > 1) {
      return {
        lastSync: rows[0][1], // B2: 最終同期日時
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching cache sync time:', error);
    return null;
  }
}
