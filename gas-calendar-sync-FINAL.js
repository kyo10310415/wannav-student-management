// Google Apps Script: カレンダーからレッスン情報を取得（差分更新版・削除検知強化）
// NotionからTutorメールアドレスを自動取得
// 削除されたイベントを確実に検知して削除

// ========== 重要：Calendar API の有効化 ==========
// Google Meet リンクを取得するには、Advanced Google Services の Calendar API を有効化する必要があります
// 
// 有効化手順：
// 1. GAS エディタで「サービス」（左側メニュー）をクリック
// 2. 「Google Calendar API」を検索
// 3. 「追加」ボタンをクリック
// 4. 識別子を「Calendar」のまま保存
//
// これにより、`Calendar.Events.get()` でイベントの conferenceData（Google Meet情報）を取得できます

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
 * 差分更新メイン関数（削除検知強化版・修正済み）
 */
function syncLessonsIncrementalFixed() {
  Logger.log('========== レッスン差分同期開始（修正済みバージョン） ==========');
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
      '最終更新日時',
      '時間'
    ]);
    
    // ヘッダー行を太字に
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
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
  
  // Meetリンク取得統計
  let eventsWithMeet = 0;
  let eventsWithoutMeet = 0;
  
  // Calendar API のイベントキャッシュ（カレンダーごとに1回だけAPI呼び出し）
  const calendarEventCache = new Map();
  
  /**
   * Calendar API からイベントを取得（キャッシュ付き）
   */
  function getCalendarEventWithCache(calendarId, eventId) {
    // カレンダーごとのキャッシュを作成
    if (!calendarEventCache.has(calendarId)) {
      calendarEventCache.set(calendarId, new Map());
    }
    
    const cache = calendarEventCache.get(calendarId);
    
    // キャッシュにあれば返す
    if (cache.has(eventId)) {
      return cache.get(eventId);
    }
    
    // キャッシュになければAPIコール
    try {
      // イベントIDの変換
      let cleanEventId = eventId;
      if (eventId.includes('@google.com')) {
        cleanEventId = eventId.split('@google.com')[0];
      }
      if (cleanEventId.includes('_')) {
        cleanEventId = cleanEventId.split('_')[0];
      }
      
      const calendarEvent = Calendar.Events.get(calendarId, cleanEventId);
      cache.set(eventId, calendarEvent);
      return calendarEvent;
    } catch (error) {
      // エラーの場合はnullをキャッシュ（次回は呼び出さない）
      cache.set(eventId, null);
      return null;
    }
  }
  
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
        
        // Meetリンクを抽出（Calendar API を使用して conferenceData から取得）
        const meetLink = extractMeetLinkAdvanced(email, eventId, event, description, getCalendarEventWithCache);
        
        // Meetリンク統計
        if (meetLink) {
          eventsWithMeet++;
        } else {
          eventsWithoutMeet++;
        }
        
        // 時間を抽出（HH:MM形式）
        const lessonTime = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'HH:mm');
        
        const rowData = [
          eventId,
          studentId,
          tutorName || '',
          email,
          startTime,
          title,
          description || '',
          meetLink || '',
          new Date(),
          lessonTime
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
  
  // 削除されたイベントを検出
  // 1. 取得範囲内でカレンダーから消えたイベント（キャンセル/リスケ）
  // 2. 取得範囲外のイベント（古すぎる/遠すぎる未来）
  const rowsToDelete = [];
  const deletedEventsData = []; // 削除されたイベントのデータを保存
  let outOfRangeCount = 0; // 範囲外削除のカウント
  
  existingData.forEach((value, eventId) => {
    const eventDate = new Date(value.data[4]); // レッスン日時
    let deleteReason = null;
    
    // ケース1: 取得範囲外のイベント（古すぎる過去 or 遠すぎる未来）
    if (eventDate < startDate || eventDate > endDate) {
      deleteReason = '取得範囲外';
      outOfRangeCount++;
      
      // 削除ログ（最初の5件のみ）
      if (outOfRangeCount <= 5) {
        Logger.log(`削除検知（範囲外）: ${value.data[1]} - ${value.data[2]} - ${formatDate(eventDate)}`);
      }
    }
    // ケース2: 取得範囲内だがカレンダーから取得できなかった（削除/キャンセル）
    else if (eventDate >= startDate && eventDate <= endDate && !fetchedEventIds.has(eventId)) {
      deleteReason = 'カレンダーから削除';
      
      // 削除ログ（最初の10件のみ）
      if (deletedEvents - outOfRangeCount < 10) {
        Logger.log(`削除検知（キャンセル）: ${value.data[1]} - ${value.data[2]} - ${formatDate(eventDate)}`);
      }
    }
    
    // 削除対象の場合のみデータを保存
    if (deleteReason) {
      rowsToDelete.push(value.rowNumber);
      deletedEvents++;
      
      // 削除されたイベントのデータを保存（削除日時と削除理由を追加）
      const deletedData = [...value.data]; // 既存データをコピー
      
      // 既存データにJ列（時間）がない場合は空文字列を追加
      if (deletedData.length < 10) {
        deletedData.push(''); // J列: 時間（空）
      }
      
      deletedData.push(new Date()); // K列: 削除検知日時を追加
      deletedData.push(deleteReason); // L列: 削除理由を追加
      deletedEventsData.push(deletedData);
    }
  });
  
  if (deletedEvents > 15) {
    Logger.log(`...他 ${deletedEvents - 15}件の削除イベント`);
  }
  
  Logger.log(`差分検出: 新規${newEvents}件、更新${updatedEvents}件、削除${deletedEvents}件（範囲外: ${outOfRangeCount}件、キャンセル: ${deletedEvents - outOfRangeCount}件）`);
  Logger.log(`Meetリンク取得: あり${eventsWithMeet}件、なし${eventsWithoutMeet}件（割合: ${eventsWithMeet + eventsWithoutMeet > 0 ? Math.round(eventsWithMeet / (eventsWithMeet + eventsWithoutMeet) * 100) : 0}%）`);
  
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
      '時間',
      '削除検知日時',
      '削除理由'
    ]);
    
    // ヘッダー行を太字に
    deletedSheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  
  // 削除されたイベントを追記（末尾に追加）
  const lastRow = deletedSheet.getLastRow();
  deletedSheet.getRange(lastRow + 1, 1, deletedEventsData.length, 12).setValues(deletedEventsData);
  
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
  // 既存データにJ列（時間）がない場合は更新が必要
  if (existing.data.length < 10) return true;
  
  // 日時、タイトル、説明、Meetリンク、時間を比較
  const existingDate = new Date(existing.data[4]).getTime();
  const newDate = new Date(newData[4]).getTime();
  
  if (existingDate !== newDate) return true;
  if (existing.data[5] !== newData[5]) return true; // タイトル
  if (existing.data[6] !== newData[6]) return true; // 説明
  if (existing.data[7] !== newData[7]) return true; // Meetリンク
  if (existing.data[9] !== newData[9]) return true; // 時間
  
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
    
    // 重複削除と範囲チェック
    const maxRow = sheet.getLastRow();
    const uniqueRows = [...new Set(rowsToDelete)].filter(row => row > 1 && row <= maxRow);
    
    if (uniqueRows.length !== rowsToDelete.length) {
      Logger.log(`⚠️ 警告: 重複または範囲外の行番号を除外しました（${rowsToDelete.length}件 → ${uniqueRows.length}件）`);
    }
    
    // 降順ソート（後ろから削除しないと行番号がズレる）
    uniqueRows.sort((a, b) => b - a);
    
    // バッチ削除（連続する行をまとめて削除）
    let deletedCount = 0;
    let i = 0;
    
    while (i < uniqueRows.length) {
      try {
        const startRow = uniqueRows[i];
        let numRows = 1;
        
        // 連続する行をカウント（降順なので-1ずつ減る）
        while (i + numRows < uniqueRows.length && 
               uniqueRows[i + numRows] === startRow - numRows) {
          numRows++;
        }
        
        // 連続する行をまとめて削除（最大100行ずつ）
        const batchSize = Math.min(numRows, 100);
        const deleteStartRow = startRow - batchSize + 1;
        
        sheet.deleteRows(deleteStartRow, batchSize);
        deletedCount += batchSize;
        i += batchSize;
        
        // 進捗表示（100件ごと）
        if (deletedCount % 100 === 0) {
          Logger.log(`削除進捗: ${deletedCount}/${uniqueRows.length}件完了`);
        }
        
        // API制限対策（100行削除ごとに0.5秒待機）
        if (deletedCount % 100 === 0) {
          Utilities.sleep(500);
        }
        
      } catch (error) {
        Logger.log(`⚠️ 削除エラー（行${uniqueRows[i]}付近）: ${error.message}`);
        i++; // エラーが出たら1行スキップして続行
      }
    }
    
    Logger.log(`✅ 削除完了: ${deletedCount}/${uniqueRows.length}件`);
  }
  
  // 2. 更新（既存行を上書き）
  if (rowsToUpdate.length > 0) {
    Logger.log(`更新処理: ${rowsToUpdate.length}件のバッチ更新を実行中...`);
    
    // バッチ処理で一度に更新
    rowsToUpdate.forEach(item => {
      try {
        sheet.getRange(item.rowNumber, 1, 1, 10).setValues([item.data]);
      } catch (error) {
        Logger.log(`⚠️ 更新エラー（行${item.rowNumber}）: ${error.message}`);
      }
    });
    
    Logger.log(`✅ 更新完了: ${rowsToUpdate.length}件`);
  }
  
  // 3. 追加（末尾に追加）
  if (rowsToAdd.length > 0) {
    Logger.log(`追加処理: ${rowsToAdd.length}件のバッチ追加を実行中...`);
    
    // 一度に全行追加
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rowsToAdd.length, 10).setValues(rowsToAdd);
    
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
 * Meetリンクを抽出（改良版）
 * @param {CalendarEvent} event - カレンダーイベントオブジェクト
 * @param {string} description - イベントの説明文
 * @returns {string|null} - MeetリンクURL
 */
