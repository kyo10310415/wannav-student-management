/**
 * 差分更新版：変更があったイベントのみ更新
 */
function syncLessonsToSheetIncremental() {
  Logger.log('========== レッスン差分同期開始 ==========');
  const startTime = new Date();
  
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
  
  Logger.log(`アクセス可能なTutorカレンダー: ${TUTOR_EMAILS.length}件`);
  
  if (TUTOR_EMAILS.length === 0) {
    Logger.log('⚠️ 警告: アクセス可能なTutorカレンダーがありません');
    return;
  }
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  
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
  }
  
  // 既存のイベントIDを取得
  const existingData = sheet.getDataRange().getValues();
  const existingEventIds = new Map();
  
  for (let i = 1; i < existingData.length; i++) { // ヘッダー行をスキップ
    const eventId = existingData[i][0]; // A列: イベントID
    if (eventId) {
      existingEventIds.set(eventId, i + 1); // 行番号を保存（1始まり）
    }
  }
  
  Logger.log(`既存データ: ${existingEventIds.size}件のイベント`);
  
  // 取得期間
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59);
  
  Logger.log(`取得期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`);
  
  let newEvents = 0;
  let updatedEvents = 0;
  let unchangedEvents = 0;
  const currentEventIds = new Set();
  
  // 各カレンダーから取得
  TUTOR_EMAILS.forEach((email, index) => {
    try {
      const calendar = CalendarApp.getCalendarById(email);
      
      if (!calendar) {
        return;
      }
      
      const events = calendar.getEvents(startDate, endDate);
      
      if ((index + 1) % 5 === 0) {
        Logger.log(`[${index + 1}/${TUTOR_EMAILS.length}] ${email}: ${events.length}件`);
      }
      
      events.forEach(event => {
        const title = event.getTitle();
        const description = event.getDescription();
        const startTime = event.getStartTime();
        const eventId = event.getId();
        
        currentEventIds.add(eventId);
        
        // 学籍番号を抽出
        const studentId = extractStudentId(description);
        if (!studentId) return;
        
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
        
        if (existingEventIds.has(eventId)) {
          // 既存イベント：更新
          const rowNumber = existingEventIds.get(eventId);
          sheet.getRange(rowNumber, 1, 1, 9).setValues([rowData]);
          updatedEvents++;
        } else {
          // 新規イベント：追加
          sheet.appendRow(rowData);
          newEvents++;
        }
      });
      
      // レート制限対策
      if ((index + 1) % 10 === 0 && index + 1 < TUTOR_EMAILS.length) {
        Utilities.sleep(1000);
      }
      
    } catch (error) {
      Logger.log(`エラー [${email}]: ${error.message}`);
    }
  });
  
  // 削除されたイベントを検出（カレンダーにないが、シートにあるイベント）
  const deletedEventIds = [];
  existingEventIds.forEach((rowNumber, eventId) => {
    if (!currentEventIds.has(eventId)) {
      deletedEventIds.push({ eventId, rowNumber });
    }
  });
  
  // 古いイベントを削除（後ろから削除）
  deletedEventIds.sort((a, b) => b.rowNumber - a.rowNumber);
  let deletedCount = 0;
  
  deletedEventIds.forEach(item => {
    sheet.deleteRow(item.rowNumber);
    deletedCount++;
  });
  
  // ソート
  if (sheet.getLastRow() > 1) {
    sheet.sort(5); // レッスン日時でソート
  }
  
  const endTime = new Date();
  const executionTime = Math.round((endTime - startTime) / 1000);
  
  Logger.log('========== 差分同期完了 ==========');
  Logger.log(`実行時間: ${executionTime}秒`);
  Logger.log(`新規: ${newEvents}件、更新: ${updatedEvents}件、削除: ${deletedCount}件`);
  Logger.log(`現在のイベント総数: ${sheet.getLastRow() - 1}件`);
}

/**
 * 差分更新用トリガー設定（1時間ごと）
 */
function setupIncrementalTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncLessonsToSheetIncremental') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 1時間ごとに実行
  ScriptApp.newTrigger('syncLessonsToSheetIncremental')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log('差分更新トリガーを設定しました: 1時間ごとに syncLessonsToSheetIncremental を実行');
}
