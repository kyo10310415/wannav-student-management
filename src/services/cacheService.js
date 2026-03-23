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

    // Helper function to normalize student_id
    const normalizeStudentId = (id) => {
      if (!id) return '';
      return id.toString()
        .trim()                    // Remove leading/trailing spaces
        .replace(/[\s　]/g, '')    // Remove all spaces (half-width and full-width)
        .replace(/－/g, '-')       // Replace full-width hyphen with half-width
        .toUpperCase();            // Normalize to uppercase
    };

    // Count occurrences of each student_id (column G)
    const responseCountMap = {};
    
    rows.forEach((row, index) => {
      const rawStudentId = row[6]; // G列: 学籍番号
      if (rawStudentId && rawStudentId.toString().trim() !== '') {
        const normalizedId = normalizeStudentId(rawStudentId);
        
        // Debug: Log first 3 normalization examples
        if (index < 3) {
          console.log(`[Survey Debug] Normalization example ${index + 1}:`);
          console.log(`  - Original: "${rawStudentId}"`);
          console.log(`  - Normalized: "${normalizedId}"`);
        }
        
        responseCountMap[normalizedId] = (responseCountMap[normalizedId] || 0) + 1;
      }
    });
    
    console.log(`Survey response counts calculated for ${Object.keys(responseCountMap).length} students`);
    
    // Debug: Log first 5 student IDs and their counts
    const sampleIds = Object.keys(responseCountMap).slice(0, 5);
    console.log('[Survey Debug] Sample student IDs from spreadsheet (column G, normalized):');
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
 * Fetch current month survey responses from cache spreadsheet
 * Returns a Set of student_ids who responded this month
 */
export async function fetchCurrentMonthSurveyResponses(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'レッスン満足度データ!A2:G', // タイムスタンプ, 年月, 生徒名, Tutor名, 満足度, 理由, 学籍番号
    });

    const rows = response.data.values || [];
    
    // Get current year and month (YYYY/M format)
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
    
    console.log(`[Survey] Checking for current month responses: ${currentYearMonth}`);
    
    // Helper function to normalize student_id
    const normalizeStudentId = (id) => {
      if (!id) return '';
      return id.toString()
        .trim()
        .replace(/[\s　]/g, '')
        .replace(/－/g, '-')
        .toUpperCase();
    };

    // Collect student_ids who responded in current month
    const currentMonthResponders = new Set();
    
    rows.forEach((row, index) => {
      const yearMonth = row[1]; // B列: 年月
      const rawStudentId = row[6]; // G列: 学籍番号
      
      if (yearMonth && rawStudentId) {
        // Check if this row is for current month
        if (yearMonth.toString().trim() === currentYearMonth) {
          const normalizedId = normalizeStudentId(rawStudentId);
          currentMonthResponders.add(normalizedId);
        }
      }
    });
    
    console.log(`[Survey] Found ${currentMonthResponders.size} students who responded in ${currentYearMonth}`);
    
    return currentMonthResponders;
  } catch (error) {
    console.error('[Survey] Error fetching current month survey responses:', error);
    return new Set();
  }
}

/**
 * Fetch monthly response history for all students from cache spreadsheet
 * Returns a Map: studentId => [{ yearMonth: 'YYYY/M', responded: true }, ...]
 */
export async function fetchMonthlyResponseHistory(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'レッスン満足度データ!A2:G', // タイムスタンプ, 年月, 生徒名, Tutor名, 満足度, 理由, 学籍番号
    });

    const rows = response.data.values || [];
    
    // Helper function to normalize student_id
    const normalizeStudentId = (id) => {
      if (!id) return '';
      return id.toString()
        .trim()
        .replace(/[\s　]/g, '')
        .replace(/－/g, '-')
        .toUpperCase();
    };

    // Map: studentId => Set of yearMonths they responded in
    const responseHistory = new Map();
    
    rows.forEach((row) => {
      const yearMonth = row[1]; // B列: 年月
      const rawStudentId = row[6]; // G列: 学籍番号
      
      if (yearMonth && rawStudentId) {
        const normalizedId = normalizeStudentId(rawStudentId);
        const month = yearMonth.toString().trim();
        
        if (!responseHistory.has(normalizedId)) {
          responseHistory.set(normalizedId, new Set());
        }
        responseHistory.get(normalizedId).add(month);
      }
    });
    
    console.log(`[Survey] Fetched monthly response history for ${responseHistory.size} students`);
    
    return responseHistory;
  } catch (error) {
    console.error('[Survey] Error fetching monthly response history:', error);
    return new Map();
  }
}



/**
 * Fetch extension results from cache spreadsheet
 * Returns an object mapping student_id to extension_result
 */
export async function fetchExtensionResultsFromCache(spreadsheetId) {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: '生徒データ!A2:W', // A-W列 (26列: 延長結果はW列=23列目)
    });

    const rows = response.data.values || [];
    
    console.log(`[Extension] Fetched ${rows.length} student rows from cache spreadsheet`);
    
    // Helper function to normalize student_id
    const normalizeStudentId = (id) => {
      if (!id) return '';
      return id.toString()
        .trim()
        .replace(/[\s　]/g, '')
        .replace(/－/g, '-')
        .toUpperCase();
    };

    // Build extension results map
    const extensionResultsMap = {};
    
    rows.forEach((row, index) => {
      const rawStudentId = row[1]; // B列: 学籍番号
      const extensionResult = row[22]; // W列: 延長結果 (0-based index: 22)
      
      if (rawStudentId) {
        const normalizedId = normalizeStudentId(rawStudentId);
        extensionResultsMap[normalizedId] = extensionResult || null;
      }
    });
    
    console.log(`[Extension] Extension results loaded for ${Object.keys(extensionResultsMap).length} students`);
    
    // Debug: Log first 5 students with extension results
    const sampleIds = Object.keys(extensionResultsMap)
      .filter(id => extensionResultsMap[id])
      .slice(0, 5);
    
    if (sampleIds.length > 0) {
      console.log('[Extension Debug] Sample extension results:');
      sampleIds.forEach(id => {
        console.log(`  - "${id}": ${extensionResultsMap[id]}`);
      });
    } else {
      console.log('  ⚠️ NO EXTENSION RESULTS FOUND - Column W might be empty!');
    }
    
    return extensionResultsMap;
  } catch (error) {
    console.error('Error fetching extension results from cache:', error);
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
