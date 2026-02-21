// Google Apps Script: Notionデータをスプレッドシートにキャッシュ
// 生徒データ、Tutorデータ、レッスン進捗データを同期

// ========== 設定 ==========

// スプレッドシート設定
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // メインスプレッドシートのID
const PROGRESS_SPREADSHEET_ID = '1dwqi8NvrbDDkrwIryYJrOJ2AAg4oBu6v0-CEdR2HrzE'; // レッスン進捗スプレッドシートのID
const DISCORD_DESTINATION_SPREADSHEET_ID = '1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM'; // Discord送信先スプレッドシートのID
const RESULT_SCORE_SPREADSHEET_ID = '1t571fqZJtUjNL7_gH6G2dSNBCmS98LTnDrWEtt7J92k'; // リザルトスコアスプレッドシートのID
const SUSPENSION_SPREADSHEET_ID = '17ys2PZpDpffG3j4EQrXiLlwGbFxiNosBqMivL2quVEA'; // 休会情報スプレッドシートのID

// バックエンドAPI設定（外部DB用）
const BACKEND_API_URL = 'https://wannav-student-management.onrender.com/api/external/lesson-start-dates'; // バックエンドAPIのURL

// シート名
const STUDENTS_SHEET_NAME = '生徒データ';
const TUTORS_SHEET_NAME = 'Tutorデータ';
const PROGRESS_SHEET_NAME = 'レッスン進捗データ';

// Notion API設定
const NOTION_STUDENT_API_TOKEN = 'YOUR_STUDENT_NOTION_API_TOKEN';
const NOTION_STUDENT_DB_ID = 'YOUR_STUDENT_DATABASE_ID';
const NOTION_TUTOR_API_TOKEN = 'YOUR_TUTOR_NOTION_API_TOKEN';
const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID';

// ========== メイン同期関数 ==========

/**
 * すべてのデータを同期（1日1回実行）
 */
function syncAllData() {
  Logger.log('========== 全データ同期開始 ==========');
  const startTime = new Date();
  
  try {
    // 1. Discord送信先データを取得
    const discordDestinations = fetchDiscordDestinations();
    Logger.log(`✓ Discord送信先: ${Object.keys(discordDestinations).length}件取得`);
    
    // 2. お支払い状況を取得
    const paymentStatuses = fetchPaymentStatuses();
    Logger.log(`✓ お支払い状況: ${Object.keys(paymentStatuses).length}件取得`);
    
    // 3. リザルトスコアを取得（前月）
    const resultScores = fetchResultScores();
    Logger.log(`✓ リザルトスコア: ${Object.keys(resultScores).length}件取得`);
    
    // 4. 欠席回数を取得
    const absenceCounts = fetchAbsenceCounts();
    Logger.log(`✓ 欠席回数: ${Object.keys(absenceCounts).length}件取得`);
    
    // 5. レッスン開始日を取得（外部DB）
    const lessonStartDates = fetchLessonStartDates();
    Logger.log(`✓ レッスン開始日: ${Object.keys(lessonStartDates).length}件取得`);
    
    // 6. 休会期間を取得
    const suspensionPeriods = fetchSuspensionPeriods();
    Logger.log(`✓ 休会期間: ${Object.keys(suspensionPeriods).length}件取得`);
    
    // 7. 生徒データを同期（すべての追加情報を含む）
    syncStudentsToSheet(discordDestinations, paymentStatuses, resultScores, absenceCounts, lessonStartDates, suspensionPeriods);
    Logger.log('✓ 生徒データ同期完了');
    
    // 8. Tutorデータを同期
    syncTutorsToSheet();
    Logger.log('✓ Tutorデータ同期完了');
    
    // 9. レッスン進捗データを同期
    syncProgressToSheet();
    Logger.log('✓ レッスン進捗データ同期完了');
    
    const endTime = new Date();
    const executionTime = Math.round((endTime - startTime) / 1000);
    
    Logger.log(`========== 全データ同期完了 (${executionTime}秒) ==========`);
    
    // メタ情報を記録
    updateSyncMetaSheet(executionTime);
    
  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    throw error;
  }
}

