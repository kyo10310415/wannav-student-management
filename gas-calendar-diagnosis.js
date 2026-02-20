// Google Apps Script: カレンダー同期の診断ツール
// 取得できていないTutorの原因を特定

// ========== 設定 ==========
// 注意: このスクリプトを既存のGASプロジェクトに追加する場合、
// 既存の設定変数を使用するため、以下の変数宣言をコメントアウトしてください。

// const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
// const NOTION_TUTOR_API_TOKEN = 'YOUR_TUTOR_NOTION_API_TOKEN';
// const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID';

// 既存のスクリプトファイル（gas-calendar-sync.js など）で
// 既に宣言されている変数を使用します

// ========== 診断メイン関数 ==========

/**
 * 全Tutorのカレンダーアクセス状況を診断
 */
function diagnoseTutorCalendars() {
  Logger.log('========== カレンダーアクセス診断開始 ==========');
  
  // 1. Notionから全Tutorデータを取得
  const notionTutors = getTutorEmailsFromNotion();
  Logger.log(`\n【Notion Tutor総数】: ${notionTutors.length}件`);
  
  // 2. アクセス可能なカレンダー一覧を取得
  const accessibleCalendars = CalendarApp.getAllCalendars();
  const accessibleEmails = accessibleCalendars.map(cal => cal.getId().toLowerCase());
  const accessibleEmailsSet = new Set(accessibleEmails);
  
  Logger.log(`【アクセス可能カレンダー】: ${accessibleEmailsSet.size}件`);
  
  // 3. 診断結果の集計
  const results = {
    accessible: [],
    notAccessible: [],
    noEmail: []
  };
  
  notionTutors.forEach(tutor => {
    if (!tutor.email) {
      results.noEmail.push(tutor);
    } else if (accessibleEmailsSet.has(tutor.email.toLowerCase())) {
      results.accessible.push(tutor);
    } else {
      results.notAccessible.push(tutor);
    }
  });
  
  // 4. 結果表示
  Logger.log('\n========== 診断結果 ==========');
  Logger.log(`✅ アクセス可能: ${results.accessible.length}件`);
  Logger.log(`❌ アクセス不可: ${results.notAccessible.length}件`);
  Logger.log(`⚠️ メールアドレスなし: ${results.noEmail.length}件`);
  
  // 5. アクセス不可のTutor詳細
  if (results.notAccessible.length > 0) {
    Logger.log('\n========== ❌ アクセス不可のTutor ==========');
    results.notAccessible.forEach((tutor, index) => {
      Logger.log(`\n[${index + 1}] ${tutor.name} (${tutor.tutor_name})`);
      Logger.log(`    従業員ID: ${tutor.employee_id}`);
      Logger.log(`    メールアドレス: ${tutor.email}`);
      Logger.log(`    Notion名: ${tutor.notion_name}`);
      Logger.log(`    職種: ${tutor.job_type}`);
      Logger.log(`    ステータス: ${tutor.status}`);
      
      // メールアドレスの検証
      if (tutor.email) {
        const lowerEmail = tutor.email.toLowerCase();
        Logger.log(`    小文字変換後: ${lowerEmail}`);
        
        // 類似するカレンダーIDを探す
        const similar = accessibleEmails.filter(e => 
          e.includes(tutor.employee_id) || 
          e.includes(tutor.name.replace(/\s/g, '')) ||
          e.includes(tutor.tutor_name)
        );
        
        if (similar.length > 0) {
          Logger.log(`    💡 類似カレンダー: ${similar.join(', ')}`);
        }
      }
    });
  }
  
  // 6. メールアドレスなしのTutor詳細
  if (results.noEmail.length > 0) {
    Logger.log('\n========== ⚠️ メールアドレスなしのTutor ==========');
    results.noEmail.forEach((tutor, index) => {
      Logger.log(`[${index + 1}] ${tutor.name} (${tutor.tutor_name})`);
      Logger.log(`    従業員ID: ${tutor.employee_id}`);
      Logger.log(`    Notion名: ${tutor.notion_name}`);
    });
  }
  
  // 7. アクセス可能なTutorの一部表示
  Logger.log('\n========== ✅ アクセス可能なTutor（最初の5件） ==========');
  results.accessible.slice(0, 5).forEach((tutor, index) => {
    Logger.log(`[${index + 1}] ${tutor.name} (${tutor.tutor_name}) - ${tutor.email}`);
  });
  
  // 8. スプレッドシートに診断結果を保存
  saveDiagnosisToSheet(results, notionTutors.length, accessibleEmailsSet.size);
  
  Logger.log('\n========== 診断完了 ==========');
}

/**
 * 特定のTutorのカレンダーアクセステスト
 */
