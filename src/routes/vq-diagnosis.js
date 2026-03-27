import { Hono } from 'hono';
import { cors } from 'hono/cors';
import db from '../db/index.js';
import { sendDiscordVQDiagnosis } from '../services/discordService.js';

const app = new Hono();

// CORS設定
app.use('/*', cors());

/**
 * GET /api/vq-diagnosis/status
 * システムの有効/無効状態を取得
 */
app.get('/status', async (c) => {
  try {
    const result = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'vq_diagnosis_notification_enabled'`
    );
    
    const enabled = result.rows[0]?.setting_value === 'true';
    
    return c.json({
      success: true,
      enabled
    });
    
  } catch (error) {
    console.error('❌ システム状態の取得エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/vq-diagnosis/toggle
 * システムの有効/無効を切り替え
 */
app.post('/toggle', async (c) => {
  try {
    const { enabled } = await c.req.json();
    
    await db.query(
      `UPDATE system_settings 
       SET setting_value = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE setting_key = 'vq_diagnosis_notification_enabled'`,
      [enabled ? 'true' : 'false']
    );
    
    console.log(`✅ VQ診断通知システムを${enabled ? 'ON' : 'OFF'}にしました`);
    
    return c.json({
      success: true,
      enabled
    });
    
  } catch (error) {
    console.error('❌ システム状態の更新エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/vq-diagnosis/process
 * GASからのWebhook：VQ診断結果を受信してDiscordに送信
 */
app.post('/process', async (c) => {
  try {
    const { results, timestamp } = await c.req.json();
    
    console.log(`📥 VQ診断結果を受信: ${results.length}件 (${timestamp})`);
    
    // システムが有効かチェック
    const statusResult = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'vq_diagnosis_notification_enabled'`
    );
    
    const enabled = statusResult.rows[0]?.setting_value === 'true';
    
    if (!enabled) {
      console.log('⚠️ VQ診断通知システムがOFFのため処理をスキップします');
      return c.json({
        success: false,
        message: 'システムがOFFです',
        processed: 0,
        errors: 0
      });
    }
    
    let processed = 0;
    let errors = 0;
    const errorDetails = [];
    
    // 各診断結果を処理
    for (const result of results) {
      try {
        // 生徒情報を取得
        const studentResult = await db.query(
          `SELECT id, discord_url FROM students WHERE name = $1 LIMIT 1`,
          [result.studentName]
        );
        
        if (studentResult.rows.length === 0) {
          console.log(`⚠️ 生徒が見つかりません: ${result.studentName}`);
          errors++;
          errorDetails.push({
            studentName: result.studentName,
            error: '生徒が見つかりません'
          });
          continue;
        }
        
        const student = studentResult.rows[0];
        
        if (!student.discord_url) {
          console.log(`⚠️ Discord URLが設定されていません: ${result.studentName}`);
          errors++;
          errorDetails.push({
            studentName: result.studentName,
            error: 'Discord URLが設定されていません'
          });
          continue;
        }
        
        // 既に送信済みか確認（同じ生徒に対して重複送信を防ぐ）
        const existingResult = await db.query(
          `SELECT id FROM vq_diagnosis_notifications 
           WHERE student_id = $1 
           AND diagnosis_type = $2 
           AND sent_at > NOW() - INTERVAL '30 days'`,
          [student.id, result.diagnosisType]
        );
        
        if (existingResult.rows.length > 0) {
          console.log(`ℹ️ 既に送信済み: ${result.studentName} (${result.diagnosisType})`);
          continue;
        }
        
        // Discordに送信
        const message = formatVQDiagnosisMessage(result);
        const discordResponse = await sendDiscordVQDiagnosis(student.discord_url, message);
        
        // データベースに記録
        await db.query(
          `INSERT INTO vq_diagnosis_notifications 
           (student_id, student_name, total_score, diagnosis_type, overview, details, discord_message_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            student.id,
            result.studentName,
            result.totalScore,
            result.diagnosisType,
            result.overview,
            result.details,
            discordResponse?.id || null,
            'sent'
          ]
        );
        
        console.log(`✅ Discord送信成功: ${result.studentName} (${result.diagnosisType})`);
        processed++;
        
      } catch (error) {
        console.error(`❌ 処理エラー (${result.studentName}):`, error);
        errors++;
        errorDetails.push({
          studentName: result.studentName,
          error: error.message
        });
        
        // エラーをデータベースに記録
        try {
          const studentResult = await db.query(
            `SELECT id FROM students WHERE name = $1 LIMIT 1`,
            [result.studentName]
          );
          
          if (studentResult.rows.length > 0) {
            await db.query(
              `INSERT INTO vq_diagnosis_notifications 
               (student_id, student_name, total_score, diagnosis_type, overview, details, status, error_message)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                studentResult.rows[0].id,
                result.studentName,
                result.totalScore,
                result.diagnosisType,
                result.overview,
                result.details,
                'error',
                error.message
              ]
            );
          }
        } catch (dbError) {
          console.error('エラー記録の保存に失敗:', dbError);
        }
      }
    }
    
    console.log(`📊 処理完了: 成功 ${processed}件、エラー ${errors}件`);
    
    return c.json({
      success: true,
      processed,
      errors,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined
    });
    
  } catch (error) {
    console.error('❌ VQ診断処理エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/vq-diagnosis/history
 * 送信履歴を取得
 */
app.get('/history', async (c) => {
  try {
    const limit = c.req.query('limit') || '100';
    
    const result = await db.query(
      `SELECT 
        vqd.*,
        s.name as student_name_current,
        s.discord_url
       FROM vq_diagnosis_notifications vqd
       LEFT JOIN students s ON vqd.student_id = s.id
       ORDER BY vqd.sent_at DESC
       LIMIT $1`,
      [limit]
    );
    
    return c.json({
      success: true,
      count: result.rows.length,
      history: result.rows
    });
    
  } catch (error) {
    console.error('❌ 履歴取得エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/vq-diagnosis/resend/:id
 * 特定の診断結果を再送信
 */
app.post('/resend/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    // 診断結果を取得
    const result = await db.query(
      `SELECT vqd.*, s.discord_url 
       FROM vq_diagnosis_notifications vqd
       LEFT JOIN students s ON vqd.student_id = s.id
       WHERE vqd.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: '診断結果が見つかりません'
      }, 404);
    }
    
    const diagnosis = result.rows[0];
    
    if (!diagnosis.discord_url) {
      return c.json({
        success: false,
        error: 'Discord URLが設定されていません'
      }, 400);
    }
    
    // メッセージを作成して送信
    const message = formatVQDiagnosisMessage({
      studentName: diagnosis.student_name,
      totalScore: diagnosis.total_score,
      diagnosisType: diagnosis.diagnosis_type,
      overview: diagnosis.overview,
      details: diagnosis.details
    });
    
    const discordResponse = await sendDiscordVQDiagnosis(diagnosis.discord_url, message);
    
    // 送信履歴を更新
    await db.query(
      `UPDATE vq_diagnosis_notifications 
       SET discord_message_id = $1, 
           sent_at = CURRENT_TIMESTAMP,
           status = 'sent',
           error_message = NULL
       WHERE id = $2`,
      [discordResponse?.id || null, id]
    );
    
    console.log(`✅ 再送信成功: ${diagnosis.student_name}`);
    
    return c.json({
      success: true,
      message: '再送信しました'
    });
    
  } catch (error) {
    console.error('❌ 再送信エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * VQ診断結果をDiscordメッセージ形式にフォーマット
 */
function formatVQDiagnosisMessage(result) {
  return {
    content: `お疲れ様です！\n\n**VQ診断の結果が出ました！**`,
    embeds: [{
      title: '🎯 VQ診断結果',
      color: 0x9333EA, // 紫色
      fields: [
        {
          name: '📊 合計点',
          value: `**${result.totalScore}点**`,
          inline: false
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
        text: `診断日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
      }
    }]
  };
}

export default app;