// ========== 生徒データ同期 ==========

/**
 * Notionから生徒データを取得してスプレッドシートに保存
 */
function syncStudentsToSheet(discordDestinations = {}, paymentStatuses = {}, resultScores = {}, absenceCounts = {}, lessonStartDates = {}, suspensionPeriods = {}) {
  Logger.log('生徒データ同期開始...');
  
  const students = fetchStudentsFromNotion();
  Logger.log(`Notionから${students.length}件の生徒データを取得`);
  
  // すべての追加情報を統合
  students.forEach(student => {
    const studentId = student.student_id;
    
    // Discord URL
    const destination = discordDestinations[studentId];
    student.discord_url = destination ? destination.url : '';
    
    // お支払い状況
    const payment = paymentStatuses[studentId];
    if (payment) {
      student.payment_status_last_month = payment.lastMonth || '未払い';
      student.payment_status_current_month = payment.currentMonth || '未払い';
      student.payment_year_month_last = payment.lastMonthYearMonth || '';
      student.payment_year_month_current = payment.currentMonthYearMonth || '';
    } else {
      student.payment_status_last_month = '未払い';
      student.payment_status_current_month = '未払い';
      student.payment_year_month_last = '';
      student.payment_year_month_current = '';
    }
    
    // リザルトスコア
    const score = resultScores[studentId];
    if (score) {
      student.result_absence = score.absence || '';
      student.result_late = score.late || '';
      student.result_mission = score.mission || '';
      student.result_payment = score.payment || '';
      student.result_active_listening = score.activeListening || '';
      student.result_understanding = score.understanding || '';
      student.result_overall = score.overall || '';
    } else {
      student.result_absence = '';
      student.result_late = '';
      student.result_mission = '';
      student.result_payment = '';
      student.result_active_listening = '';
      student.result_understanding = '';
      student.result_overall = '';
    }
    
    // 欠席回数
    student.absence_count = absenceCounts[studentId] || 0;
    
    // レッスン開始日
    student.lesson_start_date = lessonStartDates[studentId] || '';
    
    // 休会期間（月数）
    student.suspension_months = suspensionPeriods[studentId] || 0;
  });
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(STUDENTS_SHEET_NAME);
  
  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(STUDENTS_SHEET_NAME);
    Logger.log(`シート「${STUDENTS_SHEET_NAME}」を作成しました`);
  }
  
  // ヘッダー以外を全削除
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  
  // ヘッダー行を設定（23列に拡張）
  sheet.getRange(1, 1, 1, 23).setValues([[
    'notion_page_id',
    '学籍番号',
    '名前',
    'ステータス',
    '契約プラン',
    'キャラクター名',
    '担任Tutor',
    'Notion URL',
    'Discord URL',
    '前月支払い状況',
    '今月支払い状況',
    '年月情報',
    '欠席',
    '遅刻',
    'ミッション',
    '支払い',
    'アクティブリスニング',
    '理解度',
    '総合評価',
    '欠席回数',
    'レッスン開始日',
    '休会期間（月）',
    '最終更新日時'
  ]]);
  sheet.getRange(1, 1, 1, 23).setFontWeight('bold');
  
  // データを書き込み
  if (students.length > 0) {
    const rows = students.map(s => [
      s.notion_page_id || '',
      s.student_id || '',
      s.name || '',
      s.status || '',
      s.contract_plan || '',
      s.character_name || '',
      s.homeroom_tutor || '',
      s.notion_url || '',
      s.discord_url || '',
      s.payment_status_last_month || '未払い',
      s.payment_status_current_month || '未払い',
      JSON.stringify({last: s.payment_year_month_last, current: s.payment_year_month_current}),
      s.result_absence || '',
      s.result_late || '',
      s.result_mission || '',
      s.result_payment || '',
      s.result_active_listening || '',
      s.result_understanding || '',
      s.result_overall || '',
      s.absence_count || 0,
      s.lesson_start_date || '',
      s.suspension_months || 0,
      new Date()
    ]);
    
    sheet.getRange(2, 1, rows.length, 23).setValues(rows);
  }
  
  Logger.log(`${students.length}件の生徒データを書き込み完了`);
}

