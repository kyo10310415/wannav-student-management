import axios from 'axios';
import { query } from '../db/connection.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { client as discordClient } from './discordService.js';

// ─── 定数 ─────────────────────────────────────────────────────────────────────
/** axios / discord.js 単体送信タイムアウト (ms) */
const SEND_TIMEOUT_MS = 15_000;

/** Discord Rate Limit (429) 発生時の最大リトライ回数 */
const MAX_RETRIES = 3;

/** 1件ごとのレート制限待機 (ms) — Discord 5req/s 対策 */
const RATE_LIMIT_DELAY_MS = 200;

/** 進捗をDBへ書き込む間隔 (件数) */
const PROGRESS_FLUSH_INTERVAL = 10;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get target students for broadcast
 */
export async function getTargetStudents(targetStatus, targetTutor, userEmail, userRole) {
  try {
    console.log('[Broadcast] getTargetStudents called with:', {
      targetStatus,
      targetTutor,
      userEmail,
      userRole
    });

    let sqlQuery = `
      SELECT s.student_id, s.name, s.status, s.homeroom_tutor, s.contract_plan
      FROM students s
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
    `;

    const params = [];
    const whereConditions = [];

    if (targetStatus === 'レッスン中') {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push('アクティブ');
      whereConditions.push(`(s.contract_plan IS NULL OR (s.contract_plan != $${params.length + 1} AND s.contract_plan != $${params.length + 2}))`);
      params.push('永久会員');
      params.push('在籍プラン');
    } else if (targetStatus === '永久会員') {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push('アクティブ');
      whereConditions.push(`s.contract_plan = $${params.length + 1}`);
      params.push('永久会員');
    } else {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push(targetStatus);
    }

    if (whereConditions.length > 0) {
      sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    if (userRole === 'crew') {
      sqlQuery += ` AND t.email = $${params.length + 1}`;
      params.push(userEmail);
    } else if (targetTutor && targetTutor !== 'all') {
      sqlQuery += ` AND s.homeroom_tutor = $${params.length + 1}`;
      params.push(targetTutor);
    }

    sqlQuery += ' ORDER BY s.student_id';

    const result = await query(sqlQuery, params);
    console.log(`[Broadcast] Found ${result.rows.length} target students`);
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting target students:', error);
    throw error;
  }
}

// ─── タイムアウト付き Promise ヘルパー ────────────────────────────────────────

/**
 * Promise にタイムアウトを付ける
 * @param {Promise} promise
 * @param {number}  ms       タイムアウトミリ秒
 * @param {string}  label    エラーメッセージ用ラベル
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── Webhook 送信 ─────────────────────────────────────────────────────────────

/**
 * Send broadcast message via webhook
 * リトライ付き（429 Rate Limit 対応）
 */
async function sendViaWebhook(webhookUrl, discordId, content, imageId) {
  console.log('[Broadcast] sendViaWebhook called with:', {
    webhookUrl: webhookUrl ? webhookUrl.substring(0, 50) + '...' : 'none',
    discordId: discordId || 'none',
    contentLength: content ? content.length : 0,
    hasImage: !!imageId,
    imageId: imageId || 'none'
  });

  const embed = {
    description: content,
    color: 0x5865F2,
    timestamp: new Date().toISOString()
  };

  const payload = { embeds: [embed] };
  if (discordId) payload.content = `<@${discordId}>`;

  // 画像付き送信
  if (imageId) {
    console.log('[Broadcast] Fetching image from database:', imageId);
    try {
      const imageResult = await query(
        'SELECT filename, content_type, image_data FROM broadcast_images WHERE image_id = $1',
        [imageId]
      );

      if (imageResult.rows.length > 0) {
        const imageData = imageResult.rows[0];
        console.log('[Broadcast] Attaching image from database:', {
          imageId,
          size: imageData.image_data.length,
          type: imageData.content_type,
          filename: imageData.filename
        });

        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('files[0]', imageData.image_data, {
          filename: imageData.filename,
          contentType: imageData.content_type
        });
        formData.append('payload_json', JSON.stringify(payload));

        console.log('[Broadcast] Sending webhook with file attachment');
        const response = await withTimeout(
          _axiosPostWithRetry(webhookUrl, formData, {
            headers: { ...formData.getHeaders() }
          }),
          SEND_TIMEOUT_MS,
          'sendViaWebhook (with image)'
        );
        console.log('[Broadcast] Webhook response status:', response.status);
        return { success: true };
      } else {
        console.warn('[Broadcast] Image not found in database:', imageId);
        // 画像なしで続行
      }
    } catch (imageError) {
      console.error('[Broadcast] Error fetching/attaching image:', imageError.message);
      // 画像なしで続行
    }
  }

  // 画像なし送信
  console.log('[Broadcast] Sending webhook without image');
  const response = await withTimeout(
    _axiosPostWithRetry(webhookUrl, payload, {}),
    SEND_TIMEOUT_MS,
    'sendViaWebhook (no image)'
  );
  console.log('[Broadcast] Webhook response status:', response.status);
  return { success: true };
}

/**
 * axios.post を 429 時に retry-after 待機してリトライするラッパー
 */
async function _axiosPostWithRetry(url, data, config) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios.post(url, data, { ...config, timeout: SEND_TIMEOUT_MS });
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 429) {
        const retryAfterSec = parseFloat(err.response?.headers?.['retry-after'] || '1');
        const waitMs = Math.ceil(retryAfterSec * 1000) + 200;
        console.warn(`[Broadcast] 429 Rate Limit. Waiting ${waitMs}ms before retry (attempt ${attempt}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        // 429 以外のエラーはリトライしない
        throw err;
      }
    }
  }
  throw lastError;
}

// ─── Bot 送信 ─────────────────────────────────────────────────────────────────

/**
 * Send broadcast message via Discord bot
 * タイムアウト付き
 */
async function sendViaBot(chatUrl, discordId, content, imageId) {
  const channelIdMatch = chatUrl.match(/channels\/\d+\/(\d+)/);
  if (!channelIdMatch) throw new Error('Invalid chat URL format');

  const channelId = channelIdMatch[1];

  const channel = await withTimeout(
    discordClient.channels.fetch(channelId),
    SEND_TIMEOUT_MS,
    `channels.fetch(${channelId})`
  );

  if (!channel) throw new Error('Channel not found');

  let messageContent = '';
  if (discordId) messageContent += `<@${discordId}>\n`;
  messageContent += content;

  const messageOptions = { content: messageContent };

  if (imageId) {
    console.log('[Broadcast] Bot: Fetching image from database:', imageId);
    try {
      const imageResult = await query(
        'SELECT filename, content_type, image_data FROM broadcast_images WHERE image_id = $1',
        [imageId]
      );
      if (imageResult.rows.length > 0) {
        const imageData = imageResult.rows[0];
        console.log('[Broadcast] Bot: Attaching image from database:', {
          imageId,
          size: imageData.image_data.length,
          type: imageData.content_type,
          filename: imageData.filename
        });
        messageOptions.files = [{
          attachment: imageData.image_data,
          name: imageData.filename
        }];
      } else {
        console.warn('[Broadcast] Bot: Image not found in database:', imageId);
      }
    } catch (imageError) {
      console.error('[Broadcast] Bot: Error fetching image:', imageError.message);
      // 画像なしで続行
    }
  }

  await withTimeout(
    channel.send(messageOptions),
    SEND_TIMEOUT_MS,
    `channel.send(${channelId})`
  );

  return { success: true };
}

// ─── スケジューラー互換ラッパー ───────────────────────────────────────────────

export async function sendBroadcast(messageData, targetStudents, userEmail) {
  const { jobId } = await enqueueBroadcast(messageData, targetStudents, userEmail);

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    const job = await getBroadcastJobStatus(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') {
      return {
        success: job?.status === 'completed',
        results: {
          total:  job?.total  ?? 0,
          sent:   job?.sent   ?? 0,
          failed: job?.failed ?? 0,
          errors: []
        }
      };
    }
  }
}

// ─── ジョブエンキュー ─────────────────────────────────────────────────────────

export async function enqueueBroadcast(messageData, targetStudents, userEmail) {
  const { content, imageId, channelType, name, saveAsTemplate, isTest } = messageData;

  const insertResult = await query(
    `INSERT INTO broadcast_messages
      (name, content, image_url, channel_type, target_status, target_tutor, created_by, is_template, last_sent_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    RETURNING id`,
    [
      name || `Broadcast ${new Date().toISOString()}`,
      content,
      imageId || null,
      channelType,
      messageData.targetStatus || 'active',
      messageData.targetTutor || null,
      userEmail,
      saveAsTemplate || false
    ]
  );
  const broadcastId = insertResult.rows[0].id;

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const total = isTest ? 1 : targetStudents.length;

  await query(
    `INSERT INTO broadcast_jobs (job_id, broadcast_id, status, total, sent, failed, is_test, created_by)
     VALUES ($1, $2, 'pending', $3, 0, 0, $4, $5)`,
    [jobId, broadcastId, total, isTest, userEmail]
  );

  // バックグラウンドで送信開始（await しない）
  _runBroadcastJob(jobId, broadcastId, messageData, targetStudents, userEmail).catch(err => {
    console.error(`[Broadcast] Background job ${jobId} crashed:`, err.message);
  });

  return { jobId, broadcastId, total };
}

// ─── ジョブ進捗取得 ───────────────────────────────────────────────────────────

export async function getBroadcastJobStatus(jobId) {
  const result = await query(
    `SELECT job_id, broadcast_id, status, total, sent, failed, is_test, created_at, updated_at
     FROM broadcast_jobs WHERE job_id = $1`,
    [jobId]
  );
  return result.rows[0] || null;
}

// ─── バックグラウンド送信ジョブ ───────────────────────────────────────────────

async function _runBroadcastJob(jobId, broadcastId, messageData, targetStudents, userEmail) {
  const { content, imageId, channelType, isTest } = messageData;

  await query(
    `UPDATE broadcast_jobs SET status = 'running', updated_at = NOW() WHERE job_id = $1`,
    [jobId]
  );

  try {
    // ── テストモード ──────────────────────────────────────────────────────
    if (isTest) {
      console.log(`[Broadcast Job ${jobId}] Test mode`);
      const testWebhookUrl = 'https://discord.com/api/webhooks/1282616705817903146/M4KSUtmoHYSDqySMBgtgjU0wZywkUkVtfh3KOOA-BNzgXMnwVnEphKwuleMXhFn60MYd';
      const testDiscordId  = '766666980086120470';

      try {
        await sendViaWebhook(testWebhookUrl, testDiscordId, content, imageId);
        await logBroadcastSend(broadcastId, { student_id: 'TEST', name: 'Test User' }, channelType, testWebhookUrl, 'sent', null);
        await query(
          `UPDATE broadcast_jobs SET status = 'completed', sent = 1, failed = 0, updated_at = NOW() WHERE job_id = $1`,
          [jobId]
        );
      } catch (err) {
        await logBroadcastSend(broadcastId, { student_id: 'TEST', name: 'Test User' }, channelType, testWebhookUrl, 'failed', err.message);
        await query(
          `UPDATE broadcast_jobs SET status = 'completed', sent = 0, failed = 1, updated_at = NOW() WHERE job_id = $1`,
          [jobId]
        );
      }
      return;
    }

    // ── 通常モード ────────────────────────────────────────────────────────
    console.log(`[Broadcast Job ${jobId}] Fetching student broadcast info from sheets...`);
    const studentBroadcastInfo = await fetchStudentBroadcastInfo();
    const broadcastInfoMap = new Map(studentBroadcastInfo.map(s => [s.studentId, s]));
    console.log(`[Broadcast Job ${jobId}] Sheet data loaded: ${studentBroadcastInfo.length} records`);

    let sent   = 0;
    let failed = 0;

    for (let i = 0; i < targetStudents.length; i++) {
      const student = targetStudents[i];

      // ── 進捗ログ（50件ごと） ─────────────────────────────────────────
      if (i > 0 && i % 50 === 0) {
        console.log(`[Broadcast Job ${jobId}] Progress: ${i}/${targetStudents.length} processed (sent=${sent}, failed=${failed})`);
      }

      const broadcastInfo = broadcastInfoMap.get(student.student_id);

      if (!broadcastInfo) {
        console.log(`[Broadcast Job ${jobId}] No broadcast info for ${student.student_id} (${student.name})`);
        failed++;
        await logBroadcastSend(broadcastId, student, channelType, null, 'failed', 'No broadcast info found');
      } else {
        let webhookUrl = null;
        if      (channelType === 'notice') webhookUrl = broadcastInfo.noticeWebhook;
        else if (channelType === 'tips')   webhookUrl = broadcastInfo.tipsWebhook;
        else if (channelType === 'anken')  webhookUrl = broadcastInfo.ankenWebhook;
        else if (channelType === 'chat')   webhookUrl = broadcastInfo.chatUrl;

        if (!webhookUrl) {
          console.log(`[Broadcast Job ${jobId}] No ${channelType} URL for ${student.student_id} (${student.name})`);
          failed++;
          await logBroadcastSend(broadcastId, student, channelType, null, 'failed', `No ${channelType} URL`);
        } else {
          try {
            if (channelType === 'chat') {
              await sendViaBot(webhookUrl, broadcastInfo.discordId, content, imageId);
            } else {
              await sendViaWebhook(webhookUrl, broadcastInfo.discordId, content, imageId);
            }
            sent++;
            await logBroadcastSend(broadcastId, student, channelType, webhookUrl, 'sent', null);
          } catch (err) {
            console.error(`[Broadcast Job ${jobId}] Error sending to ${student.student_id} (${student.name}): ${err.message}`);
            failed++;
            await logBroadcastSend(broadcastId, student, channelType, webhookUrl, 'failed', err.message);
          }
        }
      }

      // 進捗をDBへ書き込み（PROGRESS_FLUSH_INTERVAL 件ごと）
      if ((sent + failed) % PROGRESS_FLUSH_INTERVAL === 0) {
        await query(
          `UPDATE broadcast_jobs SET sent = $1, failed = $2, updated_at = NOW() WHERE job_id = $3`,
          [sent, failed, jobId]
        );
      }

      // レート制限待機
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    // 完了
    await query(
      `UPDATE broadcast_jobs SET status = 'completed', sent = $1, failed = $2, updated_at = NOW() WHERE job_id = $3`,
      [sent, failed, jobId]
    );
    console.log(`[Broadcast Job ${jobId}] Completed: ${sent}/${targetStudents.length} sent, ${failed} failed`);

  } catch (err) {
    console.error(`[Broadcast Job ${jobId}] Fatal error:`, err.message);
    await query(
      `UPDATE broadcast_jobs SET status = 'failed', updated_at = NOW() WHERE job_id = $1`,
      [jobId]
    ).catch(() => {});
  }
}

// ─── ログ記録 ─────────────────────────────────────────────────────────────────

async function logBroadcastSend(broadcastId, student, channelType, webhookUrl, status, errorMessage) {
  try {
    await query(
      `INSERT INTO broadcast_logs
        (broadcast_message_id, student_id, student_name, channel_type, webhook_url, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        broadcastId,
        student.student_id,
        student.name,
        channelType,
        webhookUrl,
        status,
        errorMessage
      ]
    );
  } catch (error) {
    console.error('[Broadcast] Error logging send:', error);
  }
}

