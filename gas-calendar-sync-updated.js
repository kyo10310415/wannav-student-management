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
        
        // Meetリンクを抽出（getHangoutLink()を優先、なければ説明文から）
        const meetLink = extractMeetLink(event, description);
        
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
  
  // ========================================
  // 削除機能を一時的に無効化（デバッグ中）
  // ========================================
  /*
  // 削除されたイベントを検出（改善版）
  // 1. 取得範囲内でカレンダーから消えたイベント（キャンセル/リスケ）
  // 2. 取得範囲外のイベント（古すぎる/遠すぎる未来）
  const now = new Date();
  const rowsToDelete = [];
  const deletedEventsData = []; // 削除されたイベントのデータを保存
  let outOfRangeCount = 0; // 範囲外削除のカウント
  
  existingData.forEach((value, eventId) => {
    const eventDate = new Date(value.data[4]); // レッスン日時
    
    // ケース1: 取得範囲外のイベント（古すぎる過去 or 遠すぎる未来）
    if (eventDate < startDate || eventDate > endDate) {
      rowsToDelete.push(value.rowNumber);
      deletedEvents++;
      outOfRangeCount++;
      
      // 削除されたイベントのデータを保存（削除日時と削除理由を追加）
      const deletedData = [...value.data]; // 既存データをコピー
      deletedData.push(new Date()); // 削除検知日時を追加
      deletedData.push('取得範囲外'); // 削除理由を追加
      deletedEventsData.push(deletedData);
      
      // 削除ログ（最初の5件のみ）
      if (outOfRangeCount <= 5) {
        Logger.log(`削除検知（範囲外）: ${value.data[1]} - ${value.data[2]} - ${formatDate(eventDate)}`);
      }
    }
    // ケース2: 取得範囲内だがカレンダーから取得できなかった（削除/キャンセル）
    else if (eventDate >= startDate && eventDate <= endDate) {
      if (!fetchedEventIds.has(eventId)) {
        rowsToDelete.push(value.rowNumber);
        deletedEvents++;
        
        // 削除されたイベントのデータを保存（削除日時と削除理由を追加）
        const deletedData = [...value.data]; // 既存データをコピー
        deletedData.push(new Date()); // 削除検知日時を追加
        deletedData.push('カレンダーから削除'); // 削除理由を追加
        deletedEventsData.push(deletedData);
        
        // 削除ログ（最初の10件のみ）
        if (deletedEvents - outOfRangeCount <= 10) {
          Logger.log(`削除検知（キャンセル）: ${value.data[1]} - ${value.data[2]} - ${formatDate(eventDate)}`);
        }
      }
    }
  });
  */
  
  // 削除機能を無効化（一時的）
  const rowsToDelete = [];
  const deletedEventsData = [];
  let outOfRangeCount = 0;
  
  if (deletedEvents > 15) {
    Logger.log(`...他 ${deletedEvents - 15}件の削除イベント`);
  }
  
  Logger.log(`差分検出: 新規${newEvents}件、更新${updatedEvents}件、削除${deletedEvents}件（範囲外: ${outOfRangeCount}件、キャンセル: ${deletedEvents - outOfRangeCount}件）`);
  
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
  updateMetaSheet(ss, totalEvents, newEvents + updatedEvents + deletedEvents, successCalendars, failedCalendars, executionTime, notionEmails.length, TUTOR_EMAILS.length, newEvents, updatedEvents, deletedEvents, outOfRangeCount);
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
      '削除検知日時',
      '削除理由'
    ]);
    
    // ヘッダー行を太字に
    deletedSheet.getRange(1, 1, 1, 11).setFontWeight('bold');
  }
  
  // 削除されたイベントを追記（末尾に追加）
  const lastRow = deletedSheet.getLastRow();
  deletedSheet.getRange(lastRow + 1, 1, deletedEventsData.length, 11).setValues(deletedEventsData);
  
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
function updateMetaSheet(ss, totalEvents, validEvents, successCalendars, failedCalendars, executionTime, notionTutorCount, accessibleTutorCount, newEvents, updatedEvents, deletedEvents, outOfRangeCount = 0) {
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
  metaSheet.appendRow(['同期方式', '差分更新（範囲外削除対応版）']);
  metaSheet.appendRow(['更新対象期間', `過去${INCREMENTAL_DAYS_BACK}日～未来${INCREMENTAL_DAYS_FORWARD}日`]);
  metaSheet.appendRow(['Notion Tutor総数', notionTutorCount]);
  metaSheet.appendRow(['アクセス可能カレンダー数', accessibleTutorCount]);
  metaSheet.appendRow(['更新対象イベント数', totalEvents]);
  metaSheet.appendRow(['新規追加', newEvents]);
  metaSheet.appendRow(['更新', updatedEvents]);
  metaSheet.appendRow(['削除合計', deletedEvents]);
  metaSheet.appendRow(['　├ 範囲外削除', outOfRangeCount]);
  metaSheet.appendRow(['　└ キャンセル削除', deletedEvents - outOfRangeCount]);
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
  
  // 文字列に変換（オブジェクトや配列の場合に対応）
  const descStr = String(description);
  
  // HTMLタグを削除してから抽出（<b>, </b>, <br>など）
  const cleanDescription = descStr.replace(/<[^>]*>/g, '');
  
  // パターン1: 学籍番号：OLTS240488-AR または 学籍番号: OLTS240488-AR
  let match = cleanDescription.match(/学籍番号[：:\s]*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  // パターン2: 改行を挟むパターン（学籍番号\nOLTS240488-AR）
  match = cleanDescription.match(/学籍番号[：:\s]*[\r\n]+\s*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  // パターン3: OLTS形式の直接マッチ
  match = cleanDescription.match(/OL[A-Z]{2}\d{6}-[A-Z]{2}/i);
  if (match) return match[0];
  
  // パターン4: 複数行パターン
  match = cleanDescription.match(/予約者[：:\s]*.*\n.*\n.*学籍番号[：:\s]*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  return null;
}

/**
 * Tutor名を抽出
 */
function extractTutorName(title) {
  if (!title) return null;
  
  // 文字列に変換（オブジェクトや配列の場合に対応）
  const titleStr = String(title);
  
  const match = titleStr.match(/WannaVレッスン予約\s*[（(]([^)）]+)[)）]/);
  return match ? match[1] : null;
}

/**
 * Meetリンクを抽出（改善版）
 * @param {CalendarEvent} event - カレンダーイベントオブジェクト
 * @param {string} description - イベントの説明文
 * @returns {string|null} - MeetリンクURL
 */
function extractMeetLink(event, description) {
  // 方法1: getHangoutLink()を使用（最も確実）
  try {
    const hangoutLink = event.getHangoutLink();
    if (hangoutLink) {
      return hangoutLink;
    }
  } catch (error) {
    // getHangoutLink()が失敗した場合は次の方法へ
  }
  
  // 方法2: 説明文から正規表現で抽出
  if (!description) return null;
  
  // 文字列に変換（オブジェクトや配列の場合に対応）
  const descStr = String(description);
  
  // パターン1: https://meet.google.com/xxx-xxxx-xxx
  let match = descStr.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
  if (match) return match[0];
  
  // パターン2: meet.google.com/xxx-xxxx-xxx (httpsなし)
  match = descStr.match(/meet\.google\.com\/[a-z-]+/i);
  if (match) return 'https://' + match[0];
  
  return null;
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

/**
 * イベント取得デバッグ（学籍番号抽出の検証）
 */
function debugEventExtraction() {
  Logger.log('========== イベント取得デバッグ ==========');
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  
  if (notionEmails.length === 0) {
    Logger.log('エラー: Tutorメールアドレスが取得できませんでした');
    return;
  }
  
  // アクセス可能なカレンダーのリストを取得
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(
    accessibleCalendars.map(cal => cal.getId().toLowerCase())
  );
  
  const TUTOR_EMAILS = notionEmails.filter(email => accessibleEmailsSet.has(email));
  
  if (TUTOR_EMAILS.length === 0) {
    Logger.log('⚠️ 警告: アクセス可能なTutorカレンダーがありません');
    return;
  }
  
  // 最初のTutorカレンダーから直近のイベントを5件取得してテスト
  const testEmail = TUTOR_EMAILS[0];
  Logger.log(`テスト対象カレンダー: ${testEmail}`);
  
  const calendar = CalendarApp.getCalendarById(testEmail);
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const events = calendar.getEvents(today, nextWeek);
  Logger.log(`取得イベント数: ${events.length}件`);
  
  // 最初の5件を詳細表示
  events.slice(0, 5).forEach((event, index) => {
    const title = event.getTitle();
    const description = event.getDescription();
    const startTime = event.getStartTime();
    const eventId = event.getId();
    
    Logger.log(`\n--- イベント ${index + 1} ---`);
    Logger.log(`イベントID: ${eventId}`);
    Logger.log(`タイトル: ${title}`);
    Logger.log(`日時: ${formatDate(startTime)}`);
    Logger.log(`説明（最初の200文字）: ${description ? description.substring(0, 200) : '(なし)'}`);
    
    // 学籍番号抽出テスト
    const studentId = extractStudentId(description);
    Logger.log(`抽出された学籍番号: ${studentId || '❌ 抽出失敗'}`);
    
    // Tutor名抽出テスト
    const tutorName = extractTutorName(title);
    Logger.log(`抽出されたTutor名: ${tutorName || '❌ 抽出失敗'}`);
    
    // Meetリンク抽出テスト
    const meetLink = extractMeetLink(event, description);
    Logger.log(`抽出されたMeetリンク: ${meetLink || '(なし)'}`);
  });
  
  // 学籍番号抽出の統計
  let successCount = 0;
  let failCount = 0;
  
  events.forEach(event => {
    const description = event.getDescription();
    const studentId = extractStudentId(description);
    
    if (studentId) {
      successCount++;
    } else {
      failCount++;
    }
  });
  
  Logger.log(`\n========== 学籍番号抽出統計 ==========`);
  Logger.log(`成功: ${successCount}件`);
  Logger.log(`失敗: ${failCount}件`);
  Logger.log(`成功率: ${Math.round((successCount / events.length) * 100)}%`);
}

/**
 * 特定のスケジュールをデバッグ（学籍番号またはTutor名で検索）
 * @param {string} searchKeyword - 学籍番号またはTutor名（部分一致）
 */
function debugSpecificSchedule(searchKeyword) {
  Logger.log(`========== 特定スケジュールデバッグ: "${searchKeyword}" ==========`);
  
  if (!searchKeyword) {
    Logger.log('エラー: 検索キーワードを指定してください');
    Logger.log('使用例: debugSpecificSchedule("OLTS240488-AR")');
    Logger.log('使用例: debugSpecificSchedule("山田")');
    return;
  }
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(
    accessibleCalendars.map(cal => cal.getId().toLowerCase())
  );
  const TUTOR_EMAILS = notionEmails.filter(email => accessibleEmailsSet.has(email));
  
  Logger.log(`検索対象カレンダー: ${TUTOR_EMAILS.length}件`);
  
  // 検索期間（過去30日～未来30日）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today.getTime() - INCREMENTAL_DAYS_BACK * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + (INCREMENTAL_DAYS_FORWARD + 1) * 24 * 60 * 60 * 1000);
  
  Logger.log(`検索期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let foundEvents = [];
  
  // 全Tutorカレンダーを検索
  TUTOR_EMAILS.forEach((email, index) => {
    try {
      const calendar = CalendarApp.getCalendarById(email);
      if (!calendar) return;
      
      const events = calendar.getEvents(startDate, endDate);
      
      events.forEach(event => {
        const title = event.getTitle();
        const description = event.getDescription() || '';
        const eventId = event.getId();
        
        // キーワードにマッチするか確認（タイトルまたは説明に含まれる）
        if (title.includes(searchKeyword) || description.includes(searchKeyword)) {
          foundEvents.push({
            calendar: email,
            event: event,
            eventId: eventId,
            title: title,
            description: description,
            startTime: event.getStartTime()
          });
        }
      });
      
    } catch (error) {
      Logger.log(`エラー [${email}]: ${error.message}`);
    }
  });
  
  Logger.log(`\n検索結果: ${foundEvents.length}件見つかりました`);
  
  if (foundEvents.length === 0) {
    Logger.log('❌ 該当するスケジュールが見つかりませんでした');
    Logger.log('確認事項:');
    Logger.log('1. カレンダーに実際にイベントが存在するか');
    Logger.log('2. 検索期間内のイベントか（過去30日～未来30日）');
    Logger.log('3. 検索キーワードが正確か');
    return;
  }
  
  // 見つかったイベントの詳細を表示
  foundEvents.forEach((item, index) => {
    Logger.log(`\n========== 該当イベント ${index + 1} ==========`);
    Logger.log(`カレンダー: ${item.calendar}`);
    Logger.log(`イベントID: ${item.eventId}`);
    Logger.log(`タイトル: ${item.title}`);
    Logger.log(`日時: ${formatDate(item.startTime)}`);
    Logger.log(`\n説明文（全文）:\n${item.description}`);
    Logger.log(`\n--- 抽出テスト ---`);
    
    // 学籍番号抽出
    const studentId = extractStudentId(item.description);
    if (studentId) {
      Logger.log(`✅ 学籍番号抽出成功: ${studentId}`);
    } else {
      Logger.log(`❌ 学籍番号抽出失敗`);
      Logger.log(`説明文から学籍番号を手動で確認してください`);
    }
    
    // Tutor名抽出
    const tutorName = extractTutorName(item.title);
    if (tutorName) {
      Logger.log(`✅ Tutor名抽出成功: ${tutorName}`);
    } else {
      Logger.log(`❌ Tutor名抽出失敗`);
    }
    
    // Meetリンク抽出
    const meetLink = extractMeetLink(item.event, item.description);
    Logger.log(`Meetリンク: ${meetLink || '(なし)'}`);
    
    // スプレッドシートに存在するか確認
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const existingData = loadExistingData(sheet);
    
    if (existingData.has(item.eventId)) {
      Logger.log(`\n📋 スプレッドシートの状態: ✅ 既に存在`);
      const existing = existingData.get(item.eventId);
      Logger.log(`行番号: ${existing.rowNumber}`);
      Logger.log(`保存されている学籍番号: ${existing.data[1]}`);
    } else {
      Logger.log(`\n📋 スプレッドシートの状態: ❌ 存在しない（次回同期で追加される）`);
      
      if (!studentId) {
        Logger.log(`\n⚠️ 問題: 学籍番号が抽出できないため、同期されません`);
        Logger.log(`解決策: 説明文に以下のいずれかの形式で学籍番号を記載してください`);
        Logger.log(`  - 学籍番号：OLTS240488-AR`);
        Logger.log(`  - 学籍番号: OLTS240488-AR`);
        Logger.log(`  - OLTS240488-AR（単独で記載）`);
      }
    }
  });
}

/**
 * イベントIDの比較デバッグ
 */
function debugEventIdComparison() {
  Logger.log('========== イベントID比較デバッグ ==========');
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    Logger.log('エラー: シートが見つかりません');
    return;
  }
  
  // 既存データのイベントIDを取得（最初の10件）
  const existingData = loadExistingData(sheet);
  const existingIds = Array.from(existingData.keys()).slice(0, 10);
  
  Logger.log(`既存イベントID（最初の10件）:`);
  existingIds.forEach((id, index) => {
    Logger.log(`[${index + 1}] ${id}`);
  });
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(
    accessibleCalendars.map(cal => cal.getId().toLowerCase())
  );
  const TUTOR_EMAILS = notionEmails.filter(email => accessibleEmailsSet.has(email));
  
  // 最初のTutorカレンダーからイベントを取得
  const testEmail = TUTOR_EMAILS[0];
  const calendar = CalendarApp.getCalendarById(testEmail);
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const events = calendar.getEvents(today, nextWeek);
  
  Logger.log(`\nカレンダーのイベントID（最初の10件）:`);
  events.slice(0, 10).forEach((event, index) => {
    const eventId = event.getId();
    const exists = existingData.has(eventId);
    Logger.log(`[${index + 1}] ${eventId} ${exists ? '✅ 既存' : '❌ 新規'}`);
  });
}

/**
 * 特定学籍番号のデバッグテスト（実行しやすいように）
 * 学籍番号を変更してから実行してください
 */
function testSpecificStudent() {
  // ここに調査したい学籍番号を入力
  const studentId = "OLTS251075-TY";
  
  Logger.log(`検索対象: ${studentId}`);
  debugSpecificSchedule(studentId);
}

/**
 * 特定Tutor名のデバッグテスト
 * Tutor名を変更してから実行してください
 */
function testSpecificTutor() {
  // ここに調査したいTutor名を入力（部分一致）
  const tutorName = "山田";
  
  Logger.log(`検索対象: ${tutorName}`);
  debugSpecificSchedule(tutorName);
}

/**
 * 削除原因を診断する関数
 */
function diagnoseDeletionIssue() {
  Logger.log('========== 削除原因診断 ==========');
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const deletedSheet = ss.getSheetByName(DELETED_SHEET_NAME);
  
  if (!deletedSheet) {
    Logger.log('❌ 削除されたレッスンデータシートが見つかりません');
    return;
  }
  
  // 削除されたデータを取得
  const deletedData = deletedSheet.getDataRange().getValues();
  Logger.log(`削除されたイベント総数: ${deletedData.length - 1}件（ヘッダー除く）`);
  
  if (deletedData.length < 2) {
    Logger.log('削除されたデータがありません');
    return;
  }
  
  // 削除理由の集計
  const reasonCount = {
    '取得範囲外': 0,
    'カレンダーから削除': 0,
    'その他': 0
  };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today.getTime() - INCREMENTAL_DAYS_BACK * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + (INCREMENTAL_DAYS_FORWARD + 1) * 24 * 60 * 60 * 1000);
  
  Logger.log(`現在の取得範囲: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  Logger.log('');
  
  // ヘッダー行をスキップ（インデックス0）
  for (let i = 1; i < Math.min(deletedData.length, 21); i++) {
    const row = deletedData[i];
    const studentId = row[1]; // 学籍番号
    const tutorName = row[2]; // Tutor名
    const eventDate = new Date(row[4]); // レッスン日時
    const deleteReason = row[10] || 'その他'; // 削除理由
    const deleteTime = row[9]; // 削除検知日時
    
    // 削除理由をカウント
    if (reasonCount.hasOwnProperty(deleteReason)) {
      reasonCount[deleteReason]++;
    } else {
      reasonCount['その他']++;
    }
    
    // 最初の20件を詳細表示
    if (i <= 20) {
      Logger.log(`[${i}] ${studentId} - ${tutorName}`);
      Logger.log(`    レッスン日時: ${formatDate(eventDate)}`);
      Logger.log(`    削除理由: ${deleteReason}`);
      Logger.log(`    削除検知: ${formatDate(new Date(deleteTime))}`);
      
      // 範囲内かチェック
      const isInRange = eventDate >= startDate && eventDate <= endDate;
      Logger.log(`    範囲判定: ${isInRange ? '✅ 範囲内' : '❌ 範囲外'}`);
      Logger.log('');
    }
  }
  
  if (deletedData.length > 21) {
    Logger.log(`...他 ${deletedData.length - 21}件の削除イベント`);
  }
  
  Logger.log('========== 削除理由の集計 ==========');
  Logger.log(`取得範囲外: ${reasonCount['取得範囲外']}件`);
  Logger.log(`カレンダーから削除: ${reasonCount['カレンダーから削除']}件`);
  Logger.log(`その他: ${reasonCount['その他']}件`);
  Logger.log(`合計: ${deletedData.length - 1}件`);
  Logger.log('');
  
  // カレンダーから削除された件数が多い場合の警告
  if (reasonCount['カレンダーから削除'] > 10) {
    Logger.log('⚠️ 警告: カレンダーから削除されたイベントが多すぎます');
    Logger.log('考えられる原因:');
    Logger.log('1. description.match エラーで学籍番号が抽出できなかった');
    Logger.log('2. イベントIDの形式が変わった');
    Logger.log('3. カレンダーのアクセス権限が変わった');
    Logger.log('');
    Logger.log('💡 解決方法: restoreDeletedEvents() を実行してデータを復元してください');
  }
}

/**
 * 削除されたイベントを復元する関数
 * 「カレンダーから削除」理由のみを復元（取得範囲外は復元しない）
 */
function restoreDeletedEvents() {
  Logger.log("========== 削除されたイベントの復元 ==========");
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const deletedSheet = ss.getSheetByName(DELETED_SHEET_NAME);
  
  if (!deletedSheet) {
    Logger.log("❌ 削除されたレッスンデータシートが見つかりません");
    return;
  }
  
  // 削除されたデータを取得
  const deletedData = deletedSheet.getDataRange().getValues();
  
  if (deletedData.length < 2) {
    Logger.log("復元するデータがありません");
    return;
  }
  
  // 復元対象: 「カレンダーから削除」理由のみ
  const rowsToRestore = [];
  
  for (let i = 1; i < deletedData.length; i++) {
    const row = deletedData[i];
    const deleteReason = row[10]; // 削除理由（K列）
    
    // 「カレンダーから削除」のみを復元（取得範囲外は復元しない）
    if (deleteReason === "カレンダーから削除") {
      // 元の9列のデータのみを復元（削除検知日時と削除理由を除外）
      const originalData = row.slice(0, 9);
      rowsToRestore.push(originalData);
    }
  }
  
  Logger.log(`復元対象: ${rowsToRestore.length}件（「カレンダーから削除」理由のみ）`);
  
  if (rowsToRestore.length === 0) {
    Logger.log("復元するデータがありません");
    return;
  }
  
  // 既存データのイベントIDを取得（重複チェック用）
  const existingData = loadExistingData(sheet);
  const existingEventIds = new Set(existingData.keys());
  
  // 重複を除いて復元
  const uniqueRowsToRestore = rowsToRestore.filter(row => {
    const eventId = row[0];
    return !existingEventIds.has(eventId);
  });
  
  Logger.log(`重複を除外: ${uniqueRowsToRestore.length}件を復元`);
  
  if (uniqueRowsToRestore.length === 0) {
    Logger.log("復元するデータがありません（全て既に存在）");
    return;
  }
  
  // レッスン予約データシートに復元
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, uniqueRowsToRestore.length, 9).setValues(uniqueRowsToRestore);
  
  // 日付でソート（昇順）
  if (sheet.getLastRow() > 1) {
    sheet.sort(5); // 5列目（レッスン日時）でソート
  }
  
  Logger.log(`✅ 復元完了: ${uniqueRowsToRestore.length}件`);
  Logger.log("");
  Logger.log("次のステップ:");
  Logger.log("1. スプレッドシート「レッスン予約データ」を確認");
  Logger.log("2. データが正しく復元されているか確認");
  Logger.log("3. 問題なければ syncLessonsIncremental() を実行して同期");
}