/**
 * Notionから生徒データを取得
 */
function fetchStudentsFromNotion() {
  const url = `https://api.notion.com/v1/databases/${NOTION_STUDENT_DB_ID}/query`;
  
  const baseOptions = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${NOTION_STUDENT_API_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;
  let pageCount = 0;
  
  while (hasMore) {
    pageCount++;
    const payload = startCursor 
      ? { start_cursor: startCursor, page_size: 100 } 
      : { page_size: 100 };
    
    const options = {
      ...baseOptions,
      payload: JSON.stringify(payload)
    };
    
    try {
      const response = UrlFetchApp.fetch(url, options);
      const data = JSON.parse(response.getContentText());
      
      if (data.object === 'error') {
        Logger.log(`Notion API エラー: ${data.message}`);
        break;
      }
      
      allResults = allResults.concat(data.results);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
      
      if (hasMore && pageCount % 3 === 0) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`Notion API エラー: ${error.message}`);
      break;
    }
  }
  
  return allResults.map(page => {
    const props = page.properties;
    return {
      notion_page_id: page.id,
      student_id: getPropertyValue(props['学籍番号']),
      name: getPropertyValue(props['名前']),
      status: getPropertyValue(props['ステータス']),
      contract_plan: getPropertyValue(props['契約プラン']),
      character_name: getPropertyValue(props['キャラクター名']),
      homeroom_tutor: getPropertyValue(props['担任Tutor']),
      notion_url: getPropertyValue(props['Notion URL']) || getPropertyValue(props['NotionURL']) || '',
      discord_url: '' // Will be filled from Discord destination spreadsheet
    };
  });
}

// ========== Tutorデータ同期 ==========

/**
 * NotionからTutorデータを取得してスプレッドシートに保存
 */
function syncTutorsToSheet() {
  Logger.log('Tutorデータ同期開始...');
  
  const tutors = fetchTutorsFromNotion();
  Logger.log(`Notionから${tutors.length}件のTutorデータを取得`);
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(TUTORS_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(TUTORS_SHEET_NAME);
    Logger.log(`シート「${TUTORS_SHEET_NAME}」を作成しました`);
  }
  
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  
  sheet.getRange(1, 1, 1, 10).setValues([[
    'notion_page_id',
    '従業員ID',
    '名前',
    'Tutor名',
    'メールアドレス',
    '所属チーム',
    'Notion名',
    '職種',
    'ステータス',
    '最終更新日時'
  ]]);
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  
  // Filter: status='アクティブ' AND job_type contains 'Tutor'
  const filteredTutors = tutors.filter(t => {
    const status = t.status || '';
    const jobType = t.job_type || '';
    
    // Status must be 'アクティブ'
    if (status !== 'アクティブ') {
      return false;
    }
    
    // Job type must contain 'Tutor' (case-insensitive)
    if (!jobType.includes('Tutor')) {
      return false;
    }
    
    return true;
  });
  
  Logger.log(`フィルタリング結果: ${tutors.length}件中${filteredTutors.length}件がアクティブTutor`);
  
  if (filteredTutors.length > 0) {
    const rows = filteredTutors.map(t => [
      t.notion_page_id || '',
      t.employee_id || '',
      t.name || '',
      t.tutor_name || '',
      t.email || '',
      t.team || '',
      t.notion_name || '',
      t.job_type || '',
      t.status || '',
      new Date()
    ]);
    
    sheet.getRange(2, 1, rows.length, 10).setValues(rows);
  }
  
  Logger.log(`${filteredTutors.length}件のTutorデータを書き込み完了`);
}

/**
 * NotionからTutorデータを取得
 */