// ─── テンプレート ─────────────────────────────────────────────────────────────

export async function getTemplates(userEmail, userRole) {
  try {
    let sqlQuery = `
      SELECT id, name, content, image_url, channel_type, target_tutor, created_at, last_sent_at
      FROM broadcast_messages
      WHERE is_template = true
    `;
    const params = [];
    if (userRole === 'crew') {
      sqlQuery += ' AND created_by = $1';
      params.push(userEmail);
    }
    sqlQuery += ' ORDER BY created_at DESC';
    const result = await query(sqlQuery, params);
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting templates:', error);
    throw error;
  }
}

export async function saveTemplate(templateData, userEmail) {
  try {
    const { id, name, content, imageUrl, channelType, targetTutor } = templateData;
    if (id) {
      await query(
        `UPDATE broadcast_messages
        SET name = $1, content = $2, image_url = $3, channel_type = $4, target_tutor = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND created_by = $7`,
        [name, content, imageUrl, channelType, targetTutor, id, userEmail]
      );
      return { success: true, id };
    } else {
      const result = await query(
        `INSERT INTO broadcast_messages
          (name, content, image_url, channel_type, target_tutor, created_by, is_template)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id`,
        [name, content, imageUrl, channelType, targetTutor, userEmail]
      );
      return { success: true, id: result.rows[0].id };
    }
  } catch (error) {
    console.error('[Broadcast] Error saving template:', error);
    throw error;
  }
}

export async function deleteTemplate(templateId, userEmail, userRole) {
  try {
    let sqlQuery = 'DELETE FROM broadcast_messages WHERE id = $1 AND is_template = true';
    const params = [templateId];
    if (userRole === 'crew') {
      sqlQuery += ' AND created_by = $2';
      params.push(userEmail);
    }
    await query(sqlQuery, params);
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Error deleting template:', error);
    throw error;
  }
}

// ─── ログ取得 ─────────────────────────────────────────────────────────────────

export async function getBroadcastLogs(broadcastId = null, limit = 100) {
  try {
    let sqlQuery = `
      SELECT
        bl.id,
        bl.broadcast_message_id,
        bm.name as message_name,
        bl.student_id,
        bl.student_name,
        bl.channel_type,
        bl.status,
        bl.error_message,
        bl.sent_at
      FROM broadcast_logs bl
      LEFT JOIN broadcast_messages bm ON bl.broadcast_message_id = bm.id
    `;
    const params = [];
    if (broadcastId) {
      sqlQuery += ' WHERE bl.broadcast_message_id = $1';
      params.push(broadcastId);
    }
    sqlQuery += ' ORDER BY bl.sent_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const result = await query(sqlQuery, params);
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting logs:', error);
    throw error;
  }
}
