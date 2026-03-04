// Google Apps Script: Notionデータをスプレッドシートにキャッシュ
// 生徒データ、Tutorデータ、レッスン進捗データを同期
// YouTubeチャンネルID と X ID の取得機能を追加

// ========== 設定 ==========
// スプレッドシート設定
const SPREADSHEET_ID = '1nwaXDkbkUX1FWlqGO4_Ph3_I9SkidXyx4KnviwlSeR8'; // メインスプレッドシートのID
const PROGRESS_SPREADSHEET_ID = '1dwqi8NvrbDDkrwIryYJrOJ2AAg4oBu6v0-CEdR2HrzE'; // レッスン進捗スプレッドシートのID
const DISCORD_DESTINATION_SPREADSHEET_ID = '1iqr'; // Discord配信先スプレッドシートのID（必要に応じて）

// Notion設定
const NOTION_API_KEY = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
const NOTION_STUDENT_DATABASE_ID = PropertiesService.getScriptProperties().getProperty('NOTION_STUDENT_DATABASE_ID');
const NOTION_TUTOR_DATABASE_ID = PropertiesService.getScriptProperties().getProperty('NOTION_TUTOR_DATABASE_ID');

// ========== メイン処理 ==========
/**
 * すべてのデータを同期
 */
function syncAllData() {
  try {
    Logger.log('=== データ同期開始 ===');
    
    // 1. 生徒データ同期
    syncStudentsToSheet();
    
    // 2. Tutorデータ同期
    syncTutorsToSheet();
    
    // 3. レッスン進捗データ同期
    syncLessonProgressToSheet();
    
    Logger.log('=== データ同期完了 ===');
    
  } catch (error) {
    Logger.log('エラー: ' + error.toString());
    throw error;
  }
}

/**
 * 生徒データをNotionから取得してスプレッドシートに書き込む
 */
function syncStudentsToSheet() {
  Logger.log('--- 生徒データ同期開始 ---');
  
  const students = fetchNotionStudents();
  Logger.log(`取得した生徒数: ${students.length}`);
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('生徒データ');
  
  if (!sheet) {
    sheet = ss.insertSheet('生徒データ');
  }
  
  // シートクリア
  sheet.clear();
  
  // ヘッダー行（25列: A～Y）
  const headers = [
    'notion_page_id',           // A
    'student_id',               // B
    'name',                     // C
    'status',                   // D
    'contract_plan',            // E
    'character_name',           // F
    'homeroom_tutor',           // G
    'notion_url',               // H
    'discord_url',              // I
    'payment_status_last_month', // J
    'payment_status_current_month', // K
    'payment_year_month_last',  // L
    'payment_year_month_current', // M
    'result_absence',           // N
    'result_late',              // O
    'result_mission',           // P
    'result_payment',           // Q
    'result_active_listening',  // R
    'result_understanding',     // S
    'result_overall',           // T
    'absence_count',            // U
    'lesson_start_date',        // V
    'suspension_months',        // W
    'youtube_channel_id',       // X (新規)
    'x_account_id'              // Y (新規)
  ];
  sheet.appendRow(headers);
  
  // データ行を作成
  const rows = students.map(student => [
    student.notion_page_id || '',
    student.student_id || '',
    student.name || '',
    student.status || '',
    student.contract_plan || '',
    student.character_name || '',
    student.homeroom_tutor || '',
    student.notion_url || '',
    student.discord_url || '',
    student.payment_status_last_month || '',
    student.payment_status_current_month || '',
    student.payment_year_month_last || '',
    student.payment_year_month_current || '',
    student.result_absence || '',
    student.result_late || '',
    student.result_mission || '',
    student.result_payment || '',
    student.result_active_listening || '',
    student.result_understanding || '',
    student.result_overall || '',
    student.absence_count || '',
    student.lesson_start_date || '',
    student.suspension_months || '',
    student.youtube_channel_id || '',  // 新規
    student.x_account_id || ''         // 新規
  ]);
  
  // データをまとめて書き込み
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 25).setValues(rows);
  }
  
  Logger.log(`生徒データ ${rows.length} 件を書き込みました`);
  Logger.log('--- 生徒データ同期完了 ---');
}

