import { query as dbQuery } from '../db/connection.js';
import { 
  fetchVQDiagnosisResults, 
  batchUpdateVQDiagnosisEmailStatus,
  fetchVQDiagnosisByStudentId
} from '../services/sheetsService.js';
import { sendDiscordVQDiagnosis } from '../services/discordService.js';
import { generateVQRadarChart, generateVQTrendChart } from '../services/chartService.js';

/**
 * VQ診断結果を定期的にチェックして送信
 * 5分に1回実行される
 */
export async function checkAndSendVQDiagnosis() {
  try {
    console.log("🔄 VQ診断チェック開始...");
    
    // システムが有効かチェック
    const statusResult = await dbQuery(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'vq_diagnosis_notification_enabled'`
    );
    
    const enabled = statusResult.rows[0]?.setting_value === 'true';
    
    if (!enabled) {
      console.log("⚠️ VQ診断通知システムがOFFのため処理をスキップします");
      return {
        success: false,
        message: 'システムがOFFです',
        processed: 0
      };
    }
    
    // 前回チェックした最終行を取得
    const lastCheckResult = await dbQuery(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'vq_diagnosis_last_checked_row'`
    );
    
    const lastCheckedRow = parseInt(lastCheckResult.rows[0]?.setting_value || '1');
    const startRow = lastCheckedRow + 1; // 次の行から開始（ただし最小値は2）
    const actualStartRow = Math.max(startRow, 2); // ヘッダーの次の行が最小
    
    console.log("[VQ diagnosis] Check range prepared");
    
    // スプレッドシートから新規診断結果を取得
    const { results, lastRow } = await fetchVQDiagnosisResults(actualStartRow);
    
    if (results.length === 0) {
      console.log("ℹ️ 新規の診断結果はありません");
      
      // 最終行が変わっていれば更新（行が削除された場合など）
      if (lastRow > 0 && lastRow !== lastCheckedRow) {
        await updateLastCheckedRow(lastRow);
      }
      
      return {
        success: true,
        message: '新規診断結果なし',
        processed: 0,
        errors: 0
      };
    }
    
    console.log("[VQ diagnosis] Diagnosis batch loaded");
    
    let processed = 0;
    let errors = 0;
    const updates = []; // R列更新用
    
    // 各診断結果を処理
    for (const result of results) {
      try {
        // デバッグ: スプレッドシートから取得したデータを確認
        console.log("[VQ diagnosis] Processing diagnosis");
        console.log("[VQ diagnosis] Student lookup requested");
        console.log("[VQ diagnosis] Diagnosis type loaded");
        console.log("[VQ diagnosis] Diagnosis date loaded");
        
        // 学籍番号から生徒情報を取得
        const studentResult = await dbQuery(
          `SELECT id, name, discord_url FROM students WHERE student_id = $1 LIMIT 1`,
          [result.studentId]
        );
        
        if (studentResult.rows.length === 0) {
          console.log("[VQ diagnosis] Student not found");
          console.log("[VQ diagnosis] Student lookup returned no rows");
          errors++;
          
          // エラーでも「完了」をマーク（無限ループ防止）
          updates.push({ rowNumber: result.rowNumber, value: '完了（生徒不明）' });
          
          // エラーをデータベースに記録
          await dbQuery(
            `INSERT INTO vq_diagnosis_notifications 
             (student_id, student_name, total_score, diagnosis_type, overview, details, diagnosis_date, status, error_message, sheet_row_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              null,
              result.studentId, // 学籍番号をnameに記録
              result.totalScore,
              result.diagnosisType,
              result.overview,
              result.details,
              result.diagnosisDate,
              'error',
              '生徒が見つかりません',
              result.rowNumber
            ]
          );
          
          continue;
        }
        
        const student = studentResult.rows[0];
        console.log("[VQ diagnosis] Student loaded");
        
        if (!student.discord_url) {
          console.log("[VQ diagnosis] Discord URL not configured");
          errors++;
          
          updates.push({ rowNumber: result.rowNumber, value: '完了（Discord URL未設定）' });
          
          await dbQuery(
            `INSERT INTO vq_diagnosis_notifications 
             (student_id, student_name, total_score, diagnosis_type, overview, details, diagnosis_date, status, error_message, sheet_row_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              student.id,
              student.name,
              result.totalScore,
              result.diagnosisType,
              result.overview,
              result.details,
              result.diagnosisDate,
              'error',
              'Discord URLが設定されていません',
              result.rowNumber
            ]
          );
          
          continue;
        }
        
        // 診断タイプに対応する画像URLを取得
        let typeImageUrl = null;
        try {
          const imageResult = await dbQuery(
            `SELECT image_url FROM vq_diagnosis_images WHERE diagnosis_type = $1`,
            [result.diagnosisType]
          );
          if (imageResult.rows.length > 0) {
            typeImageUrl = imageResult.rows[0].image_url;
            console.log("[VQ diagnosis] Type image loaded");
          }
        } catch (imageError) {
          console.warn("[VQ diagnosis] Type image lookup failed");
        }
        
        // 過去の診断履歴を取得（推移グラフ用）
        let historyData = [];
        try {
          historyData = await fetchVQDiagnosisByStudentId(result.studentId);
          console.log("[VQ diagnosis] Diagnosis history loaded");
        } catch (historyError) {
          console.warn("[VQ diagnosis] Diagnosis history lookup failed");
        }
        
        // レーダーチャート画像を生成
        let radarChartBuffer = null;
        try {
          radarChartBuffer = await generateVQRadarChart({
            snsAccuracy: result.snsAccuracy,
            streamingAccuracy: result.streamingAccuracy,
            revenueAccuracy: result.revenueAccuracy
          });
          console.log("[VQ diagnosis] Radar chart generated");
        } catch (chartError) {
          console.warn("[VQ diagnosis] Radar chart generation failed");
        }
        
        // 推移グラフ画像を生成（2件以上の場合）
        let trendChartBuffer = null;
        if (historyData.length >= 2) {
          try {
            trendChartBuffer = await generateVQTrendChart(historyData);
            console.log("[VQ diagnosis] Trend chart generated");
          } catch (trendError) {
            console.warn("[VQ diagnosis] Trend chart generation failed");
          }
        }
        
        // Discordに送信
        const message = formatVQDiagnosisMessage({
          studentName: student.name,
          totalScore: result.totalScore,
          diagnosisType: result.diagnosisType,
          overview: result.overview,
          details: result.details,
          diagnosisDate: result.diagnosisDate
        });
        
        // デバッグ: メッセージ内容をログ出力
        console.log("[VQ diagnosis] Message prepared");
        console.log("[VQ diagnosis] Message type prepared");
        console.log("[VQ diagnosis] Message overview prepared");
        console.log("[VQ diagnosis] Message details prepared");
        console.log("[VQ diagnosis] Message content prepared");
        
        const discordResponse = await sendDiscordVQDiagnosis(
          student.discord_url, 
          message,
          {
            radarChart: radarChartBuffer,
            trendChart: trendChartBuffer,
            typeImage: typeImageUrl
          }
        );
        
        // データベースに記録
        await dbQuery(
          `INSERT INTO vq_diagnosis_notifications 
           (student_id, student_name, total_score, diagnosis_type, overview, details, diagnosis_date, discord_message_id, status, sheet_row_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            student.id,
            student.name,
            result.totalScore,
            result.diagnosisType,
            result.overview,
            result.details,
            result.diagnosisDate,
            discordResponse?.id || null,
            'sent',
            result.rowNumber
          ]
        );
        
        // R列更新リストに追加
        updates.push({ rowNumber: result.rowNumber, value: '完了' });
        
        console.log("[VQ diagnosis] Discord message sent");
        processed++;
        
      } catch (error) {
        console.error("[VQ diagnosis] Diagnosis processing failed");
        errors++;
        
        // エラーでも「完了」をマーク（エラー詳細付き）
        updates.push({ 
          rowNumber: result.rowNumber, 
          value: '完了（エラー: 診断処理に失敗しました）'
        });
        
        // エラーをデータベースに記録
        try {
          await dbQuery(
            `INSERT INTO vq_diagnosis_notifications 
             (student_id, student_name, total_score, diagnosis_type, overview, details, diagnosis_date, status, error_message, sheet_row_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              null,
              result.studentId,
              result.totalScore,
              result.diagnosisType,
              result.overview,
              result.details,
              result.diagnosisDate,
              'error',
              'VQ diagnosis processing failed',
              result.rowNumber
            ]
          );
        } catch (dbError) {
          console.error("エラー記録の保存に失敗:");
        }
      }
    }
    
    // スプレッドシートのR列を一括更新
    if (updates.length > 0) {
      try {
        await batchUpdateVQDiagnosisEmailStatus(updates);
        console.log("[VQ diagnosis] Sheet statuses updated");
      } catch (updateError) {
        console.error("❌ スプレッドシート更新エラー:");
        // 更新失敗してもメイン処理は続行
      }
    }
    
    // 最終チェック行を更新
    if (lastRow > 0) {
      await updateLastCheckedRow(lastRow);
    }
    
    console.log("[VQ diagnosis] Diagnosis check completed");
    
    return {
      success: true,
      processed,
      errors,
      lastRow
    };
    
  } catch (error) {
    console.error("❌ VQ診断チェック全体エラー:");
    return {
      success: false,
      error: 'VQ diagnosis processing failed',
      processed: 0,
      errors: 0
    };
  }
}