function extractMeetLink(event, description) {
  // 説明文から正規表現で抽出
  if (!description) return null;
  
  // 文字列に変換（オブジェクトや配列の場合に対応）
  const descStr = String(description);
  
  // 複数のパターンを試す
  const patterns = [
    // パターン1: https://meet.google.com/xxx-xxxx-xxx (ハイフン区切り)
    /https?:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i,
    // パターン2: https://meet.google.com/xxxxxxxxxx (ハイフンなし)
    /https?:\/\/meet\.google\.com\/[a-z0-9]+/i,
    // パターン3: meet.google.com/xxx-xxxx-xxx (httpsなし、ハイフン区切り)
    /meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i,
    // パターン4: meet.google.com/xxxxxxxxxx (httpsなし、ハイフンなし)
    /meet\.google\.com\/[a-z0-9]+/i,
    // パターン5: より柔軟なパターン（英数字とハイフン）
    /https?:\/\/meet\.google\.com\/[\w-]+/i,
    /meet\.google\.com\/[\w-]+/i
  ];
  
  for (const pattern of patterns) {
    const match = descStr.match(pattern);
    if (match) {
      const url = match[0];
      // httpsがない場合は追加
      return url.startsWith('http') ? url : 'https://' + url;
    }
  }
  
  // Meetリンクが見つからない場合は null を返す
  // Note: getHangoutLink() は使用不可のため、説明文からの抽出のみ
  return null;
}

