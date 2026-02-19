// Google Apps Script: カレンダーからレッスン情報を取得してスプレッドシートに保存
// NotionからTutorメールアドレスを自動取得

// ========== 設定 ==========

// スプレッドシート設定
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // スプレッドシートのIDをここに入力
const SHEET_NAME = 'レッスン予約データ';

// Notion API設定
const NOTION_TUTOR_API_TOKEN = 'YOUR_TUTOR_NOTION_API_TOKEN'; // Tutor用Notionトークンをここに入力
const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID'; // TutorデータベースIDをここに入力

// ========== Notion API関連 ==========

/**
 * NotionからTutorメールアドレスを取得（ページネーション対応）
 */
function getTutorEmailsFromNotion() {
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
  
  // ページネーションで全データを取得
  while (hasMore) {
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
      
      Logger.log(`Notion取得中: ${allResults.length}件のTutorデータ取得済み`);
      
      // APIレート制限対策（3リクエストごとに1秒待機）
      if (hasMore && allResults.length % 300 === 0) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`Notion API エラー: ${error.message}`);
      break;
    }
  }
  
  // メールアドレスを抽出
  const emails = allResults
    .map(page => {
      try {
        const emailProp = page.properties['メールアドレス'];
        return emailProp?.email || null;
      } catch (error) {
        Logger.log(`プロパティ取得エラー: ${error.message}`);
        return null;
      }
    })
    .filter(email => email); // nullを除外
  
  Logger.log(`Notionから${emails.length}件のTutorメールアドレスを取得しました`);
  Logger.log(`メールアドレス一覧: ${emails.slice(0, 5).join(', ')}...`);
  
  return emails;
}

// ========== カレンダー同期メイン処理 ==========

/**
 * メイン関数：全カレンダーからレッスン情報を取得
 */