function fetchTutorsFromNotion() {
  const url = `https://api.notion.com/v1/databases/${NOTION_TUTOR_DB_ID}/query`;
  
  const baseOptions = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${NOTION_TUTOR_API_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;
  let pageCount = 0;
  
  while (hasMore) {
    pageCount++;
    const payload = startCursor 
      ? { start_cursor: startCursor, page_size: 100 } 
      : { page_size: 100 };
    
    const options = {
      ...baseOptions,
      payload: JSON.stringify(payload)
    };
    
    try {
      const response = UrlFetchApp.fetch(url, options);
      const data = JSON.parse(response.getContentText());
      
      if (data.object === 'error') {
        Logger.log(`Notion API エラー: ${data.message}`);
        break;
      }
      
      allResults = allResults.concat(data.results);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
      
      if (hasMore && pageCount % 3 === 0) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`Notion API エラー: ${error.message}`);
      break;
    }
  }
  
  return allResults.map(page => {
    const props = page.properties;
    const email = getPropertyValue(props['メールアドレス']);
    
    return {
      notion_page_id: page.id,
      employee_id: getPropertyValue(props['従業員ID']),
      name: getPropertyValue(props['名前']),
      tutor_name: getPropertyValue(props['Tutor名']),
      email: email ? email.toLowerCase() : null, // Convert to lowercase
      team: getPropertyValue(props['所属チーム']),
      notion_name: getPropertyValue(props['Notion名']),
      job_type: getPropertyValue(props['職種']),
      status: getPropertyValue(props['ステータス'])
    };
  });
}

// ========== レッスン進捗データ同期 ==========

/**
 * レッスン進捗スプレッドシートからデータを取得して保存
 */
function syncProgressToSheet() {
  Logger.log('レッスン進捗データ同期開始...');
  
  // 元のスプレッドシートからデータを取得
  const sourceSS = SpreadsheetApp.openById(PROGRESS_SPREADSHEET_ID);
  const sourceSheet = sourceSS.getSheetByName('24_12_30_フォームの回答 2');
  
  if (!sourceSheet) {
    Logger.log('⚠️ 警告: レッスン進捗シートが見つかりません');
    return;
  }
  
  // F列（学籍番号）とK列（レッスン番号）を取得
  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('進捗データがありません');
    return;
  }
  
  const studentIds = sourceSheet.getRange(2, 6, lastRow - 1, 1).getValues(); // F列
  const lessonNumbers = sourceSheet.getRange(2, 11, lastRow - 1, 1).getValues(); // K列
  
  // 学籍番号ごとに最新のレッスン番号を取得
  const progressMap = {};
  for (let i = 0; i < studentIds.length; i++) {
    const studentId = studentIds[i][0];
    const lessonNumber = lessonNumbers[i][0];
    
    if (studentId && lessonNumber) {
      // 後の行（下の行）が最新として上書き
      progressMap[studentId] = lessonNumber;
    }
  }
  
  Logger.log(`${Object.keys(progressMap).length}件の進捗データを取得`);
  
  // メインスプレッドシートに保存
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PROGRESS_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(PROGRESS_SHEET_NAME);
    Logger.log(`シート「${PROGRESS_SHEET_NAME}」を作成しました`);
  }
  
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  
  sheet.getRange(1, 1, 1, 3).setValues([[
    '学籍番号',
    'レッスン番号',
    '最終更新日時'
  ]]);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  
  const rows = Object.entries(progressMap).map(([studentId, lessonNumber]) => [
    studentId,
    lessonNumber,
    new Date()
  ]);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  
  Logger.log(`${rows.length}件の進捗データを書き込み完了`);
}

// ========== Discord送信先データ取得 ==========

/**
 * Discord送信先スプレッドシートからURLを取得
 */
