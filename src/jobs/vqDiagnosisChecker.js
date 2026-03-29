import { query as dbQuery } from '../db/connection.js';
import { 
  fetchVQDiagnosisResults, 
  batchUpdateVQDiagnosisEmailStatus 
} from '../services/sheetsService.js';
import { sendDiscordVQDiagnosis } from '../services/discordService.js';

/**
 * VQ診断結果を定期的にチェックして送信
 * 5分に1回実行される
 */
export async function checkAndSendVQDiagnosis() {
  try {
    console.log('🔄 VQ診断チェック開始...');
    
    // システムが有効かチェック
    const statusResult = await dbQuery(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'vq_diagnosis_notification_enabled'`
    );
    
    const enabled = statusResult.rows[0]?.setting_value === 'true';
    
    if (!enabled) {
      console.log('⚠️ VQ診断通知システムがOFFのため処理をスキップします');
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
    
    console.log(`📊 前回チェック最終行: ${lastCheckedRow}, 開始行: ${actualStartRow}`);
    
    // スプレッドシートから新規診断結果を取得
    const { results, lastRow } = await fetchVQDiagnosisResults(actualStartRow);
    
    if (results.length === 0) {
      console.log('ℹ️ 新規の診断結果はありません');
      
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
    
    console.log(`📋 処理対象: ${results.length}件`);
    
    let processed = 0;
    let errors = 0;
    const updates = []; // R列更新用
    
    // 各診断結果を処理
    for (const result of results) {
      try {
        // 学籍番号から生徒情報を取得
        const studentResult = await dbQuery(
          `SELECT id, name, discord_url FROM students WHERE student_id = $1 LIMIT 1`,
          [result.studentId]
        );
        
        if (studentResult.rows.length === 0) {
          console.log(`⚠️ 生徒が見つかりません: ${result.studentId} (行 ${result.rowNumber})`);
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
        
        if (!student.discord_url) {
          console.log(`⚠️ Discord URLが設定されていません: ${student.name} (${result.studentId})`);
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
        let imageUrl = null;
        try {
          const imageResult = await dbQuery(
            `SELECT image_url FROM vq_diagnosis_images WHERE diagnosis_type = $1`,
            [result.diagnosisType]
          );
          if (imageResult.rows.length > 0) {
            imageUrl = imageResult.rows[0].image_url;
            console.log(`📷 診断タイプ「${result.diagnosisType}」の画像を取得: ${imageUrl}`);
          }
        } catch (imageError) {
          console.warn(`⚠️ 画像URL取得エラー: ${imageError.message}`);
        }
        
        // Discordに送信
        const message = formatVQDiagnosisMessage({
          studentName: student.name,
          totalScore: result.totalScore,
          diagnosisType: result.diagnosisType,
          overview: result.overview,
          details: result.details,
          diagnosisDate: result.diagnosisDate,
          imageUrl
        });
        
        const discordResponse = await sendDiscordVQDiagnosis(student.discord_url, message);
        
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
        
        console.log(`✅ Discord送信成功: ${student.name} (${result.studentId}) - 行 ${result.rowNumber}`);
        processed++;
        
      } catch (error) {
        console.error(`❌ 処理エラー (${result.studentId}, 行 ${result.rowNumber}):`, error);
        errors++;
        
        // エラーでも「完了」をマーク（エラー詳細付き）
        updates.push({ 
          rowNumber: result.rowNumber, 
          value: `完了（エラー: ${error.message.substring(0, 20)}）` 
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
              error.message,
              result.rowNumber
            ]
          );
        } catch (dbError) {
          console.error('エラー記録の保存に失敗:', dbError);
        }
      }
    }
    
    // スプレッドシートのR列を一括更新
    if (updates.length > 0) {
      try {
        await batchUpdateVQDiagnosisEmailStatus(updates);
        console.log(`📝 スプレッドシート更新: ${updates.length}行`);
      } catch (updateError) {
        console.error('❌ スプレッドシート更新エラー:', updateError);
        // 更新失敗してもメイン処理は続行
      }
    }
    
    // 最終チェック行を更新
    if (lastRow > 0) {
      await updateLastCheckedRow(lastRow);
    }
    
    console.log(`✅ VQ診断チェック完了: 成功 ${processed}件、エラー ${errors}件`);
    
    return {
      success: true,
      processed,
      errors,
      lastRow
    };
    
  } catch (error) {
    console.error('❌ VQ診断チェック全体エラー:', error);
    return {
      success: false,
      error: error.message,
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
    
    console.log(`📌 最終チェック行を更新: ${rowNumber}`);
  } catch (error) {
    console.error('❌ 最終チェック行の更新エラー:', error);
  }
}

/**
 * VQ診断結果をDiscordメッセージ形式にフォーマット
 */
function formatVQDiagnosisMessage(result) {
  const embed = {
    title: '🎯 VQ診断結果',
    color: 0x9333EA, // 紫色
    fields: [
      {
        name: '📅 診断日',
        value: result.diagnosisDate || '（日付不明）',
        inline: true
      },
      {
        name: '📊 合計点',
        value: `**${result.totalScore}点**`,
        inline: true
      },
      {
        name: '🏷️ あなたのタイプ',
        value: `**${result.diagnosisType}**`,
        inline: false
      },
      {
        name: '📝 概要',
        value: result.overview || '（概要なし）',
        inline: false
      },
      {
        name: '📖 詳細',
        value: result.details || '（詳細なし）',
        inline: false
      }
    ],
    footer: {
      text: `送信日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
    }
  };
  
  // 画像URLがあればembedに追加
  if (result.imageUrl) {
    embed.image = {
      url: result.imageUrl
    };
  }
  
  return {
    content: `お疲れ様です！\n\n**VQ診断の結果が出ました！**`,
    embeds: [embed]
  };
}

export default checkAndSendVQDiagnosis;
