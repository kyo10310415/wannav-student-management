// Google Apps Script: カレンダーからレッスン情報を取得（差分更新版）
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
      
      if (hasMore && allResults.length % 300 === 0) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`Notion API エラー: ${error.message}`);
      break;
    }
  }
  
  const emails = allResults
    .map(page => {
      try {
        const emailProp = page.properties['メールアドレス'];
        return emailProp?.email || null;
      } catch (error) {
        return null;
      }
    })
    .filter(email => email);
  
  Logger.log(`Notionから${emails.length}件のTutorメールアドレスを取得しました`);
  
  return emails;
}

// ========== カレンダー差分同期メイン処理 ==========

/**
 * 差分更新版：変更があったイベントのみ更新
 */
function syncLessonsToSheetIncremental() {
  Logger.log('========== レッスン差分同期開始 ==========');
  const startTime = new Date();
  
  // NotionからTutorメールアドレスを取得
  const notionEmails = getTutorEmailsFromNotion();
  
  if (notionEmails.length === 0) {
    Logger.log('エラー: Tutorメールアドレスが取得できませんでした');
    return;
  }
  
  Logger.log(`Notionから${notionEmails.length}件のTutorメールアドレスを取得`);
  
  // アクセス可能なカレンダーのみフィルタリング
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmailsSet = new Set(accessibleCalendars.map(cal => cal.getId()));
  const TUTOR_EMAILS = notionEmails.filter(email => accessibleEmailsSet.has(email));
  
  Logger.log(`アクセス可能なカレンダー: ${accessibleEmailsSet.size}件`);
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
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    Logger.log(`シート「${SHEET_NAME}」を作成しました`);
  }
  
  // 既存のイベントIDとその行番号を取得
  Logger.log('既存データを読み込み中...');
  const lastRow = sheet.getLastRow();
  const existingEventMap = new Map(); // eventId -> { rowNumber, lessonDate }
  
  if (lastRow > 1) {
    // 必要な列だけ取得（A列とE列のみ）
    const eventIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // A列
    const lessonDates = sheet.getRange(2, 5, lastRow - 1, 1).getValues(); // E列
    
    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i][0];
      const lessonDate = lessonDates[i][0];
      if (eventId) {
        existingEventMap.set(eventId, {
          rowNumber: i + 2, // ヘッダー行分+1
          lessonDate: lessonDate
        });
      }
    }
  }
  
  Logger.log(`既存データ: ${existingEventMap.size}件のイベント`);
  
  // 取得期間（先月〜来月）
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59);
  
  Logger.log(`取得期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let totalEvents = 0;
  let newEvents = 0;
  let updatedEvents = 0;
  let unchangedEvents = 0;
  let eventsWithStudentId = 0;
  const currentEventIds = new Set();
  const newRowsToAdd = [];
  const rowsToUpdate = [];
  
  // 各カレンダーから取得
  TUTOR_EMAILS.forEach((email, index) => {
    try {
      const calendar = CalendarApp.getCalendarById(email);
      
      if (!calendar) {
        return;
      }
      
      const events = calendar.getEvents(startDate, endDate);
      totalEvents += events.length;
      
      if ((index + 1) % 5 === 0 || index === 0) {
        Logger.log(`[${index + 1}/${TUTOR_EMAILS.length}] ${email}: ${events.length}件のイベントを取得`);
      }
      
      events.forEach(event => {
        const title = event.getTitle();
        const description = event.getDescription();
        const startTime = event.getStartTime();
        const eventId = event.getId();
        
        currentEventIds.add(eventId);
        
        // 学籍番号を抽出
        const studentId = extractStudentId(description);
        if (!studentId) {
          return; // 学籍番号がないイベントはスキップ
        }
        
        eventsWithStudentId++;
        
        const tutorName = extractTutorName(title);
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
        
        if (existingEventMap.has(eventId)) {
          // 既存イベント：日時が変わった場合のみ更新
          const existing = existingEventMap.get(eventId);
          const existingDate = new Date(existing.lessonDate);
          
          // 日時が異なる場合のみ更新
          if (Math.abs(existingDate - startTime) > 60000) { // 1分以上の差
            rowsToUpdate.push({
              rowNumber: existing.rowNumber,
              data: rowData
            });
            updatedEvents++;
          } else {
            unchangedEvents++;
          }
        } else {
          // 新規イベント
          newRowsToAdd.push(rowData);
          newEvents++;
        }
      });
      
      // レート制限対策
      if ((index + 1) % 10 === 0 && index + 1 < TUTOR_EMAILS.length) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`⚠️ エラー [${email}]: ${error.message}`);
    }
  });
  
  Logger.log(`カレンダー取得完了: ${totalEvents}件（学籍番号あり: ${eventsWithStudentId}件）`);
  
  // 差分が多い場合は全削除・再取得のほうが速い
  const changeRate = (newEvents + updatedEvents + deletedRows.length) / Math.max(existingEventMap.size, 1);
  const shouldFullRewrite = changeRate > 0.3 || existingEventMap.size === 0; // 変更率30%以上または初回
  
  if (shouldFullRewrite) {
    Logger.log(`変更率が高いため全データを書き直します（変更率: ${Math.round(changeRate * 100)}%）`);
    
    // ヘッダー以外を全削除
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    
    // 全イベントを再収集
    const allRows = [];
    currentEventIds.forEach(eventId => {
      // newRowsToAdd または existingEventMap から該当データを取得
      const newRow = newRowsToAdd.find(row => row[0] === eventId);
      if (newRow) {
        allRows.push(newRow);
      } else {
        const updateRow = rowsToUpdate.find(item => item.data[0] === eventId);
        if (updateRow) {
          allRows.push(updateRow.data);
        }
      }
    });
    
    // 一括書き込み
    if (allRows.length > 0) {
      Logger.log(`${allRows.length}件のイベントを一括書き込み中...`);
      
      // Spreadsheet API の制限（一度に最大10,000行）を考慮してバッチ処理
      const BATCH_SIZE = 5000;
      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, Math.min(i + BATCH_SIZE, allRows.length));
        sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, 9).setValues(batch);
        
        if (i + BATCH_SIZE < allRows.length) {
          Logger.log(`  ${i + batch.length}/${allRows.length}件 書き込み完了...`);
          Utilities.sleep(500); // レート制限対策
        }
      }
    }
    
  } else {
    // 差分更新（変更率が低い場合のみ）
    Logger.log(`差分更新モード（変更率: ${Math.round(changeRate * 100)}%）`);
    
    // バッチ更新：既存行を更新
    if (rowsToUpdate.length > 0) {
      Logger.log(`既存イベント更新中: ${rowsToUpdate.length}件...`);
      
      // 効率化：連続した行をまとめて更新
      rowsToUpdate.sort((a, b) => a.rowNumber - b.rowNumber);
      
      let batchStart = 0;
      while (batchStart < rowsToUpdate.length) {
        const currentRow = rowsToUpdate[batchStart].rowNumber;
        let batchEnd = batchStart + 1;
        
        // 連続した行を探す
        while (batchEnd < rowsToUpdate.length && 
               rowsToUpdate[batchEnd].rowNumber === rowsToUpdate[batchEnd - 1].rowNumber + 1) {
          batchEnd++;
        }
        
        // バッチで更新
        const batchData = rowsToUpdate.slice(batchStart, batchEnd).map(item => item.data);
        sheet.getRange(currentRow, 1, batchData.length, 9).setValues(batchData);
        
        batchStart = batchEnd;
      }
    }
    
    // バッチ追加：新規行を追加
    if (newRowsToAdd.length > 0) {
      Logger.log(`新規イベント追加中: ${newRowsToAdd.length}件...`);
      
      const BATCH_SIZE = 5000;
      for (let i = 0; i < newRowsToAdd.length; i += BATCH_SIZE) {
        const batch = newRowsToAdd.slice(i, Math.min(i + BATCH_SIZE, newRowsToAdd.length));
        sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, 9).setValues(batch);
        
        if (i + BATCH_SIZE < newRowsToAdd.length) {
          Utilities.sleep(500);
        }
      }
    }
    
    // 削除されたイベントを検出（期間内だが、カレンダーにないイベント）
    Logger.log('削除されたイベントを検出中...');
    const deletedRows = [];
    
    existingEventMap.forEach((info, eventId) => {
      if (!currentEventIds.has(eventId)) {
        const lessonDate = new Date(info.lessonDate);
        // 取得期間内のイベントのみ削除対象
        if (lessonDate >= startDate && lessonDate <= endDate) {
          deletedRows.push(info.rowNumber);
        }
      }
    });
    
    // 古いイベントを削除（後ろから削除）
    if (deletedRows.length > 0) {
      Logger.log(`削除対象イベント: ${deletedRows.length}件`);
      deletedRows.sort((a, b) => b - a); // 降順ソート
      
      // バッチ削除（連続した行をまとめて削除）
      let i = 0;
      while (i < deletedRows.length) {
        const startRow = deletedRows[i];
        let count = 1;
        
        // 連続した行を探す
        while (i + count < deletedRows.length && 
               deletedRows[i + count] === startRow - count) {
          count++;
        }
        
        sheet.deleteRows(startRow - count + 1, count);
        i += count;
      }
    }
  }
  
  // ソート（レッスン日時の昇順）
  if (sheet.getLastRow() > 1) {
    Logger.log('データをソート中...');
    sheet.sort(5);
  }
  
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  
  Logger.log('========== 差分同期完了 ==========');
  Logger.log(`実行時間: ${executionTime}秒`);
  Logger.log(`Notion Tutor総数: ${notionEmails.length}件`);
  Logger.log(`アクセス可能カレンダー: ${TUTOR_EMAILS.length}件`);
  Logger.log(`新規: ${newEvents}件、更新: ${updatedEvents}件、変更なし: ${unchangedEvents}件、削除: ${deletedRows.length}件`);
  Logger.log(`現在のイベント総数: ${sheet.getLastRow() - 1}件`);
  
  // メタ情報を記録
  updateMetaSheet(ss, totalEvents, eventsWithStudentId, newEvents, updatedEvents, deletedRows.length, executionTime, notionEmails.length, TUTOR_EMAILS.length);
}

// ========== メタ情報記録 ==========

/**
 * 同期メタ情報を記録
 */
function updateMetaSheet(ss, totalEvents, validEvents, newEvents, updatedEvents, deletedEvents, executionTime, notionTutorCount, accessibleTutorCount) {
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
  metaSheet.appendRow(['Notion Tutor総数', notionTutorCount || '-']);
  metaSheet.appendRow(['アクセス可能カレンダー数', accessibleTutorCount || '-']);
  metaSheet.appendRow(['総イベント数（期間内）', totalEvents]);
  metaSheet.appendRow(['学籍番号あり', validEvents]);
  metaSheet.appendRow(['新規追加', newEvents]);
  metaSheet.appendRow(['更新', updatedEvents]);
  metaSheet.appendRow(['削除', deletedEvents]);
  metaSheet.appendRow(['実行時間（秒）', executionTime]);
  metaSheet.appendRow(['シート内総件数', ss.getSheetByName(SHEET_NAME).getLastRow() - 1]);
  
  // 列幅を調整
  metaSheet.autoResizeColumns(1, 2);
}

// ========== 抽出ヘルパー関数 ==========

/**
 * 学籍番号を抽出
 */
function extractStudentId(description) {
  if (!description) return null;
  
  let match = description.match(/学籍番号[：:\s]*([A-Z0-9-]+)/i);
  if (match) return match[1];
  
  match = description.match(/OLTS\d{6}-[A-Z]{2}/i);
  if (match) return match[0];
  
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

/**
 * 日付をフォーマット
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

// ========== トリガー設定 ==========

/**
 * 差分更新トリガーを設定（1時間ごと）
 */
function setupIncrementalTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // 1時間ごとに実行
  ScriptApp.newTrigger('syncLessonsToSheetIncremental')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log('差分更新トリガーを設定しました: 1時間ごとに syncLessonsToSheetIncremental を実行');
}

/**
 * 差分更新トリガーを設定（30分ごと）
 */
function setupFrequentIncrementalTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  ScriptApp.newTrigger('syncLessonsToSheetIncremental')
    .timeBased()
    .everyMinutes(30)
    .create();
  
  Logger.log('差分更新トリガーを設定しました: 30分ごとに syncLessonsToSheetIncremental を実行');
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
  });
}

// ========== テスト関数 ==========

/**
 * 差分更新のテスト実行
 */
function testIncrementalSync() {
  Logger.log('========== 差分更新テスト ==========');
  syncLessonsToSheetIncremental();
}
