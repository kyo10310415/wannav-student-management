/**
 * 自分のカレンダーでテスト（デバッグ用）
 */
function testMyCalendar() {
  Logger.log('========== 自分のカレンダーテスト ==========');
  
  // 自分のメールアドレスに変更
  const myEmail = 'k.sakamoto@oneloopinc.net'; // ← あなたのメールアドレス
  
  try {
    // 方法1: メールアドレスで取得
    Logger.log(`方法1: getCalendarById('${myEmail}')`);
    let calendar = CalendarApp.getCalendarById(myEmail);
    
    if (calendar) {
      Logger.log(`✅ カレンダー取得成功: ${calendar.getName()}`);
    } else {
      Logger.log('❌ カレンダーが見つかりません');
      
      // 方法2: デフォルトカレンダーを取得
      Logger.log('方法2: getDefaultCalendar()');
      calendar = CalendarApp.getDefaultCalendar();
      Logger.log(`✅ デフォルトカレンダー: ${calendar.getName()}`);
    }
    
    // イベントを取得
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const events = calendar.getEvents(today, nextMonth);
    
    Logger.log(`✅ イベント数: ${events.length}件`);
    
    // 最初の3件のイベントを表示
    events.slice(0, 3).forEach((event, index) => {
      Logger.log(`[${index + 1}] タイトル: ${event.getTitle()}`);
      Logger.log(`    日時: ${event.getStartTime()}`);
      Logger.log(`    説明: ${(event.getDescription() || '').substring(0, 100)}...`);
    });
    
    return true;
  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(`スタックトレース: ${error.stack}`);
    return false;
  }
}

/**
 * 全カレンダーを一覧表示
 */
function listAllCalendars() {
  Logger.log('========== アクセス可能なカレンダー一覧 ==========');
  
  try {
    // 自分が所有しているカレンダー
    const ownedCalendars = CalendarApp.getAllCalendars();
    Logger.log(`所有カレンダー: ${ownedCalendars.length}件`);
    
    ownedCalendars.forEach((calendar, index) => {
      Logger.log(`[${index + 1}] ${calendar.getName()}`);
      Logger.log(`    ID: ${calendar.getId()}`);
      Logger.log(`    説明: ${calendar.getDescription() || '(なし)'}`);
    });
    
    // 自分がアクセスできる全カレンダー
    const allCalendars = CalendarApp.getAllOwnedCalendars();
    Logger.log(`\nアクセス可能なカレンダー: ${allCalendars.length}件`);
    
  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
  }
}

/**
 * NotionのメールアドレスとGoogleカレンダーIDを照合
 */
function verifyCalendarIds() {
  Logger.log('========== カレンダーID照合 ==========');
  
  // NotionからTutorメールアドレスを取得
  const emails = getTutorEmailsFromNotion();
  Logger.log(`Notionから取得したメールアドレス数: ${emails.length}件`);
  Logger.log(`最初の5件: ${emails.slice(0, 5).join(', ')}`);
  
  // アクセス可能なカレンダーを取得
  const calendars = CalendarApp.getAllCalendars();
  const calendarIds = calendars.map(cal => cal.getId());
  Logger.log(`\nアクセス可能なカレンダーID数: ${calendarIds.length}件`);
  Logger.log(`最初の5件: ${calendarIds.slice(0, 5).join(', ')}`);
  
  // 照合
  Logger.log('\n========== 照合結果 ==========');
  let matchCount = 0;
  let notFoundCount = 0;
  
  emails.slice(0, 10).forEach((email, index) => {
    if (calendarIds.includes(email)) {
      Logger.log(`[${index + 1}] ✅ 一致: ${email}`);
      matchCount++;
    } else {
      Logger.log(`[${index + 1}] ❌ 見つからない: ${email}`);
      notFoundCount++;
    }
  });
  
  Logger.log(`\n一致: ${matchCount}件、見つからない: ${notFoundCount}件`);
}