/**
 * Notion生徒データベースから全生徒を取得
 */
function fetchNotionStudents() {
  const students = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const payload = {
      page_size: 100
    };
    
    if (startCursor) {
      payload.start_cursor = startCursor;
    }
    
    const options = {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/databases/${NOTION_STUDENT_DATABASE_ID}/query`,
      options
    );
    
    const data = JSON.parse(response.getContentText());
    
    if (data.results) {
      data.results.forEach(page => {
        students.push(parseStudentPage(page));
      });
    }
    
    hasMore = data.has_more;
    startCursor = data.next_cursor;
    
    // レート制限対策
    if (hasMore) {
      Utilities.sleep(350);
    }
  }
  
  return students;
}

/**
 * Notionページから生徒データを抽出
 */
function parseStudentPage(page) {
  const props = page.properties;
  
  return {
    notion_page_id: page.id,
    student_id: getPropertyValue(props, 'ID', 'rich_text'),
    name: getPropertyValue(props, '名前', 'title'),
    status: getPropertyValue(props, 'ステータス', 'select'),
    contract_plan: getPropertyValue(props, '契約プラン', 'select'),
    character_name: getPropertyValue(props, 'キャラ名', 'rich_text'),
    homeroom_tutor: getPropertyValue(props, '担任Tutor', 'select'),
    notion_url: page.url,
    discord_url: getPropertyValue(props, 'Discord（ユーザーページURL）', 'url'),
    payment_status_last_month: getPropertyValue(props, '先月の支払いステータス', 'select'),
    payment_status_current_month: getPropertyValue(props, '今月の支払いステータス', 'select'),
    payment_year_month_last: getPropertyValue(props, '先月の支払い年月', 'rich_text'),
    payment_year_month_current: getPropertyValue(props, '今月の支払い年月', 'rich_text'),
    result_absence: getPropertyValue(props, '成果_欠席', 'rich_text'),
    result_late: getPropertyValue(props, '成果_遅刻', 'rich_text'),
    result_mission: getPropertyValue(props, '成果_ミッション', 'rich_text'),
    result_payment: getPropertyValue(props, '成果_支払い', 'rich_text'),
    result_active_listening: getPropertyValue(props, '成果_傾聴', 'rich_text'),
    result_understanding: getPropertyValue(props, '成果_把握', 'rich_text'),
    result_overall: getPropertyValue(props, '成果_総合', 'rich_text'),
    absence_count: getPropertyValue(props, '欠席回数', 'number'),
    lesson_start_date: getPropertyValue(props, 'レッスン開始日', 'date'),
    suspension_months: getPropertyValue(props, '休会月', 'rich_text'),
    youtube_channel_id: getPropertyValue(props, 'YTチャンネルID', 'rich_text'),  // 新規
    x_account_id: getPropertyValue(props, 'X ID（@は無し）', 'rich_text')        // 新規（プロパティ名の一部のみ使用）
  };
}

/**
 * Notionプロパティから値を取得
 */
function getPropertyValue(properties, propertyName, propertyType) {
  const prop = properties[propertyName];
  
  if (!prop) {
    return '';
  }
  
  switch (propertyType) {
    case 'title':
      return prop.title && prop.title.length > 0 ? prop.title[0].plain_text : '';
    case 'rich_text':
      return prop.rich_text && prop.rich_text.length > 0 ? prop.rich_text[0].plain_text : '';
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'multi_select':
      return prop.multi_select ? prop.multi_select.map(item => item.name).join(', ') : '';
    case 'date':
      return prop.date ? prop.date.start : '';
    case 'number':
      return prop.number !== null && prop.number !== undefined ? prop.number : '';
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    case 'checkbox':
      return prop.checkbox ? 'true' : 'false';
    case 'people':
      return prop.people && prop.people.length > 0 ? prop.people[0].name : '';
    default:
      return '';
  }
}

/**
 * Tutorデータをスプレッドシートに書き込む
 */
function syncTutorsToSheet() {
  Logger.log('--- Tutorデータ同期開始 ---');
  
  const tutors = fetchNotionTutors();
  Logger.log(`取得したTutor数: ${tutors.length}`);
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Tutorデータ');
  
  if (!sheet) {
    sheet = ss.insertSheet('Tutorデータ');
  }
  
  sheet.clear();
  
  const headers = [
    'notion_page_id',
    'employee_id',
    'name',
    'tutor_name',
    'email',
    'role',
    'status',
    'team',
    'line_url'
  ];
  sheet.appendRow(headers);
  
  const rows = tutors.map(tutor => [
    tutor.notion_page_id || '',
    tutor.employee_id || '',
    tutor.name || '',
    tutor.tutor_name || '',
    tutor.email || '',
    tutor.role || '',
    tutor.status || '',
    tutor.team || '',
    tutor.line_url || ''
  ]);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }
  
  Logger.log(`Tutorデータ ${rows.length} 件を書き込みました`);
  Logger.log('--- Tutorデータ同期完了 ---');
}

/**
 * Notion TutorデータベースからTutorを取得
 */
function fetchNotionTutors() {
  const tutors = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const payload = {
      page_size: 100
    };
    
    if (startCursor) {
      payload.start_cursor = startCursor;
    }
    
    const options = {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(
      `https://api.notion.com/v1/databases/${NOTION_TUTOR_DATABASE_ID}/query`,
      options
    );
    
    const data = JSON.parse(response.getContentText());
    
    if (data.results) {
      data.results.forEach(page => {
        tutors.push(parseTutorPage(page));
      });
    }
    
    hasMore = data.has_more;
    startCursor = data.next_cursor;
    
    if (hasMore) {
      Utilities.sleep(350);
    }
  }
  
  return tutors;
}

