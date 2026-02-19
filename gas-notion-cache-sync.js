// Google Apps Script: Notionデータをスプレッドシートにキャッシュ
// 生徒データ、Tutorデータ、レッスン進捗データを同期

// ========== 設定 ==========

// スプレッドシート設定
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // メインスプレッドシートのID
const PROGRESS_SPREADSHEET_ID = '1dwqi8NvrbDDkrwIryYJrOJ2AAg4oBu6v0-CEdR2HrzE'; // レッスン進捗スプレッドシートのID

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
    // 1. 生徒データを同期
    syncStudentsToSheet();
    Logger.log('✓ 生徒データ同期完了');
    
    // 2. Tutorデータを同期
    syncTutorsToSheet();
    Logger.log('✓ Tutorデータ同期完了');
    
    // 3. レッスン進捗データを同期
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
function syncStudentsToSheet() {
  Logger.log('生徒データ同期開始...');
  
  const students = fetchStudentsFromNotion();
  Logger.log(`Notionから${students.length}件の生徒データを取得`);
  
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
  
  // ヘッダー行を設定
  sheet.getRange(1, 1, 1, 8).setValues([[
    'notion_page_id',
    '学籍番号',
    '名前',
    'ステータス',
    '契約プラン',
    'キャラクター名',
    '担任Tutor',
    '最終更新日時'
  ]]);
  sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  
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
      new Date()
    ]);
    
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
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
      homeroom_tutor: getPropertyValue(props['担任Tutor'])
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
    return {
      notion_page_id: page.id,
      employee_id: getPropertyValue(props['従業員ID']),
      name: getPropertyValue(props['名前']),
      tutor_name: getPropertyValue(props['Tutor名']),
      email: getPropertyValue(props['メールアドレス']),
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