/**
 * 最終チェック行を更新
 */
async function updateLastCheckedRow(rowNumber) {
  try {
    await dbQuery(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ('vq_diagnosis_last_checked_row', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
      [String(rowNumber)]
    );
    
    console.log("[VQ diagnosis] Last checked row updated");
  } catch (error) {
    console.error("❌ 最終チェック行の更新エラー:");
  }
}

/**
 * VQ診断結果をDiscordメッセージ形式にフォーマット
 */
function formatVQDiagnosisMessage(result) {
  // 概要と詳細を適切な長さに制限
  const maxOverviewLength = 500;
  const maxDetailsLength = 800;
  
  let overview = result.overview || '（概要なし）';
  let details = result.details || '（詳細なし）';
  
  // 長すぎる場合は切り詰める
  if (overview.length > maxOverviewLength) {
    overview = overview.substring(0, maxOverviewLength) + '...\n\n（続きはスプレッドシートをご確認ください）';
  }
  
  if (details.length > maxDetailsLength) {
    details = details.substring(0, maxDetailsLength) + '...\n\n（続きはスプレッドシートをご確認ください）';
  }
  
  // マークダウンで見やすくフォーマット
  // Discordマークダウン: # = h1, ## = h2, __text__ = アンダーライン
  
  // 概要と詳細の1行目にアンダーラインを追加
  const overviewWithUnderline = overview.split('\n').map((line, index) => {
    if (index === 0 && line.trim()) {
      return `__${line}__`;
    }
    return line;
  }).join('\n');
  
  const detailsWithUnderline = details.split('\n').map((line, index) => {
    if (index === 0 && line.trim()) {
      return `__${line}__`;
    }
    return line;
  }).join('\n');
  
  const messageContent = `# 【VQ診断結果】

## ・あなたのタイプ
${result.diagnosisType}

## ・概要
${overviewWithUnderline}

## ・詳細
${detailsWithUnderline}

---
📅 診断日: ${result.diagnosisDate || '（日付不明）'}
📊 合計点: ${result.totalScore}点`;

  // メッセージ長を確認
  if (messageContent.length > 1900) {
    console.warn("[VQ diagnosis] Message exceeds recommended length");
  } else {
    console.log("[VQ diagnosis] Message length checked");
  }

  return {
    content: messageContent
  };
}

export default checkAndSendVQDiagnosis;