/**
 * Notionページから Tutor データを抽出
 */
function parseTutorPage(page) {
  const props = page.properties;
  
  return {
    notion_page_id: page.id,
    employee_id: getPropertyValue(props, '社員番号', 'rich_text'),
    name: getPropertyValue(props, '名前', 'title'),
    tutor_name: getPropertyValue(props, 'Tutor名', 'rich_text'),
    email: getPropertyValue(props, 'メール', 'email'),
    role: getPropertyValue(props, '役職', 'select'),
    status: getPropertyValue(props, 'ステータス', 'select'),
    team: getPropertyValue(props, 'チーム', 'select'),
    line_url: getPropertyValue(props, 'LINE（トークルームURL）', 'url')
  };
}

/**
 * レッスン進捗データを別スプレッドシートに書き込む
 */
function syncLessonProgressToSheet() {
  Logger.log('--- レッスン進捗データ同期開始 ---');
  
  // 生徒データから学習進捗を取得
  const students = fetchNotionStudents();
  
  const progressData = students.map(student => {
    return {
      student_id: student.student_id,
      name: student.name,
      lesson_start_date: student.lesson_start_date,
      // 進捗情報は別プロパティから取得する必要があるかもしれません
    };
  });
  
  const ss = SpreadsheetApp.openById(PROGRESS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('進捗データ');
  
  if (!sheet) {
    sheet = ss.insertSheet('進捗データ');
  }
  
  sheet.clear();
  
  const headers = ['student_id', 'name', 'lesson_start_date'];
  sheet.appendRow(headers);
  
  const rows = progressData.map(data => [
    data.student_id || '',
    data.name || '',
    data.lesson_start_date || ''
  ]);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  
  Logger.log(`進捗データ ${rows.length} 件を書き込みました`);
  Logger.log('--- レッスン進捗データ同期完了 ---');
}

/**
 * トリガー設定（毎日午前3時に実行）
 */
function setupDailyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 新しいトリガーを設定
  ScriptApp.newTrigger('syncAllData')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
  
  Logger.log('毎日午前3時に実行するトリガーを設定しました');
}