function fetchDiscordDestinations() {
  Logger.log('Discord送信先データ取得開始...');
  
  try {
    const ss = SpreadsheetApp.openById(DISCORD_DESTINATION_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('❶RAW_生徒様情報');
    
    if (!sheet) {
      Logger.log('⚠️ 警告: ❶RAW_生徒様情報シートが見つかりません');
      return {};
    }
    
    const data = sheet.getDataRange().getValues();
    
    // ヘッダー行を確認（1行目）
    const headers = data[0];
    Logger.log(`ヘッダー: ${headers.join(', ')}`);
    
    // B列: 学籍番号, M列: チャットURL
    const studentIdIndex = 1; // B列 (0-indexed)
    const chatUrlIndex = 12;  // M列 (0-indexed)
    
    Logger.log(`学籍番号列: ${headers[studentIdIndex]}, チャットURL列: ${headers[chatUrlIndex]}`);
    
    // データをマッピング（2行目以降）
    const destinations = {};
    let validCount = 0;
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const studentId = row[studentIdIndex];
      const chatUrl = row[chatUrlIndex];
      
      if (studentId && chatUrl) {
        destinations[studentId] = {
          url: chatUrl
        };
        validCount++;
      }
    }
    
    Logger.log(`Discord送信先: ${validCount}件取得完了（全${data.length - 1}行中）`);
    return destinations;
    
  } catch (error) {
    Logger.log(`❌ Discord送信先取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

// ========== お支払い状況取得 ==========

/**
 * お支払い状況スプレッドシートから前月と今月の支払い状況を取得
 */
function fetchPaymentStatuses() {
  Logger.log('お支払い状況データ取得開始...');
  
  try {
    const ss = SpreadsheetApp.openById(DISCORD_DESTINATION_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('RAW_支払い状況');
    
    if (!sheet) {
      Logger.log('⚠️ 警告: RAW_支払い状況シートが見つかりません');
      return {};
    }
    
    const data = sheet.getDataRange().getValues();
    
    // ヘッダー行は13行目（0-indexedで12）
    if (data.length < 13) {
      Logger.log('⚠️ 警告: データが13行未満です');
      return {};
    }
    
    const headers = data[12]; // 13行目
    Logger.log(`お支払い状況ヘッダー: ${headers.join(', ')}`);
    
    // C列: 学籍番号
    const studentIdIndex = 2; // C列 (0-indexed)
    
    // 前月と今月の年月を計算
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const lastMonthYearMonth = `${lastMonth.getFullYear()}/${lastMonth.getMonth() + 1}`;
    const currentMonthYearMonth = `${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}`;
    
    Logger.log(`前月: ${lastMonthYearMonth}, 今月: ${currentMonthYearMonth}`);
    
    // 前月の列を検索（日付オブジェクトまたは文字列に対応）
    let lastMonthColumnIndex = -1;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      
      // 日付オブジェクトの場合
      if (header instanceof Date) {
        const headerYear = header.getFullYear();
        const headerMonth = header.getMonth() + 1;
        if (headerYear === lastMonth.getFullYear() && headerMonth === lastMonth.getMonth() + 1) {
          lastMonthColumnIndex = i;
          break;
        }
      }
      // 文字列の場合（"2026/1"形式）
      else if (header.toString().trim() === lastMonthYearMonth) {
        lastMonthColumnIndex = i;
        break;
      }
    }
    
    // 今月の列を検索（日付オブジェクトまたは文字列に対応）
    let currentMonthColumnIndex = -1;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      
      // 日付オブジェクトの場合
      if (header instanceof Date) {
        const headerYear = header.getFullYear();
        const headerMonth = header.getMonth() + 1;
        if (headerYear === currentMonth.getFullYear() && headerMonth === currentMonth.getMonth() + 1) {
          currentMonthColumnIndex = i;
          break;
        }
      }
      // 文字列の場合（"2026/2"形式）
      else if (header.toString().trim() === currentMonthYearMonth) {
        currentMonthColumnIndex = i;
        break;
      }
    }
    
    if (lastMonthColumnIndex === -1 || currentMonthColumnIndex === -1) {
      Logger.log(`⚠️ 警告: 前月(${lastMonthYearMonth})または今月(${currentMonthYearMonth})の列が見つかりません`);
      Logger.log(`前月列インデックス: ${lastMonthColumnIndex}, 今月列インデックス: ${currentMonthColumnIndex}`);
      
      // 利用可能な日付列を表示
      const availableDates = headers.map((h, idx) => {
        if (h instanceof Date) {
          return `${idx}: ${h.getFullYear()}/${h.getMonth() + 1}`;
        }
        return null;
      }).filter(d => d !== null);
      Logger.log(`利用可能な年月（Dateオブジェクト）: ${availableDates.join(', ')}`);
      
      const availableStrings = headers.map((h, idx) => {
        if (h && !(h instanceof Date) && h.toString().match(/\d{4}\/\d{1,2}/)) {
          return `${idx}: ${h}`;
        }
        return null;
      }).filter(d => d !== null);
      Logger.log(`利用可能な年月（文字列）: ${availableStrings.join(', ')}`);
      
      return {};
    }
    
    const lastMonthHeader = headers[lastMonthColumnIndex];
    const currentMonthHeader = headers[currentMonthColumnIndex];
    const lastMonthDisplay = lastMonthHeader instanceof Date 
      ? `${lastMonthHeader.getFullYear()}/${lastMonthHeader.getMonth() + 1}` 
      : lastMonthHeader;
    const currentMonthDisplay = currentMonthHeader instanceof Date 
      ? `${currentMonthHeader.getFullYear()}/${currentMonthHeader.getMonth() + 1}` 
      : currentMonthHeader;
    
    Logger.log(`前月列: ${lastMonthDisplay}（インデックス: ${lastMonthColumnIndex}）`);
    Logger.log(`今月列: ${currentMonthDisplay}（インデックス: ${currentMonthColumnIndex}）`);
    
    // データをマッピング（14行目以降 = index 13以降）
    const statuses = {};
    let validCount = 0;
    
    for (let i = 13; i < data.length; i++) {
      const row = data[i];
      const studentId = row[studentIdIndex];
      const lastMonthValue = row[lastMonthColumnIndex];
      const currentMonthValue = row[currentMonthColumnIndex];
      
      if (studentId) {
        // 前月: 空欄または空白の場合は「未払い」
        const lastMonthStatus = (lastMonthValue && lastMonthValue.toString().trim() !== '') 
          ? lastMonthValue.toString().trim() 
          : '未払い';
        
        // 今月: 空欄または空白の場合は「未払い」
        const currentMonthStatus = (currentMonthValue && currentMonthValue.toString().trim() !== '') 
          ? currentMonthValue.toString().trim() 
          : '未払い';
        
        statuses[studentId] = {
          lastMonth: lastMonthStatus,
          currentMonth: currentMonthStatus,
          lastMonthYearMonth: lastMonthYearMonth,
          currentMonthYearMonth: currentMonthYearMonth
        };
        validCount++;
      }
    }
    
    Logger.log(`お支払い状況: ${validCount}件取得完了（全${data.length - 13}行中）`);
    Logger.log(`前月(${lastMonthYearMonth}), 今月(${currentMonthYearMonth})のデータを取得`);
    return statuses;
    
  } catch (error) {
    Logger.log(`❌ お支払い状況取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

// ========== ヘルパー関数 ==========

/**
 * Notionプロパティから値を取得
 */
function getPropertyValue(property) {
  if (!property) return null;
  
  switch (property.type) {
    case 'title':
      return property.title.length > 0 ? property.title[0].plain_text : null;
    case 'rich_text':
      return property.rich_text.length > 0 ? property.rich_text[0].plain_text : null;
    case 'number':
      return property.number;
    case 'select':
      return property.select ? property.select.name : null;
    case 'multi_select':
      return property.multi_select.map(s => s.name).join(', ');
    case 'date':
      return property.date ? property.date.start : null;
    case 'checkbox':
      return property.checkbox;
    case 'url':
      return property.url;
    case 'email':
      return property.email;
    case 'phone_number':
      return property.phone_number;
    case 'people':
      return property.people.map(p => p.name).join(', ');
    case 'files':
      return property.files.length > 0 ? property.files[0].name : null;
    case 'relation':
      return property.relation.length > 0 ? property.relation[0].id : null;
    case 'formula':
      return getPropertyValue({ type: property.formula.type, [property.formula.type]: property.formula[property.formula.type] });
    case 'rollup':
      return getPropertyValue({ type: property.rollup.type, [property.rollup.type]: property.rollup[property.rollup.type] });
    default:
      return null;
  }
}

/**
 * メタ情報を記録
 */
function updateSyncMetaSheet(executionTime) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let metaSheet = ss.getSheetByName('データ同期メタ情報');
  
  if (!metaSheet) {
    metaSheet = ss.insertSheet('データ同期メタ情報');
  }
  
  metaSheet.clear();
  
  metaSheet.appendRow(['項目', '値']);
  metaSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  
  metaSheet.appendRow(['最終同期日時', new Date()]);
  metaSheet.appendRow(['実行時間（秒）', executionTime]);
  
  metaSheet.autoResizeColumns(1, 2);
}

// ========== トリガー設定 ==========

/**
 * 1日1回実行するトリガーを設定
 */
function setupDailyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 毎日午前2時に実行
  ScriptApp.newTrigger('syncAllData')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  
  Logger.log('トリガーを設定しました: 毎日午前2時に syncAllData を実行');
}

/**
 * テスト実行
 */
function testSyncAllData() {
  syncAllData();
}

// ========== リザルトスコア取得 ==========

/**
 * リザルトスコアスプレッドシートから前月のデータを取得
 */
function fetchResultScores() {
  Logger.log('リザルトスコアデータ取得開始...');
  
  try {
    // 前月のシート名を生成（例: 評価結果_2026-01）
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const sheetName = `評価結果_${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    
    Logger.log(`対象シート: ${sheetName}`);
    
    const ss = SpreadsheetApp.openById(RESULT_SCORE_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      Logger.log(`⚠️ 警告: ${sheetName}シートが見つかりません`);
      return {};
    }
    
    const data = sheet.getDataRange().getValues();
    
    if (data.length < 2) {
      Logger.log('⚠️ 警告: データが不足しています');
      return {};
    }
    
    const headers = data[0]; // 1行目がヘッダー
    Logger.log(`ヘッダー: ${headers.join(', ')}`);
    
    // B列: 学籍番号, D-J列: 評価データ
    const studentIdIndex = 1; // B列
    const absenceIndex = 3;   // D列: 欠席
    const lateIndex = 4;      // E列: 遅刻
    const missionIndex = 5;   // F列: ミッション
    const paymentIndex = 6;   // G列: 支払い
    const activeListeningIndex = 7; // H列: アクティブリスニング
    const understandingIndex = 8;   // I列: 理解度
    const overallIndex = 9;   // J列: 総合評価
    
    const scores = {};
    let validCount = 0;
    
    // 2行目以降のデータをマッピング
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const studentId = row[studentIdIndex];
      
      if (studentId) {
        scores[studentId] = {
          absence: row[absenceIndex] || '',
          late: row[lateIndex] || '',
          mission: row[missionIndex] || '',
          payment: row[paymentIndex] || '',
          activeListening: row[activeListeningIndex] || '',
          understanding: row[understandingIndex] || '',
          overall: row[overallIndex] || ''
        };
        validCount++;
      }
    }
    
    Logger.log(`リザルトスコア: ${validCount}件取得完了（全${data.length - 1}行中）`);
    return scores;
    
  } catch (error) {
    Logger.log(`❌ リザルトスコア取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

// ========== 欠席回数取得 ==========

/**
 * レッスン進捗スプレッドシートから欠席回数を集計
 */
function fetchAbsenceCounts() {
  Logger.log('欠席回数データ取得開始...');
  
  try {
    const ss = SpreadsheetApp.openById(PROGRESS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('24_12_30_フォームの回答 2');
    
    if (!sheet) {
      Logger.log('⚠️ 警告: 24_12_30_フォームの回答 2 シートが見つかりません');
      return {};
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('欠席データがありません');
      return {};
    }
    
    // F列: 学籍番号, G列: 生徒様の出欠
    const studentIds = sheet.getRange(2, 6, lastRow - 1, 1).getValues(); // F列
    const attendances = sheet.getRange(2, 7, lastRow - 1, 1).getValues(); // G列
    
    const absenceCounts = {};
    
    for (let i = 0; i < studentIds.length; i++) {
      const studentId = studentIds[i][0];
      const attendance = attendances[i][0];
      
      if (studentId) {
        if (!absenceCounts[studentId]) {
          absenceCounts[studentId] = 0;
        }
        
        // 「欠席」が含まれる場合にカウント
        if (attendance && attendance.toString().includes('欠席')) {
          absenceCounts[studentId]++;
        }
      }
    }
    
    Logger.log(`欠席回数: ${Object.keys(absenceCounts).length}件集計完了`);
    return absenceCounts;
    
  } catch (error) {
    Logger.log(`❌ 欠席回数取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

/**
 * 外部DBからレッスン開始日を取得
 */
function fetchLessonStartDates() {
  Logger.log('レッスン開始日データ取得開始...');
  
  try {
    const options = {
      method: 'get',
      headers: {
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(BACKEND_API_URL, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode !== 200) {
      Logger.log(`⚠️ 警告: API呼び出し失敗 (status: ${statusCode})`);
      Logger.log(`Response: ${response.getContentText()}`);
      return {};
    }
    
    const data = JSON.parse(response.getContentText());
    
    if (!data.success) {
      Logger.log(`⚠️ 警告: APIエラー - ${data.error}`);
      return {};
    }
    
    Logger.log(`レッスン開始日: ${data.count}件取得完了`);
    return data.data || {};
    
  } catch (error) {
    Logger.log(`❌ レッスン開始日取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

/**
 * 休会期間を取得
 * スプレッドシートから休会情報を取得し、学籍番号ごとの休会月数を計算
 */
function fetchSuspensionPeriods() {
  Logger.log('休会期間データ取得開始...');
  
  try {
    const ss = SpreadsheetApp.openById(SUSPENSION_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('フォームの回答 1');
    
    if (!sheet) {
      Logger.log('⚠️ 警告: フォームの回答 1 シートが見つかりません');
      return {};
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('休会データがありません');
      return {};
    }
    
    // H列: 休会となる生徒様の学籍番号, K列: 休会期間
    const studentIds = sheet.getRange(2, 8, lastRow - 1, 1).getValues(); // H列
    const suspensionPeriods = sheet.getRange(2, 11, lastRow - 1, 1).getValues(); // K列
    
    const suspensionMonthsMap = {};
    
    for (let i = 0; i < studentIds.length; i++) {
      const studentId = studentIds[i][0];
      const period = suspensionPeriods[i][0];
      
      if (studentId && period) {
        // 休会期間から月数を抽出（例: "3ヶ月" → 3, "1ヶ月" → 1）
        const months = parseSuspensionPeriod(period);
        
        if (months > 0) {
          // 同じ学籍番号が複数ある場合は合計する
          if (!suspensionMonthsMap[studentId]) {
            suspensionMonthsMap[studentId] = 0;
          }
          suspensionMonthsMap[studentId] += months;
        }
      }
    }
    
    Logger.log(`休会期間: ${Object.keys(suspensionMonthsMap).length}件集計完了`);
    return suspensionMonthsMap;
    
  } catch (error) {
    Logger.log(`❌ 休会期間取得エラー: ${error.message}`);
    Logger.log(error.stack);
    return {};
  }
}

/**
 * 休会期間文字列から月数を抽出
 * @param {string} period - 休会期間文字列（例: "3ヶ月", "1ヶ月", "3か月", "3カ月"）
 * @return {number} 月数
 */
function parseSuspensionPeriod(period) {
  if (!period) return 0;
  
  const str = period.toString().trim();
  
  // 数字を抽出（例: "3ヶ月" → "3", "1ヶ月" → "1"）
  const match = str.match(/(\d+)/);
  
  if (match && match[1]) {
    const months = parseInt(match[1], 10);
    return isNaN(months) ? 0 : months;
  }
  
  return 0;
}