function testSpecificTutor(tutorName) {
  Logger.log(`========== ${tutorName}のカレンダーアクセステスト ==========`);
  
  const notionTutors = getTutorEmailsFromNotion();
  const tutor = notionTutors.find(t => 
    t.name === tutorName || 
    t.tutor_name === tutorName ||
    t.notion_name === tutorName
  );
  
  if (!tutor) {
    Logger.log(`❌ Tutorが見つかりません: ${tutorName}`);
    return;
  }
  
  Logger.log('\n【Tutor情報】');
  Logger.log(`名前: ${tutor.name}`);
  Logger.log(`Tutor名: ${tutor.tutor_name}`);
  Logger.log(`従業員ID: ${tutor.employee_id}`);
  Logger.log(`メールアドレス: ${tutor.email}`);
  Logger.log(`Notion名: ${tutor.notion_name}`);
  Logger.log(`職種: ${tutor.job_type}`);
  Logger.log(`ステータス: ${tutor.status}`);
  
  if (!tutor.email) {
    Logger.log('\n❌ メールアドレスが設定されていません');
    return;
  }
  
  // カレンダーアクセステスト
  try {
    const email = tutor.email.toLowerCase();
    Logger.log(`\n【カレンダーアクセステスト】`);
    Logger.log(`対象メールアドレス: ${email}`);
    
    const calendar = CalendarApp.getCalendarById(email);
    
    if (!calendar) {
      Logger.log('❌ カレンダーが見つかりません');
      Logger.log('💡 対処法:');
      Logger.log('   1. Googleカレンダーで該当カレンダーを開く');
      Logger.log(`   2. 「設定と共有」→「特定のユーザーと共有」`);
      Logger.log(`   3. サービスアカウントを追加: wannav-calendar-service@student-management-487812.iam.gserviceaccount.com`);
      Logger.log('   4. 権限: 「予定の表示（すべての予定の詳細）」');
      return;
    }
    
    Logger.log('✅ カレンダーアクセス成功');
    Logger.log(`カレンダー名: ${calendar.getName()}`);
    
    // イベント取得テスト
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    const events = calendar.getEvents(today, nextMonth);
    
    Logger.log(`\n【イベント取得テスト】`);
    Logger.log(`取得期間: ${formatDate(today)} ～ ${formatDate(nextMonth)}`);
    Logger.log(`取得件数: ${events.length}件`);
    
    if (events.length > 0) {
      Logger.log('\n【最初の3件のイベント】');
      events.slice(0, 3).forEach((event, index) => {
        Logger.log(`\n[${index + 1}] ${event.getTitle()}`);
        Logger.log(`    日時: ${formatDate(event.getStartTime())}`);
        Logger.log(`    説明: ${(event.getDescription() || '').substring(0, 100)}...`);
      });
    } else {
      Logger.log('⚠️ イベントが見つかりません（期間内にレッスンがない可能性）');
    }
    
  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 全アクセス可能カレンダーの一覧表示
 */
function listAllAccessibleCalendars() {
  Logger.log('========== アクセス可能なカレンダー一覧 ==========');
  
  const calendars = CalendarApp.getAllCalendars();
  Logger.log(`総数: ${calendars.length}件\n`);
  
  calendars.forEach((calendar, index) => {
    Logger.log(`[${index + 1}] ${calendar.getName()}`);
    Logger.log(`    ID: ${calendar.getId()}`);
    Logger.log(`    説明: ${calendar.getDescription() || '(なし)'}`);
    Logger.log(`    タイムゾーン: ${calendar.getTimeZone()}`);
  });
}

// ========== Notion API関連 ==========

/**
 * NotionからTutorメールアドレスを取得
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
  
  // Tutorデータを抽出
  return allResults.map(page => {
    const props = page.properties;
    
    // メールアドレスを取得
    let email = null;
    try {
      const emailProp = props['メールアドレス'];
      email = emailProp?.email || null;
    } catch (e) {
      // メールアドレスがない場合
    }
    
    // 職種を取得
    let jobType = '';
    try {
      const jobTypeProp = props['職種'];
      if (jobTypeProp?.multi_select) {
        jobType = jobTypeProp.multi_select.map(item => item.name).join(', ');
      } else if (jobTypeProp?.select) {
        jobType = jobTypeProp.select.name || '';
      }
    } catch (e) {
      // 職種がない場合
    }
    
    // ステータスを取得
    let status = '';
    try {
      const statusProp = props['ステータス'];
      if (statusProp?.select) {
        status = statusProp.select.name || '';
      } else if (statusProp?.status) {
        status = statusProp.status.name || '';
      }
    } catch (e) {
      // ステータスがない場合
    }
    
    return {
      notion_page_id: page.id,
      employee_id: getPropertyValue(props['従業員ID']),
      name: getPropertyValue(props['名前']),
      tutor_name: getPropertyValue(props['Tutor名']),
      email: email,
      notion_name: getPropertyValue(props['Notion名']),
      job_type: jobType,
      status: status
    };
  });
}

/**
 * プロパティ値を取得（汎用）
 */
function getPropertyValue(property) {
  if (!property) return '';
  
  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text?.[0]?.plain_text || '';
    case 'select':
      return property.select?.name || '';
    case 'multi_select':
      return property.multi_select?.map(item => item.name).join(', ') || '';
    case 'status':
      return property.status?.name || '';
    case 'email':
      return property.email || '';
    case 'phone_number':
      return property.phone_number || '';
    case 'url':
      return property.url || '';
    case 'relation':
      // リレーションの場合、最初のアイテムのIDを返す
      return property.relation?.[0]?.id || '';
    default:
      return '';
  }
}

// ========== スプレッドシート保存 ==========

/**
 * 診断結果をスプレッドシートに保存
 */
function saveDiagnosisToSheet(results, notionTotal, accessibleTotal) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = 'カレンダー診断結果';
    let sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    sheet.clear();
    
    // ヘッダー
    sheet.appendRow(['カレンダーアクセス診断結果', '', '', '', '', '']);
    sheet.appendRow(['診断日時', new Date()]);
    sheet.appendRow(['Notion Tutor総数', notionTotal]);
    sheet.appendRow(['アクセス可能カレンダー数', accessibleTotal]);
    sheet.appendRow(['アクセス可能Tutor数', results.accessible.length]);
    sheet.appendRow(['アクセス不可Tutor数', results.notAccessible.length]);
    sheet.appendRow(['メールアドレスなしTutor数', results.noEmail.length]);
    sheet.appendRow(['']);
    
    // アクセス不可のTutor詳細
    sheet.appendRow(['❌ アクセス不可のTutor', '', '', '', '', '']);
    sheet.appendRow(['名前', 'Tutor名', '従業員ID', 'メールアドレス', '職種', 'ステータス']);
    
    results.notAccessible.forEach(tutor => {
      sheet.appendRow([
        tutor.name,
        tutor.tutor_name,
        tutor.employee_id,
        tutor.email,
        tutor.job_type,
        tutor.status
      ]);
    });
    
    sheet.appendRow(['']);
    
    // メールアドレスなしのTutor詳細
    sheet.appendRow(['⚠️ メールアドレスなしのTutor', '', '', '', '', '']);
    sheet.appendRow(['名前', 'Tutor名', '従業員ID', 'Notion名', '職種', 'ステータス']);
    
    results.noEmail.forEach(tutor => {
      sheet.appendRow([
        tutor.name,
        tutor.tutor_name,
        tutor.employee_id,
        tutor.notion_name,
        tutor.job_type,
        tutor.status
      ]);
    });
    
    // 列幅を調整
    sheet.autoResizeColumns(1, 6);
    
    // ヘッダーを太字に
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.getRange(9, 1, 1, 6).setFontWeight('bold');
    sheet.getRange(10, 1, 1, 6).setFontWeight('bold');
    
    Logger.log(`診断結果をスプレッドシートに保存しました: ${sheetName}`);
    
  } catch (error) {
    Logger.log(`スプレッドシート保存エラー: ${error.message}`);
  }
}

