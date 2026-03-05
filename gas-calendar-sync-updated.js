// Google Apps Script: カレンダーからレッスン情報を取得（差分更新版・削除検知強化）
// NotionからTutorメールアドレスを自動取得
// 削除されたイベントを確実に検知して削除

// ========== 設定 ==========

// スプレッドシート設定
const SPREADSHEET_ID = '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo'; // スプレッドシートのIDをここに入力
const SHEET_NAME = 'レッスン予約データ';
const DELETED_SHEET_NAME = '削除されたレッスンデータ'; // 削除されたデータを保存するシート

// Notion API設定
const NOTION_TUTOR_API_TOKEN = ''; // Tutor用Notionトークンをここに入力
const NOTION_TUTOR_DB_ID = '2f6c668b8d194ae3ba75f6acb5bb7ce2'; // TutorデータベースIDをここに入力

// 差分更新設定
const INCREMENTAL_DAYS_BACK = 30; // 過去何日分を更新対象にするか（デフォルト: 30日）
const INCREMENTAL_DAYS_FORWARD = 30; // 未来何日分を更新対象にするか（デフォルト: 30日）

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
  
  // メールアドレスを抽出（小文字に統一）
  const emails = allResults
    .map(page => {
      try {
        const emailProp = page.properties['メールアドレス'];
        const email = emailProp?.email || null;
        // メールアドレスを小文字に変換（Googleカレンダーとの一致精度向上）
        return email ? email.toLowerCase() : null;
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

// ========== 差分更新メイン処理 ==========

/**
 * 差分更新メイン関数（削除検知強化版）
 */
function syncLessonsIncremental() {
  Logger.log('========== レッスン差分同期開始（削除検知強化版） ==========');
  const startTime = new Date();
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  
  if (notionEmails.length === 0) {
    Logger.log('エラー: Tutorメールアドレスが取得できませんでした');
    return;
  }
  
  Logger.log(`Notionから${notionEmails.length}件のTutorメールアドレスを取得`);
  
  // アクセス可能なカレンダーのリストを取得（小文字に統一）
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(
    accessibleCalendars.map(cal => cal.getId().toLowerCase())
  );
  
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
  
  // 既存データを読み込み（イベントIDをキーにしたマップ）
  const existingData = loadExistingData(sheet);
  Logger.log(`既存データ: ${existingData.size}件`);
  
  // 差分更新期間の設定
  const today = new Date();
  today.setHours(0, 0, 0, 0);  // 今日の0時0分0秒にセット

  const startDate = new Date(today.getTime() - INCREMENTAL_DAYS_BACK * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + (INCREMENTAL_DAYS_FORWARD + 1) * 24 * 60 * 60 * 1000);
  
  Logger.log(`更新対象期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let totalEvents = 0;
  let newEvents = 0;
  let updatedEvents = 0;
  let deletedEvents = 0;
  let successCalendars = 0;
  let failedCalendars = 0;
  
  // カレンダーから取得したイベントIDのセット（削除検知用）
  const fetchedEventIds = new Set();
  
  // 新規・更新イベントの一時保存
  const rowsToUpdate = [];
  const rowsToAdd = [];
  
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
        
        fetchedEventIds.add(eventId);
        
        // 学籍番号を抽出
        const studentId = extractStudentId(description);
        
        if (!studentId) {
          return; // 学籍番号がないイベントはスキップ
        }
        
        // Tutor名を抽出
        const tutorName = extractTutorName(title);
        
        // Meetリンクを抽出
        const meetLink = extractMeetLink(description);
        
        const rowData = [
          eventId,
          studentId,
          tutorName || '',
          email,
          startTime,
          title,
          description || '',
          meetLink || '',
          new Date()
        ];
        
        // 既存データと比較
        if (existingData.has(eventId)) {
          // 更新チェック（日時・タイトル・説明を比較）
          const existing = existingData.get(eventId);
          if (needsUpdate(existing, rowData)) {
            rowsToUpdate.push({
              rowNumber: existing.rowNumber,
              data: rowData
            });
            updatedEvents++;
          }
        } else {
          // 新規イベント
          rowsToAdd.push(rowData);
          newEvents++;
        }
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
  
  // 削除されたイベントを検出（改善版）
  // 更新対象期間内のイベントで、カレンダーから取得できなかったものを削除
  const rowsToDelete = [];
  const deletedEventsData = []; // 削除されたイベントのデータを保存
  
  existingData.forEach((value, eventId) => {
    const eventDate = new Date(value.data[4]); // レッスン日時
    
    // 更新対象期間内のイベントのみチェック
    if (eventDate >= startDate && eventDate <= endDate) {
      // カレンダーから取得できなかった = 削除された
      if (!fetchedEventIds.has(eventId)) {
        rowsToDelete.push(value.rowNumber);
        deletedEvents++;
        
        // 削除されたイベントのデータを保存（削除日時を追加）
        const deletedData = [...value.data]; // 既存データをコピー
        deletedData.push(new Date()); // 削除検知日時を追加
        deletedEventsData.push(deletedData);
        
        // 削除ログ（最初の10件のみ）
        if (deletedEvents <= 10) {
          Logger.log(`削除検知: ${value.data[1]} - ${value.data[2]} - ${formatDate(eventDate)}`);
        }
      }
    }
  });
  
  if (deletedEvents > 10) {
    Logger.log(`...他 ${deletedEvents - 10}件の削除イベント`);
  }
  
  Logger.log(`差分検出: 新規${newEvents}件、更新${updatedEvents}件、削除${deletedEvents}件`);
  
  // 削除されたイベントを別シートに保存
  if (deletedEventsData.length > 0) {
    saveDeletedEvents(ss, deletedEventsData);
  }
  
  // バッチ更新実行
  applyBatchUpdates(sheet, rowsToUpdate, rowsToAdd, rowsToDelete);
  
  // 日付でソート（昇順）
  if (sheet.getLastRow() > 1) {
    sheet.sort(5); // 5列目（レッスン日時）でソート
  }
  
  // 実行時間を計算
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  
  Logger.log('========== 差分同期完了 ==========');
  Logger.log(`実行時間: ${executionTime}秒`);
  Logger.log(`Notion Tutor総数: ${notionEmails.length}件`);
  Logger.log(`アクセス可能カレンダー: ${TUTOR_EMAILS.length}件`);
  Logger.log(`成功: ${successCalendars}件、失敗: ${failedCalendars}件`);
  Logger.log(`更新対象イベント: ${totalEvents}件`);
  Logger.log(`新規: ${newEvents}件、更新: ${updatedEvents}件、削除: ${deletedEvents}件`);
  
  // メタ情報を記録
  updateMetaSheet(ss, totalEvents, newEvents + updatedEvents + deletedEvents, successCalendars, failedCalendars, executionTime, notionEmails.length, TUTOR_EMAILS.length, newEvents, updatedEvents, deletedEvents);
}

/**
 * 削除されたイベントを別シートに保存
 */
function saveDeletedEvents(ss, deletedEventsData) {
  Logger.log(`削除されたイベントを別シートに保存中: ${deletedEventsData.length}件`);
  
  let deletedSheet = ss.getSheetByName(DELETED_SHEET_NAME);
  
  // シートが存在しない場合は作成
  if (!deletedSheet) {
    deletedSheet = ss.insertSheet(DELETED_SHEET_NAME);
    Logger.log(`シート「${DELETED_SHEET_NAME}」を作成しました`);
    
    // ヘッダー行を設定
    deletedSheet.appendRow([
      'イベントID',
      '学籍番号',
      'Tutor名',
      'Tutorメールアドレス',
      'レッスン日時',
      'タイトル',
      '説明',
      'Meetリンク',
      '最終更新日時',
      '削除検知日時'
    ]);
    
    // ヘッダー行を太字に
    deletedSheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }
  
  // 削除されたイベントを追記（末尾に追加）
  const lastRow = deletedSheet.getLastRow();
  deletedSheet.getRange(lastRow + 1, 1, deletedEventsData.length, 10).setValues(deletedEventsData);
  
  Logger.log(`✅ 削除されたイベントを保存完了: ${deletedEventsData.length}件`);
}

// ========== ヘルパー関数 ==========

/**
 * 既存データを読み込み（イベントIDをキーにしたマップ）
 */
function loadExistingData(sheet) {
  const data = sheet.getDataRange().getValues();
  const map = new Map();
  
  // ヘッダー行をスキップ（インデックス0）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const eventId = row[0]; // イベントID
    
    if (eventId) {
      map.set(eventId, {
        rowNumber: i + 1, // スプレッドシートの行番号（1始まり）
        data: row
      });
    }
  }
  
  return map;
}

/**
 * 更新が必要かチェック
 */
function needsUpdate(existing, newData) {
  // 日時、タイトル、説明を比較
  const existingDate = new Date(existing.data[4]).getTime();
  const newDate = new Date(newData[4]).getTime();
  
  if (existingDate !== newDate) return true;
  if (existing.data[5] !== newData[5]) return true; // タイトル
  if (existing.data[6] !== newData[6]) return true; // 説明
  
  return false;
}

/**
 * バッチ更新を実行（削除処理改善版）
 */
function applyBatchUpdates(sheet, rowsToUpdate, rowsToAdd, rowsToDelete) {
  const startTime = new Date();
  
  // 1. 削除（先に削除してから追加・更新）
  if (rowsToDelete.length > 0) {
    Logger.log(`削除処理: ${rowsToDelete.length}件の削除を実行中...`);
    
    // 降順ソート（後ろから削除しないと行番号がズレる）
    rowsToDelete.sort((a, b) => b - a);
    
    // バッチ削除（100件ずつ処理）
    const batchSize = 100;
    for (let i = 0; i < rowsToDelete.length; i += batchSize) {
      const batch = rowsToDelete.slice(i, i + batchSize);
      batch.forEach(rowNumber => {
        sheet.deleteRow(rowNumber);
      });
      
      if (i + batchSize < rowsToDelete.length) {
        Logger.log(`削除進捗: ${i + batch.length}/${rowsToDelete.length}件完了`);
      }
    }
    
    Logger.log(`✅ 削除完了: ${rowsToDelete.length}件`);
  }
  
  // 2. 更新（既存行を上書き）
  if (rowsToUpdate.length > 0) {
    Logger.log(`更新処理: ${rowsToUpdate.length}件のバッチ更新を実行中...`);
    
    // バッチ処理で一度に更新
    rowsToUpdate.forEach(item => {
      sheet.getRange(item.rowNumber, 1, 1, 9).setValues([item.data]);
    });
    
    Logger.log(`✅ 更新完了: ${rowsToUpdate.length}件`);
  }
  
  // 3. 追加（末尾に追加）
  if (rowsToAdd.length > 0) {
    Logger.log(`追加処理: ${rowsToAdd.length}件のバッチ追加を実行中...`);
    
    // 一度に全行追加
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rowsToAdd.length, 9).setValues(rowsToAdd);
    
    Logger.log(`✅ 追加完了: ${rowsToAdd.length}件`);
  }
  
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  Logger.log(`バッチ更新完了: ${executionTime}秒`);
}

// ========== メタ情報記録 ==========

/**
 * 同期メタ情報を記録
 */
function updateMetaSheet(ss, totalEvents, validEvents, successCalendars, failedCalendars, executionTime, notionTutorCount, accessibleTutorCount, newEvents, updatedEvents, deletedEvents) {
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
  metaSheet.appendRow(['同期方式', '差分更新（削除検知強化版）']);
  metaSheet.appendRow(['更新対象期間', `過去${INCREMENTAL_DAYS_BACK}日～未来${INCREMENTAL_DAYS_FORWARD}日`]);
  metaSheet.appendRow(['Notion Tutor総数', notionTutorCount]);
  metaSheet.appendRow(['アクセス可能カレンダー数', accessibleTutorCount]);
  metaSheet.appendRow(['更新対象イベント数', totalEvents]);
  metaSheet.appendRow(['新規追加', newEvents]);
  metaSheet.appendRow(['更新', updatedEvents]);
  metaSheet.appendRow(['削除', deletedEvents]);
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
 * 定期実行トリガーを設定（30分ごと - 差分更新用）
 */
function setupIncrementalTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncLessonsIncremental') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 30分ごとに実行
  ScriptApp.newTrigger('syncLessonsIncremental')
    .timeBased()
    .everyMinutes(30)
    .create();
  
  Logger.log('トリガーを設定しました: 30分ごとに syncLessonsIncremental を実行');
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
 * 差分更新のテスト実行
 */
function testIncrementalSync() {
  Logger.log('========== 差分更新テスト ==========');
  syncLessonsIncremental();
}

/**
 * 削除検知のテスト（デバッグ用）
 */
function testDeletionDetection() {
  Logger.log('========== 削除検知テスト ==========');
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    Logger.log('エラー: シートが見つかりません');
    return;
  }
  
  const existingData = loadExistingData(sheet);
  Logger.log(`既存データ: ${existingData.size}件`);
  
  // 更新対象期間を設定
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today.getTime() - INCREMENTAL_DAYS_BACK * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + (INCREMENTAL_DAYS_FORWARD + 1) * 24 * 60 * 60 * 1000);
  
  Logger.log(`更新対象期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let inRangeCount = 0;
  let outOfRangeCount = 0;
  
  existingData.forEach((value, eventId) => {
    const eventDate = new Date(value.data[4]);
    if (eventDate >= startDate && eventDate <= endDate) {
      inRangeCount++;
    } else {
      outOfRangeCount++;
    }
  });
  
  Logger.log(`期間内イベント: ${inRangeCount}件`);
  Logger.log(`期間外イベント: ${outOfRangeCount}件（削除検知対象外）`);
}