/**
 * Meetリンクを抽出（高度版 - Calendar API 使用 + キャッシュ最適化）
 * @param {string} calendarId - カレンダーID（メールアドレス）
 * @param {string} eventId - イベントID
 * @param {CalendarEvent} event - カレンダーイベントオブジェクト
 * @param {string} description - イベントの説明文
 * @param {Function} getCachedEvent - キャッシュ付きイベント取得関数
 * @returns {string|null} - MeetリンクURL
 */
function extractMeetLinkAdvanced(calendarId, eventId, event, description, getCachedEvent) {
  // 方法1: Calendar API の conferenceData から取得（キャッシュ使用）
  try {
    const calendarEvent = getCachedEvent(calendarId, eventId);
    
    if (calendarEvent) {
      // hangoutLink プロパティをチェック
      if (calendarEvent.hangoutLink) {
        return calendarEvent.hangoutLink;
      }
      
      // conferenceData からビデオ会議リンクを取得
      if (calendarEvent.conferenceData && calendarEvent.conferenceData.entryPoints) {
        const entryPoints = calendarEvent.conferenceData.entryPoints;
        const videoEntry = entryPoints.find(ep => ep.entryPointType === 'video');
        
        if (videoEntry && videoEntry.uri) {
          return videoEntry.uri;
        }
      }
    }
  } catch (apiError) {
    // エラーログ（最初の5件のみ表示）
    if (typeof extractMeetLinkAdvanced.errorCount === 'undefined') {
      extractMeetLinkAdvanced.errorCount = 0;
    }
    if (extractMeetLinkAdvanced.errorCount < 5) {
      Logger.log(`⚠️ Calendar API エラー (${eventId.substring(0, 30)}...): ${apiError.message}`);
      extractMeetLinkAdvanced.errorCount++;
    }
  }
  
  // 方法2: 説明文から正規表現で抽出（フォールバック）
  return extractMeetLink(event, description);
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
