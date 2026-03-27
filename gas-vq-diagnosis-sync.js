/**
 * VQ診断結果自動送信システム
 * スプレッドシートから診断結果を読み取り、Webhook経由でサーバーに送信
 */

// 設定
const CONFIG = {
  SHEET_ID: '1_yJtJn8DMFkQBtdIkDWHNBE8-kpHyE3-0FY_oe0EhJ0',
  SHEET_NAME: '診断結果',
  WEBHOOK_URL: 'YOUR_SERVER_URL/api/vq-diagnosis/process', // デプロイ後に設定
  
  // 列マッピング（0始まり）
  COLUMNS: {
    STUDENT_NAME: 1,  // B列（生徒名）
    TYPE_A_SCORE: 6,  // G列（V：タイプA）
    TYPE_Q_SCORE: 8,  // I列（Q：タイプQ）
    TYPE_VQ_SCORE: 10, // K列（VQ：バランス）
    DIAGNOSIS_TYPE: 15, // P列（タイプ＋型）
    OVERVIEW: 18,      // S列（概要）
    DETAILS: 19        // T列（詳細）
  }
};

/**
 * VQ診断結果を取得してサーバーに送信
 */
function syncVQDiagnosisResults() {
  const startTime = new Date();
  Logger.log('🔄 VQ診断結果の同期を開始します...');
  
  try {
    // システムが有効かチェック
    const isEnabled = checkSystemEnabled();
    if (!isEnabled) {
      Logger.log('⚠️ VQ診断通知システムがOFFです。処理を中断します。');
      return {
        success: false,
        message: 'システムがOFFのため処理しません'
      };
    }
    
    // スプレッドシートから診断結果を取得
    const results = loadVQDiagnosisResults();
    Logger.log(`📊 ${results.length}件の診断結果を取得しました`);
    
    if (results.length === 0) {
      Logger.log('ℹ️ 処理対象の診断結果がありません');
      return {
        success: true,
        message: '処理対象なし',
        count: 0
      };
    }
    
    // サーバーに送信
    const response = sendToServer(results);
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    Logger.log(`✅ VQ診断結果の同期が完了しました（${duration}秒）`);
    Logger.log(`📤 送信成功: ${response.processed}件、エラー: ${response.errors}件`);
    
    return response;
    
  } catch (error) {
    Logger.log(`❌ エラーが発生しました: ${error.message}`);
    Logger.log(error.stack);
    throw error;
  }
}

/**
 * システムが有効かチェック（サーバーに問い合わせ）
 */
function checkSystemEnabled() {
  try {
    const url = `${CONFIG.WEBHOOK_URL.replace('/process', '/status')}`;
    const options = {
      method: 'get',
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    
    return data.enabled === true;
    
  } catch (error) {
    Logger.log(`⚠️ システム状態の確認に失敗: ${error.message}`);
    // エラー時はOFFとみなす
    return false;
  }
}

/**
 * スプレッドシートからVQ診断結果を読み込む
 */
function loadVQDiagnosisResults() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  if (!sheet) {
    throw new Error(`シート「${CONFIG.SHEET_NAME}」が見つかりません`);
  }
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  // ヘッダー行をスキップ（1行目）
  const results = [];
  
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    
    // 生徒名が空の行はスキップ
    const studentName = String(row[CONFIG.COLUMNS.STUDENT_NAME] || '').trim();
    if (!studentName) {
      continue;
    }
    
    // 診断タイプが空の行はスキップ（まだ診断が完了していない）
    const diagnosisType = String(row[CONFIG.COLUMNS.DIAGNOSIS_TYPE] || '').trim();
    if (!diagnosisType) {
      continue;
    }
    
    // スコアを取得（数値に変換）
    const typeAScore = parseFloat(row[CONFIG.COLUMNS.TYPE_A_SCORE]) || 0;
    const typeQScore = parseFloat(row[CONFIG.COLUMNS.TYPE_Q_SCORE]) || 0;
    const typeVQScore = parseFloat(row[CONFIG.COLUMNS.TYPE_VQ_SCORE]) || 0;
    const totalScore = typeAScore + typeQScore + typeVQScore;
    
    // 概要と詳細を取得
    const overview = String(row[CONFIG.COLUMNS.OVERVIEW] || '').trim();
    const details = String(row[CONFIG.COLUMNS.DETAILS] || '').trim();
    
    results.push({
      studentName,
      totalScore,
      typeAScore,
      typeQScore,
      typeVQScore,
      diagnosisType,
      overview,
      details,
      rowNumber: i + 1 // スプレッドシートの行番号（1始まり）
    });
  }
  
  return results;
}

/**
 * サーバーに診断結果を送信
 */
function sendToServer(results) {
  const url = CONFIG.WEBHOOK_URL;
  
  const payload = {
    results: results,
    timestamp: new Date().toISOString(),
    source: 'gas'
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (statusCode !== 200) {
      throw new Error(`サーバーエラー: ${statusCode} - ${responseText}`);
    }
    
    const data = JSON.parse(responseText);
    return data;
    
  } catch (error) {
    Logger.log(`❌ サーバーへの送信に失敗: ${error.message}`);
    throw error;
  }
}

/**
 * 定期実行用トリガーをセットアップ（毎日1回実行）
 */
function setupDailyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncVQDiagnosisResults') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 新しいトリガーを作成（毎日午前9時に実行）
  ScriptApp.newTrigger('syncVQDiagnosisResults')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
    
  Logger.log('✅ 毎日午前9時に実行するトリガーを設定しました');
}

/**
 * すべてのトリガーを削除
 */
function deleteAllVQTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncVQDiagnosisResults') {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  
  Logger.log(`🗑️ ${count}個のトリガーを削除しました`);
}

/**
 * トリガー一覧を表示
 */
function listVQTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const vqTriggers = triggers.filter(t => t.getHandlerFunction() === 'syncVQDiagnosisResults');
  
  Logger.log(`📋 VQ診断同期のトリガー: ${vqTriggers.length}個`);
  
  vqTriggers.forEach((trigger, index) => {
    Logger.log(`${index + 1}. ${trigger.getHandlerFunction()} - ${trigger.getTriggerSource()}`);
  });
}

/**
 * 手動テスト用：スプレッドシートのデータを表示
 */
function testLoadVQData() {
  const results = loadVQDiagnosisResults();
  
  Logger.log(`📊 取得した診断結果: ${results.length}件`);
  
  results.forEach((result, index) => {
    Logger.log(`\n${index + 1}. ${result.studentName}`);
    Logger.log(`   タイプ: ${result.diagnosisType}`);
    Logger.log(`   合計点: ${result.totalScore} (A:${result.typeAScore}, Q:${result.typeQScore}, VQ:${result.typeVQScore})`);
    Logger.log(`   概要: ${result.overview.substring(0, 50)}...`);
  });
}