// ========== ユーティリティ関数 ==========

/**
 * 日付をフォーマット
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

// ========== テスト関数 ==========

/**
 * テスト用ラッパー関数（引数付き関数を実行しやすくするため）
 */
function testTeiSensei() {
  testSpecificTutor("てぃ先生");
}

function testKojiSensei() {
  testSpecificTutor("こうじ先生");
}

function testKyoheiSensei() {
  testSpecificTutor("きょうへい先生");
}

/**
 * カスタムTutorテスト（この関数を編集して使用）
 */
function testCustomTutor() {
  // ここにTutor名を入力して実行してください
  const tutorName = "てぃ先生"; // ← ここを変更
  testSpecificTutor(tutorName);
}

/**
 * 診断ツールの使い方
 */
function showUsage() {
  Logger.log('========== カレンダー診断ツールの使い方 ==========');
  Logger.log('');
  Logger.log('1. diagnoseTutorCalendars()');
  Logger.log('   → 全Tutorのカレンダーアクセス状況を診断');
  Logger.log('   → 結果はログとスプレッドシートに保存');
  Logger.log('');
  Logger.log('2. testCustomTutor()');
  Logger.log('   → 関数内のtutorName変数を編集してから実行');
  Logger.log('   → 特定のTutorのカレンダーアクセスをテスト');
  Logger.log('');
  Logger.log('3. testTeiSensei() / testKojiSensei() / testKyoheiSensei()');
  Logger.log('   → よく使うTutor用のショートカット関数');
  Logger.log('');
  Logger.log('4. listAllAccessibleCalendars()');
  Logger.log('   → サービスアカウントがアクセスできる全カレンダーを表示');
  Logger.log('');
  Logger.log('💡 ヒント:');
  Logger.log('   - testCustomTutor() の tutorName を変更して使用');
  Logger.log('   - Tutor名、名前、Notion名のいずれでも検索可能');
  Logger.log('   - 例: "てぃ先生", "先生てぃ", "てぃ" すべてOK');
  Logger.log('');
}
