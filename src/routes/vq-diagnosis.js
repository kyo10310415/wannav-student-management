import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { query as dbQuery } from '../db/connection.js';
import { sendDiscordVQDiagnosis } from '../services/discordService.js';
import { fetchVQDiagnosisByStudentId } from '../services/sheetsService.js';

const app = new Hono();

// CORS設定
app.use('/*', cors());

/**
 * GET /api/vq-diagnosis/status
 * システムの有効/無効状態を取得
 */
app.get('/status', async (c) => {
  try {
    const result = await dbQuery(
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
    
    await dbQuery(
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
 * POST /api/vq-diagnosis/check
 * 手動でVQ診断結果をチェックして送信（テスト用）
 */
app.post('/check', async (c) => {
  try {
    const checkAndSendVQDiagnosis = (await import('../jobs/vqDiagnosisChecker.js')).default;
    const result = await checkAndSendVQDiagnosis();
    
    return c.json(result);
    
  } catch (error) {
    console.error('❌ VQ診断チェックエラー:', error);
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
    const studentId = c.req.query('student_id'); // 学籍番号でフィルター（オプション）
    
    let query = `
      SELECT 
        vqd.*,
        s.student_id as student_id_code,
        s.name as student_name_current,
        s.discord_url
       FROM vq_diagnosis_notifications vqd
       LEFT JOIN students s ON vqd.student_id = s.id
    `;
    
    const params = [];
    
    if (studentId) {
      query += ` WHERE s.student_id = $1`;
      params.push(studentId);
      query += ` ORDER BY vqd.sent_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      query += ` ORDER BY vqd.sent_at DESC LIMIT $1`;
      params.push(limit);
    }
    
    const result = await dbQuery(query, params);
    
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
 * GET /api/vq-diagnosis/student/:studentId
 * 特定の生徒のVQ診断履歴を取得（学籍番号で検索）
 * スプレッドシートから直接取得（R列の状態に関係なく全レコード）
 */
app.get('/student/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    
    console.log(`📊 VQ診断履歴取得: ${studentId}`);
    
    // スプレッドシートから直接取得
    const results = await fetchVQDiagnosisByStudentId(studentId);
    
    // 生徒名を取得
    let studentName = null;
    if (results.length > 0) {
      const studentResult = await dbQuery(
        `SELECT name FROM students WHERE student_id = $1 LIMIT 1`,
        [studentId]
      );
      studentName = studentResult.rows[0]?.name || studentId;
    }
    
    // レスポンス用にフォーマット
    const history = results.map(result => ({
      student_name: studentName,
      diagnosis_date: result.diagnosisDate,
      total_score: result.totalScore,
      diagnosis_type: result.diagnosisType,
      overview: result.overview,
      details: result.details,
      status: result.emailSent === '完了' ? 'sent' : 'pending',
      sent_at: result.diagnosisDate, // 診断日を送信日として使用
      sheet_row_number: result.rowNumber
    }));
    
    console.log(`✅ 取得件数: ${history.length}件 (${studentId})`);
    
    return c.json({
      success: true,
      count: history.length,
      history,
      studentId
    });
    
  } catch (error) {
    console.error('❌ 生徒別履歴取得エラー:', error);
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
    const result = await dbQuery(
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
    await dbQuery(
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
