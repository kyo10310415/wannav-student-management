// Google Apps Script: 特定アカウントの特定イベントを取得
// ロープレ、1on1、チームMTG、チーム研修を自動収集

// ========== 設定 ==========

// スプレッドシート設定
const SPECIAL_SPREADSHEET_ID = '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo';
const TARGET_ACCOUNTS_SHEET = '個別取得シート'; // 対象アカウント一覧シート
const OUTPUT_SHEET_NAME = '特定イベント一覧'; // 出力先シート名

// 検索キーワード
const SEARCH_KEYWORDS = [
  'ロープレ',
  '1on1',
  'チームMTG',
  'チーム研修'
];

// 取得期間設定（先月1日～来月末日）
function getDateRange() {
  const today = new Date();
  
  // 先月の1日
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  startDate.setHours(0, 0, 0, 0);
  
  // 来月の末日
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0); // 0日 = 前月の末日
  endDate.setHours(23, 59, 59, 999);
  
  return { startDate, endDate };
}

// ========== メイン処理 ==========

/**
 * 特定イベント同期メイン関数
 */
function syncSpecialEvents() {
  Logger.log('========== 特定イベント同期開始 ==========');
  const startTime = new Date();
  
  // スプレッドシートを開く
  const ss = SpreadsheetApp.openById(SPECIAL_SPREADSHEET_ID);
  
  // 対象アカウント一覧を取得
  const targetEmails = getTargetEmails(ss);
  
  if (targetEmails.length === 0) {
    Logger.log('エラー: 対象アカウントが見つかりません');
    return;
  }
  
  Logger.log(`対象アカウント数: ${targetEmails.length}件`);
  Logger.log(`対象メールアドレス: ${targetEmails.join(', ')}`);
  
  // 出力先シートを準備
  const outputSheet = prepareOutputSheet(ss);
  
  // 取得期間を設定
  const { startDate, endDate } = getDateRange();
  Logger.log(`取得期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  // 各アカウントからイベントを取得
  const allEvents = [];
  let successCount = 0;
  let failCount = 0;
  
  targetEmails.forEach((email, index) => {
    try {
      Logger.log(`[${index + 1}/${targetEmails.length}] ${email} からイベント取得中...`);
      
      const calendar = CalendarApp.getCalendarById(email);
      
      if (!calendar) {
        Logger.log(`  ⚠️ カレンダーにアクセスできません: ${email}`);
        failCount++;
        return;
      }
      
      // 期間内のすべてのイベントを取得
      const events = calendar.getEvents(startDate, endDate);
      Logger.log(`  取得イベント数: ${events.length}件`);
      
      // キーワードに一致するイベントをフィルタ
      let matchCount = 0;
      events.forEach(event => {
        const title = event.getTitle();
        const description = event.getDescription() || '';
        
        // いずれかのキーワードが含まれるかチェック
        const matchedKeyword = SEARCH_KEYWORDS.find(keyword => 
          title.includes(keyword) || description.includes(keyword)
        );
        
        if (matchedKeyword) {
          allEvents.push({
            email: email,
            eventId: event.getId(),
            title: title,
            description: description,
            startTime: event.getStartTime(),
            endTime: event.getEndTime(),
            location: event.getLocation() || '',
            meetLink: extractMeetLink(description),
            matchedKeyword: matchedKeyword,
            attendees: getAttendeesList(event),
            createdBy: email
          });
          matchCount++;
        }
      });
      
      Logger.log(`  一致イベント: ${matchCount}件`);
      successCount++;
      
      // APIレート制限対策
      if ((index + 1) % 10 === 0) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`  ❌ エラー [${email}]: ${error.message}`);
      failCount++;
    }
  });
  
  Logger.log(`カレンダー取得完了: 成功 ${successCount}件、失敗 ${failCount}件`);
  Logger.log(`一致イベント総数: ${allEvents.length}件`);
  
  // データをシートに書き込み
  writeEventsToSheet(outputSheet, allEvents);
  
  // 実行時間を計算
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  
  Logger.log('========== 特定イベント同期完了 ==========');
  Logger.log(`実行時間: ${executionTime}秒`);
  Logger.log(`対象アカウント: ${targetEmails.length}件`);
  Logger.log(`取得イベント: ${allEvents.length}件`);
  
  // メタ情報を記録
  updateSpecialEventsMeta(ss, targetEmails.length, allEvents.length, successCount, failCount, executionTime);
}

// ========== ヘルパー関数 ==========

/**
 * 対象アカウント一覧を取得
 */
function getTargetEmails(ss) {
  try {
    const sheet = ss.getSheetByName(TARGET_ACCOUNTS_SHEET);
    
    if (!sheet) {
      Logger.log(`エラー: シート「${TARGET_ACCOUNTS_SHEET}」が見つかりません`);
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    
    // ヘッダー行をスキップして、メールアドレス列を取得
    // 想定: A列にメールアドレスが記載されている
    const emails = [];
    
    for (let i = 1; i < data.length; i++) { // i=1でヘッダーをスキップ
      const email = data[i][0]; // A列
      
      if (email && typeof email === 'string' && email.includes('@')) {
        // メールアドレスを小文字に統一
        emails.push(email.toLowerCase().trim());
      }
    }
    
    // 重複を除去
    return [...new Set(emails)];
    
  } catch (error) {
    Logger.log(`エラー: 対象アカウント取得失敗 - ${error.message}`);
    return [];
  }
}

/**
 * 出力先シートを準備
 */
function prepareOutputSheet(ss) {
  let sheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  
  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(OUTPUT_SHEET_NAME);
    Logger.log(`シート「${OUTPUT_SHEET_NAME}」を作成しました`);
  } else {
    // 既存データをクリア（ヘッダー以外）
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
  }
  
  // ヘッダー行を設定
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'イベントID',
      'アカウント',
      '一致キーワード',
      'タイトル',
      '開始日時',
      '終了日時',
      '場所',
      '説明',
      'Meetリンク',
      '参加者',
      '取得日時'
    ]);
    
    // ヘッダー行を太字・背景色設定
    const headerRange = sheet.getRange(1, 1, 1, 11);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4A86E8');
    headerRange.setFontColor('#FFFFFF');
  }
  
  return sheet;
}

/**
 * イベントをシートに書き込み
 */
function writeEventsToSheet(sheet, events) {
  if (events.length === 0) {
    Logger.log('書き込むイベントがありません');
    return;
  }
  
  Logger.log(`${events.length}件のイベントをシートに書き込み中...`);
  
  // 開始日時でソート（昇順）
  events.sort((a, b) => a.startTime - b.startTime);
  
  // データ行を作成
  const rows = events.map(event => [
    event.eventId,
    event.createdBy,
    event.matchedKeyword,
    event.title,
    event.startTime,
    event.endTime,
    event.location,
    event.description,
    event.meetLink || '',
    event.attendees,
    new Date()
  ]);
  
  // 一括書き込み
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 11).setValues(rows);
  }
  
  // 列幅を自動調整
  sheet.autoResizeColumns(1, 11);
  
  // 日時列のフォーマット
  if (rows.length > 0) {
    sheet.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm'); // 開始日時
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm'); // 終了日時
    sheet.getRange(2, 11, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss'); // 取得日時
  }
  
  Logger.log(`✅ ${rows.length}件のイベントを書き込みました`);
}

/**
 * 参加者リストを取得
 */
function getAttendeesList(event) {
  try {
    const guests = event.getGuestList();
    const attendees = guests.map(guest => guest.getEmail()).join(', ');
    return attendees;
  } catch (error) {
    return '';
  }
}

/**
 * Meetリンクを抽出
 */
function extractMeetLink(description) {
  if (!description) return null;
  const match = description.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
  return match ? match[0] : null;
}

/**
 * 日付をフォーマット
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

// ========== メタ情報記録 ==========

/**
 * 同期メタ情報を記録
 */
function updateSpecialEventsMeta(ss, targetCount, eventCount, successCount, failCount, executionTime) {
  const metaSheetName = '特定イベント同期メタ情報';
  let metaSheet = ss.getSheetByName(metaSheetName);
  
  if (!metaSheet) {
    metaSheet = ss.insertSheet(metaSheetName);
  }
  
  metaSheet.clear();
  
  // ヘッダー
  metaSheet.appendRow(['項目', '値']);
  const headerRange = metaSheet.getRange(1, 1, 1, 2);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4A86E8');
  headerRange.setFontColor('#FFFFFF');
  
  // データ
  const { startDate, endDate } = getDateRange();
  metaSheet.appendRow(['最終同期日時', new Date()]);
  metaSheet.appendRow(['取得期間（開始）', startDate]);
  metaSheet.appendRow(['取得期間（終了）', endDate]);
  metaSheet.appendRow(['検索キーワード', SEARCH_KEYWORDS.join(', ')]);
  metaSheet.appendRow(['対象アカウント数', targetCount]);
  metaSheet.appendRow(['取得イベント数', eventCount]);
  metaSheet.appendRow(['成功カレンダー数', successCount]);
  metaSheet.appendRow(['失敗カレンダー数', failCount]);
  metaSheet.appendRow(['実行時間（秒）', executionTime]);
  
  // 列幅を調整
  metaSheet.autoResizeColumns(1, 2);
  
  // 日時列のフォーマット
  metaSheet.getRange(2, 2, 1, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  metaSheet.getRange(3, 2, 2, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
}

// ========== トリガー設定 ==========

/**
 * 毎日AM5:00に実行するトリガーを設定
 */
function setupSpecialEventsTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncSpecialEvents') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 毎日AM5:00に実行
  ScriptApp.newTrigger('syncSpecialEvents')
    .timeBased()
    .atHour(5)
    .everyDays(1)
    .create();
  
  Logger.log('トリガーを設定しました: 毎日AM5:00に syncSpecialEvents を実行');
}

/**
 * 特定イベント用トリガーのみ削除
 */
function deleteSpecialEventsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;
  
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncSpecialEvents') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });
  
  Logger.log(`${deletedCount}件のトリガー（syncSpecialEvents）を削除しました`);
}

// ========== テスト関数 ==========

/**
 * 特定イベント同期のテスト実行
 */
function testSpecialEventsSync() {
  Logger.log('========== 特定イベント同期テスト ==========');
  syncSpecialEvents();
}

/**
 * 対象アカウント取得のテスト
 */
function testGetTargetEmails() {
  const ss = SpreadsheetApp.openById(SPECIAL_SPREADSHEET_ID);
  const emails = getTargetEmails(ss);
  Logger.log(`対象アカウント数: ${emails.length}件`);
  Logger.log(`メールアドレス一覧:`);
  emails.forEach((email, index) => {
    Logger.log(`  [${index + 1}] ${email}`);
  });
}

/**
 * 取得期間のテスト
 */
function testDateRange() {
  const { startDate, endDate } = getDateRange();
  Logger.log(`取得期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
}