function syncLessonsToSheet() {
  Logger.log('========== レッスン同期開始 ==========');
  const startTime = new Date();
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  
  if (notionEmails.length === 0) {
    Logger.log('エラー: Tutorメールアドレスが取得できませんでした');
    return;
  }
  
  Logger.log(`Notionから${notionEmails.length}件のTutorメールアドレスを取得`);
  
  // アクセス可能なカレンダーのリストを取得
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(accessibleCalendars.map(cal => cal.getId()));
  
  Logger.log(`アクセス可能なカレンダー: ${accessibleEmailsSet.size}件`);
  
  // Notionのメールアドレスとアクセス可能なカレンダーの交差
  const TUTOR_EMAILS = notionEmails.filter(email => accessibleEmailsSet.has(email));
  
  Logger.log(`アクセス可能なTutorカレンダー: ${TUTOR_EMAILS.length}件（Notion: ${notionEmails.length}件中）`);
  
  if (TUTOR_EMAILS.length === 0) {
    Logger.log('⚠️ 警告: アクセス可能なTutorカレンダーがありません');
    return;
  }
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log(`シート「${SHEET_NAME}」を作成しました`);
  }
  
  // ヘッダー行を設定（初回のみ）
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'イベントID',
      '学籍番号',
      'Tutor名',
      'Tutorメールアドレス',
      'レッスン日時',
      'タイトル',
      '説明',
      'Meetリンク',
      '最終更新日時'
    ]);
    
    // ヘッダー行を太字に
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  
  // 既存データをクリア（ヘッダー以外）
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    Logger.log('既存データをクリアしました');
  }
  
  // 取得期間の設定（先月1日〜来月末）
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59);
  
  Logger.log(`取得期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let totalEvents = 0;
  let eventsWithStudentId = 0;
  let successCalendars = 0;
  let failedCalendars = 0;
  
  // 各Tutorのカレンダーから取得
  TUTOR_EMAILS.forEach((email, index) => {
    try {
      const calendar = CalendarApp.getCalendarById(email);
      
      if (!calendar) {
        Logger.log(`[${index + 1}/${TUTOR_EMAILS.length}] ⚠️ カレンダーが見つかりません: ${email}`);
        failedCalendars++;
        return;
      }
      
      const events = calendar.getEvents(startDate, endDate);
      totalEvents += events.length;
      
      if ((index + 1) % 5 === 0 || index === 0 || index === TUTOR_EMAILS.length - 1) {
        Logger.log(`[${index + 1}/${TUTOR_EMAILS.length}] ${email}: ${events.length}件のイベントを取得`);
      }
      
      events.forEach(event => {
        const title = event.getTitle();
        const description = event.getDescription();
        const startTime = event.getStartTime();
        const eventId = event.getId();
        
        // 学籍番号を抽出
        const studentId = extractStudentId(description);
        
        if (!studentId) {
          return; // 学籍番号がないイベントはスキップ
        }
        
        eventsWithStudentId++;
        
        // Tutor名を抽出
        const tutorName = extractTutorName(title);
        
        // Meetリンクを抽出
        const meetLink = extractMeetLink(description);
        
        // スプレッドシートに追加
        sheet.appendRow([
          eventId,
          studentId,
          tutorName || '',
          email,
          startTime,
          title,
          description || '',
          meetLink || '',
          new Date()
        ]);
      });
      
      successCalendars++;
      
      // 進捗表示（10件ごと）
      if ((index + 1) % 10 === 0) {
        Logger.log(`進捗: ${index + 1}/${TUTOR_EMAILS.length}件処理完了`);
      }
      
      // APIレート制限対策（10カレンダーごとに1秒待機）
      if ((index + 1) % 10 === 0 && index + 1 < TUTOR_EMAILS.length) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`エラー [${email}]: ${error.message}`);
      failedCalendars++;
    }
  });
  
  // 日付でソート（昇順）
  if (sheet.getLastRow() > 1) {
    sheet.sort(5); // 5列目（レッスン日時）でソート
  }
  
  // 実行時間を計算
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  
  Logger.log('========== 同期完了 ==========');
  Logger.log(`実行時間: ${executionTime}秒`);
  Logger.log(`Notion Tutor総数: ${notionEmails.length}件`);
  Logger.log(`アクセス可能カレンダー: ${TUTOR_EMAILS.length}件`);
  Logger.log(`成功: ${successCalendars}件、失敗: ${failedCalendars}件`);
  Logger.log(`総イベント数: ${totalEvents}件`);
  Logger.log(`学籍番号あり: ${eventsWithStudentId}件`);
  
  // メタ情報を記録
  updateMetaSheet(ss, totalEvents, eventsWithStudentId, successCalendars, failedCalendars, executionTime, notionEmails.length, TUTOR_EMAILS.length);
}

// ========== メタ情報記録 ==========

/**
 * 同期メタ情報を記録
 */
function updateMetaSheet(ss, totalEvents, validEvents, successCalendars, failedCalendars, executionTime, notionTutorCount, accessibleTutorCount) {
  const metaSheetName = '同期メタ情報';
  let metaSheet = ss.getSheetByName(metaSheetName);
  
  if (!metaSheet) {
    metaSheet = ss.insertSheet(metaSheetName);
  }
  
  metaSheet.clear();
  
  // ヘッダー
  metaSheet.appendRow(['項目', '値']);
  metaSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  
  // データ
  metaSheet.appendRow(['最終同期日時', new Date()]);
  metaSheet.appendRow(['Notion Tutor総数', notionTutorCount]);
  metaSheet.appendRow(['アクセス可能カレンダー数', accessibleTutorCount]);
  metaSheet.appendRow(['総イベント数', totalEvents]);
  metaSheet.appendRow(['学籍番号あり', validEvents]);
  metaSheet.appendRow(['成功カレンダー数', successCalendars]);
  metaSheet.appendRow(['失敗カレンダー数', failedCalendars]);
  metaSheet.appendRow(['実行時間（秒）', executionTime]);
  
  // 列幅を調整
  metaSheet.autoResizeColumns(1, 2);
}

// ========== 抽出ヘルパー関数 ==========

/**
 * 学籍番号を抽出
 */
function extractStudentId(description) {
  if (!description) return null;
  
  // パターン1: 学籍番号：OLTS240488-AR
  let match = description.match(/学籍番号[：:\s]*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  // パターン2: OLTS形式の直接マッチ
  match = description.match(/OLTS\d{6}-[A-Z]{2}/i);
  if (match) return match[0];
  
  // パターン3: 複数行パターン
  match = description.match(/予約者[：:\s]*.*\n.*\n.*学籍番号[：:\s]*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  return null;
}

/**
 * Tutor名を抽出
 */
function extractTutorName(title) {
  if (!title) return null;
  const match = title.match(/WannaVレッスン予約\s*[（(]([^)）]+)[)）]/);
  return match ? match[1] : null;
}

/**
 * Meetリンクを抽出
 */
function extractMeetLink(description) {
  if (!description) return null;
  const match = description.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
  return match ? match[0] : null;
}

// ========== ユーティリティ関数 ==========

/**
 * 日付をフォーマット
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

// ========== トリガー設定 ==========

/**
 * 定期実行トリガーを設定（1時間ごと）
 */
function setupHourlyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncLessonsToSheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 1時間ごとに実行
  ScriptApp.newTrigger('syncLessonsToSheet')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log('トリガーを設定しました: 1時間ごとに syncLessonsToSheet を実行');
}

/**
 * 定期実行トリガーを設定（30分ごと - より頻繁な更新が必要な場合）
 */
function setupFrequentTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncLessonsToSheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 30分ごとに実行
  ScriptApp.newTrigger('syncLessonsToSheet')
    .timeBased()
    .everyMinutes(30)
    .create();
  
  Logger.log('トリガーを設定しました: 30分ごとに syncLessonsToSheet を実行');
}

/**
 * 全トリガーを削除
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  Logger.log(`${triggers.length}件のトリガーを削除しました`);
}

/**
 * 現在のトリガー一覧を表示
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`現在のトリガー数: ${triggers.length}件`);
  
  triggers.forEach((trigger, index) => {
    Logger.log(`[${index + 1}] 関数: ${trigger.getHandlerFunction()}`);
    Logger.log(`    種類: ${trigger.getEventType()}`);
    Logger.log(`    トリガーID: ${trigger.getUniqueId()}`);
  });
}

// ========== テスト関数 ==========

/**
 * Notion API接続テスト
 */
function testNotionConnection() {
  Logger.log('========== Notion接続テスト ==========');
  
  try {
    const emails = getTutorEmailsFromNotion();
    Logger.log(`✅ 成功: ${emails.length}件のメールアドレスを取得`);
    Logger.log(`最初の5件: ${emails.slice(0, 5).join(', ')}`);
    return true;
  } catch (error) {
    Logger.log(`❌ 失敗: ${error.message}`);
    return false;
  }
}

/**
 * カレンダーアクセステスト（最初の3件のみ）
 */
function testCalendarAccess() {
  Logger.log('========== カレンダーアクセステスト ==========');
  
  const emails = getTutorEmailsFromNotion();
  const testEmails = emails.slice(0, 3); // 最初の3件のみテスト
  
  testEmails.forEach((email, index) => {
    try {
      const calendar = CalendarApp.getCalendarById(email);
      
      if (!calendar) {
        Logger.log(`[${index + 1}] ❌ カレンダーが見つかりません: ${email}`);
        return;
      }
      
      const today = new Date();
      const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const events = calendar.getEvents(today, endDate);
      
      Logger.log(`[${index + 1}] ✅ ${email}: ${events.length}件のイベント`);
      
      // 最初のイベントの詳細を表示
      if (events.length > 0) {
        const event = events[0];
        Logger.log(`    サンプルイベント: ${event.getTitle()}`);
        Logger.log(`    説明: ${(event.getDescription() || '').substring(0, 100)}...`);
      }
      
    } catch (error) {
      Logger.log(`[${index + 1}] ❌ エラー [${email}]: ${error.message}`);
    }
  });
}

/**
 * スプレッドシート書き込みテスト
 */
function testSheetWrite() {
  Logger.log('========== スプレッドシート書き込みテスト ==========');
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const testSheetName = 'テスト';
    let testSheet = ss.getSheetByName(testSheetName);
    
    if (!testSheet) {
      testSheet = ss.insertSheet(testSheetName);
    }
    
    testSheet.clear();
    testSheet.appendRow(['テスト日時', new Date()]);
    testSheet.appendRow(['ステータス', '書き込み成功']);
    
    Logger.log('✅ スプレッドシートへの書き込み成功');
    Logger.log(`スプレッドシートURL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
    
    return true;
  } catch (error) {
    Logger.log(`❌ 失敗: ${error.message}`);
    return false;
  }
}

/**
 * 全テストを実行
 */
function runAllTests() {
  Logger.log('========================================');
  Logger.log('全テストを実行します');
  Logger.log('========================================');
  
  const test1 = testSheetWrite();
  Utilities.sleep(1000);
  
  const test2 = testNotionConnection();
  Utilities.sleep(1000);
  
  const test3 = testCalendarAccess();
  
  Logger.log('========================================');
  Logger.log('テスト結果サマリー');
  Logger.log('========================================');
  Logger.log(`スプレッドシート書き込み: ${test1 ? '✅' : '❌'}`);
  Logger.log(`Notion接続: ${test2 ? '✅' : '❌'}`);
  Logger.log(`カレンダーアクセス: ${test3 ? '✅' : '❌'}`);
  
  if (test1 && test2 && test3) {
    Logger.log('');
    Logger.log('✅ 全てのテストが成功しました！');
    Logger.log('次のステップ: setupHourlyTrigger() を実行してトリガーを設定してください');
  } else {
    Logger.log('');
    Logger.log('❌ いくつかのテストが失敗しました。設定を確認してください。');
  }
}
