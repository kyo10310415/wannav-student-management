import axios from 'axios';
import FormData from 'form-data';
import { getClient, query } from '../db/connection.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { client as discordClient } from './discordService.js';
import { classifyLegacyBroadcastRecipients } from '../utils/broadcastRecovery.js';

// ─── 定数 ─────────────────────────────────────────────────────────────────────
/** axios / discord.js 単体送信タイムアウト (ms) */
const SEND_TIMEOUT_MS = 15_000;

/** Discord Rate Limit (429) 発生時の最大リトライ回数 */
const MAX_RETRIES = 3;

/** 1件ごとのレート制限待機 (ms) — Discord 5req/s 対策 */
const RATE_LIMIT_DELAY_MS = 200;

/** この時間更新されなかった実行中ジョブは中断扱いにする */
const STALE_JOB_INTERVAL = '5 minutes';
const STALE_PENDING_JOB_INTERVAL = '30 seconds';

/** 同一プロセス内で同じジョブを二重起動しない */
const activeBroadcastJobs = new Set();

/** GAS 専用一斉送信の作成者識別子 */
export const GAS_BROADCAST_CREATED_BY = 'gas-broadcast';

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
    } else if (targetStatus === 'エントリープラン') {
      // エントリープラン: (アクティブ OR レッスン準備中) AND contract_plan = 'エントリープラン'
      whereConditions.push(`s.status IN ($${params.length + 1}, $${params.length + 2})`);
      params.push('アクティブ');
      params.push('レッスン準備中');
      whereConditions.push(`s.contract_plan = $${params.length + 1}`);
      params.push('エントリープラン');
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

class DeliveryUncertainError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'DeliveryUncertainError';
    this.deliveryUncertain = true;
  }
}

// ─── Webhook 送信 ─────────────────────────────────────────────────────────────

/**
 * Send broadcast message via webhook
 * リトライ付き（429 Rate Limit 対応）
 */
async function sendViaWebhook(webhookUrl, discordId, content, imageData) {
  console.log('[Broadcast] sendViaWebhook called with:', {
    hasWebhookUrl: !!webhookUrl,
    discordId: discordId || 'none',
    contentLength: content ? content.length : 0,
    hasImage: !!imageData
  });

  const embed = {
    description: content,
    color: 0x5865F2,
    timestamp: new Date().toISOString()
  };

  const payload = { embeds: [embed] };
  if (discordId) payload.content = `<@${discordId}>`;

  if (imageData) {
    console.log('[Broadcast] Sending webhook with file attachment');
    const response = await _axiosPostWithRetry(
      webhookUrl,
      () => {
        const formData = new FormData();
        formData.append('files[0]', imageData.image_data, {
          filename: imageData.filename,
          contentType: imageData.content_type
        });
        formData.append('payload_json', JSON.stringify(payload));
        return {
          data: formData,
          config: { headers: { ...formData.getHeaders() } }
        };
      },
      'sendViaWebhook (with image)'
    );
    console.log('[Broadcast] Webhook response status:', response.status);
    return { success: true };
  }

  // 画像なし送信
  console.log('[Broadcast] Sending webhook without image');
  const response = await _axiosPostWithRetry(
    webhookUrl,
    () => ({ data: payload, config: {} }),
    'sendViaWebhook (no image)'
  );
  console.log('[Broadcast] Webhook response status:', response.status);
  return { success: true };
}

/**
 * axios.post を 429 時に retry-after 待機してリトライするラッパー
 */
async function _axiosPostWithRetry(url, requestFactory, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const { data, config } = await requestFactory();
      return await axios.post(url, data, {
        ...config,
        signal: controller.signal,
        timeout: SEND_TIMEOUT_MS
      });
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 429) {
        const retryAfterSec = parseFloat(err.response?.headers?.['retry-after'] || '1');
        const waitMs = Math.ceil(retryAfterSec * 1000) + 200;
        console.warn(`[Broadcast] 429 Rate Limit. Waiting ${waitMs}ms before retry (attempt ${attempt}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, waitMs));
      } else if (!err.response) {
        // タイムアウトや接続断は、Discord側だけ成功している可能性がある。
        // 重複防止のため「失敗」ではなく送達不明として上位へ伝える。
        throw new DeliveryUncertainError(`${label}: delivery result is unknown (${err.message})`, err);
      } else {
        // 429 以外のエラーはリトライしない
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

// ─── Bot 送信 ─────────────────────────────────────────────────────────────────

/**
 * Send broadcast message via Discord bot
 * タイムアウト付き
 */
async function sendViaBot(chatUrl, discordId, content, imageData) {
  const channelIdMatch = chatUrl.match(/channels\/\d+\/(\d+)/);
  if (!channelIdMatch) throw new Error('Invalid chat URL format');

  const channelId = channelIdMatch[1];

  const channel = await withTimeout(
    discordClient.channels.fetch(channelId),
    SEND_TIMEOUT_MS,
    `channels.fetch(${channelId})`
  );

  if (!channel) throw new Error('Channel not found');

  const messageOptions = { content: buildBotMessageContent(discordId, content) };

  if (imageData) {
    messageOptions.files = [{
      attachment: imageData.image_data,
      name: imageData.filename
    }];
  }

  try {
    await withTimeout(
      channel.send(messageOptions),
      SEND_TIMEOUT_MS,
      `channel.send(${channelId})`
    );
  } catch (err) {
    if (err.message?.includes('timed out')) {
      throw new DeliveryUncertainError(err.message, err);
    }
    throw err;
  }

  return { success: true };
}

/**
 * 通常送信はメンション付き、GASの明示対象送信は本文のみで組み立てる。
 */
export function buildBotMessageContent(discordId, content) {
  return discordId ? `<@${discordId}>\n${content}` : content;
}

// ─── スケジューラー互換ラッパー ───────────────────────────────────────────────

export async function sendBroadcast(messageData, targetStudents, userEmail) {
  const { jobId } = await enqueueBroadcast(messageData, targetStudents, userEmail);

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    await reconcileStaleBroadcastJobs();
    const job = await getBroadcastJobStatus(jobId);
    if (!job || ['completed', 'failed', 'interrupted', 'needs_review'].includes(job.status)) {
      return {
        success: job?.status === 'completed',
        results: {
          total:  job?.total  ?? 0,
          sent:   job?.sent   ?? 0,
          failed: job?.failed ?? 0,
          unknown: job?.unknown_count ?? 0,
          errors: []
        }
      };
    }
  }
}

// ─── ジョブエンキュー ─────────────────────────────────────────────────────────

export async function enqueueBroadcast(messageData, targetStudents, userEmail, dependencies = {}) {
  const getClientFn = dependencies.getClient || getClient;
  const runBroadcastJob = dependencies.runBroadcastJob || _runBroadcastJob;
  const { content, imageId, channelType, name, saveAsTemplate, isTest } = messageData;
  const usesExplicitTargets = (
    messageData.explicitTargets === true &&
    userEmail === GAS_BROADCAST_CREATED_BY &&
    messageData.campaignKey
  );
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const total = isTest ? 1 : targetStudents.length;

  const client = await getClientFn();
  let broadcastId;
  try {
    await client.query('BEGIN');

    if (usesExplicitTargets) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`gas-broadcast:${messageData.campaignKey}`]
      );
      const existingResult = await client.query(
        `SELECT bj.job_id, bj.broadcast_id, bj.total
         FROM broadcast_messages bm
         INNER JOIN broadcast_jobs bj ON bj.broadcast_id = bm.id
         WHERE bm.name = $1
           AND bm.created_by = $2
           AND bj.created_by = $2
         ORDER BY bj.created_at DESC
         LIMIT 1`,
        [`GAS::${messageData.campaignKey}`, GAS_BROADCAST_CREATED_BY]
      );
      if (existingResult.rows.length > 0) {
        await client.query('COMMIT');
        const existing = existingResult.rows[0];
        return {
          jobId: existing.job_id,
          broadcastId: existing.broadcast_id,
          total: existing.total,
          reused: true
        };
      }
    }

    const insertResult = await client.query(
      `INSERT INTO broadcast_messages
        (name, content, image_url, channel_type, target_status, target_tutor, created_by, is_template, last_sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING id`,
      [
        usesExplicitTargets ? `GAS::${messageData.campaignKey}` : (name || `Broadcast ${new Date().toISOString()}`),
        content,
        usesExplicitTargets ? null : (imageId || null),
        usesExplicitTargets ? 'chat' : channelType,
        usesExplicitTargets ? 'explicit' : (messageData.targetStatus || 'アクティブ'),
        usesExplicitTargets ? null : (messageData.targetTutor || null),
        userEmail,
        usesExplicitTargets ? false : (saveAsTemplate || false)
      ]
    );
    broadcastId = insertResult.rows[0].id;

    await client.query(
      `INSERT INTO broadcast_jobs
        (job_id, broadcast_id, status, total, sent, failed, unknown_count, is_test, created_by)
       VALUES ($1, $2, 'pending', $3, 0, 0, 0, $4, $5)`,
      [jobId, broadcastId, total, isTest, userEmail]
    );

    const recipients = isTest
      ? [{ student_id: 'TEST', name: 'Test User' }]
      : targetStudents;
    await insertJobRecipients(client, jobId, recipients);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // バックグラウンドで送信開始（await しない）
  runBroadcastJob(jobId).catch(err => {
    console.error(`[Broadcast] Background job ${jobId} crashed:`, err.message);
  });

  return { jobId, broadcastId, total, reused: false };
}

// ─── ジョブ進捗取得 ───────────────────────────────────────────────────────────

export async function getBroadcastJobStatus(jobId) {
  const result = await query(
    `SELECT
       bj.*,
       CASE WHEN counts.recipient_count > 0
         THEN counts.pending
         ELSE GREATEST(bj.total - bj.sent - bj.failed - bj.unknown_count, 0)
       END AS pending,
       counts.recipient_count,
       COALESCE(counts.unknown_recipients, '[]'::json) AS unknown_recipients
     FROM broadcast_jobs bj
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS recipient_count,
         COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,
         COALESCE(
           JSON_AGG(JSON_BUILD_OBJECT('studentId', student_id, 'name', student_name) ORDER BY recipient_order)
             FILTER (WHERE status = 'unknown'),
           '[]'::json
         ) AS unknown_recipients
       FROM broadcast_job_recipients
       WHERE job_id = bj.job_id
     ) counts ON true
     WHERE bj.job_id = $1`,
    [jobId]
  );
  return result.rows[0] || null;
}

async function insertJobRecipients(client, jobId, students, statuses = new Map()) {
  if (students.length === 0) return;
  const recipientRows = students.map((student, index) => ({
    student_id: String(student.student_id),
    student_name: student.name || null,
    chat_url: student.chat_url || null,
    recipient_order: index,
    status: statuses.get(String(student.student_id)) || 'pending'
  }));

  await client.query(
    `INSERT INTO broadcast_job_recipients (job_id, student_id, student_name, chat_url, recipient_order, status)
     SELECT $1, recipient.student_id, recipient.student_name, recipient.chat_url, recipient.recipient_order, recipient.status
     FROM JSONB_TO_RECORDSET($2::jsonb)
       AS recipient(student_id VARCHAR(50), student_name VARCHAR(255), chat_url TEXT, recipient_order INTEGER, status VARCHAR(20))
     ON CONFLICT (job_id, student_id) DO NOTHING`,
    [jobId, JSON.stringify(recipientRows)]
  );
}

async function loadBroadcastImage(imageId) {
  if (!imageId) return null;
  const result = await query(
    'SELECT filename, content_type, image_data FROM broadcast_images WHERE image_id = $1',
    [imageId]
  );
  if (result.rows.length === 0) {
    console.warn('[Broadcast] Image not found in database:', imageId);
    return null;
  }
  return result.rows[0];
}

async function setRecipientStatus(jobId, studentId, status, errorMessage = null) {
  await query(
    `UPDATE broadcast_job_recipients
     SET status = $3,
         error_message = $4,
         completed_at = CASE WHEN $3 IN ('sent', 'failed', 'unknown') THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE job_id = $1 AND student_id = $2`,
    [jobId, studentId, status, errorMessage]
  );
}

async function syncJobProgress(jobId, status = null) {
  const result = await query(
    `WITH counts AS (
       SELECT
         COUNT(*)::int AS recipient_count,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'unknown')::int AS unknown_count
       FROM broadcast_job_recipients
       WHERE job_id = $1
     )
     UPDATE broadcast_jobs
     SET sent = CASE WHEN counts.recipient_count > 0 THEN counts.sent ELSE broadcast_jobs.sent END,
         failed = CASE WHEN counts.recipient_count > 0 THEN counts.failed ELSE broadcast_jobs.failed END,
         unknown_count = CASE WHEN counts.recipient_count > 0 THEN counts.unknown_count ELSE broadcast_jobs.unknown_count END,
         status = COALESCE($2, broadcast_jobs.status),
         updated_at = NOW()
     FROM counts
     WHERE job_id = $1
     RETURNING broadcast_jobs.*`,
    [jobId, status]
  );
  return result.rows[0] || null;
}

/**
 * 旧実装の停止ジョブを、既存ログと現在の対象条件から復旧可能な状態に変換する。
 * 保存済み進捗内のログ欠落者と、その直後の1名は重複防止のため unknown とする。
 */
async function prepareLegacyJobRecipients(jobId, userEmail, userRole) {
  const existing = await query(
    'SELECT COUNT(*)::int AS count FROM broadcast_job_recipients WHERE job_id = $1',
    [jobId]
  );
  if (existing.rows[0].count > 0) return;

  const jobResult = await query(
    `SELECT bj.*, bm.name AS message_name, bm.target_status, bm.target_tutor, creator.role AS creator_role
     FROM broadcast_jobs bj
     JOIN broadcast_messages bm ON bm.id = bj.broadcast_id
     LEFT JOIN users creator ON creator.email = bj.created_by
     WHERE bj.job_id = $1`,
    [jobId]
  );
  const job = jobResult.rows[0];
  if (!job) throw new Error('Job not found');

  const targetStatus = job.target_status === 'active' ? 'アクティブ' : job.target_status;
  const targets = job.is_test
    ? [{ student_id: 'TEST', name: 'Test User' }]
    : await getTargetStudents(
        targetStatus,
        job.target_tutor,
        job.created_by || userEmail,
        job.message_name?.startsWith('[Scheduled]') ? 'leader' : (job.creator_role || userRole)
      );

  if (!job.is_test && targets.length !== Number(job.total)) {
    throw new Error(
      `送信開始時から対象者数が変化しています（開始時 ${job.total}名、現在 ${targets.length}名）。` +
      '重複や対象外送信を防ぐため、このジョブは自動復旧できません。'
    );
  }

  const logResult = await query(
    `SELECT student_id,
            BOOL_OR(status = 'sent') AS was_sent,
            BOOL_OR(status = 'failed') AS was_failed
     FROM broadcast_logs
     WHERE broadcast_message_id = $1
     GROUP BY student_id`,
    [job.broadcast_id]
  );
  const targetIds = new Set(targets.map(student => String(student.student_id)));
  const missingLoggedTargets = logResult.rows.filter(row => !targetIds.has(String(row.student_id)));
  if (missingLoggedTargets.length > 0) {
    throw new Error(
      '送信開始時から対象者の内訳が変化しています。' +
      '重複や対象外送信を防ぐため、このジョブは自動復旧できません。'
    );
  }
  const classifiedRecipients = classifyLegacyBroadcastRecipients(targets, logResult.rows, job);
  const statuses = new Map(
    classifiedRecipients.map(recipient => [recipient.student_id, recipient.status])
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await insertJobRecipients(client, jobId, targets, statuses);
    await client.query('UPDATE broadcast_jobs SET updated_at = NOW() WHERE job_id = $1', [jobId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await syncJobProgress(jobId);
}

export async function reconcileStaleBroadcastJobs() {
  const staleResult = await query(
    `SELECT job_id
     FROM broadcast_jobs
     WHERE (status = 'running' AND updated_at < NOW() - $1::interval)
        OR (status = 'pending' AND updated_at < NOW() - $2::interval)`,
    [STALE_JOB_INTERVAL, STALE_PENDING_JOB_INTERVAL]
  );

  for (const { job_id: jobId } of staleResult.rows) {
    await query(
      `UPDATE broadcast_job_recipients
       SET status = 'unknown',
           error_message = COALESCE(error_message, 'Worker stopped while this recipient was being sent'),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE job_id = $1 AND status = 'sending'`,
      [jobId]
    );
    await syncJobProgress(jobId, 'interrupted');
  }
}

export async function getLatestRecoverableBroadcastJob(userEmail, userRole) {
  await reconcileStaleBroadcastJobs();
  const result = await query(
    `SELECT job_id
     FROM broadcast_jobs
     WHERE created_by = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userEmail]
  );
  if (result.rows.length === 0) return null;

  const jobId = result.rows[0].job_id;
  const beforePrepare = await getBroadcastJobStatus(jobId);
  const recoverable = ['pending', 'running', 'interrupted', 'needs_review', 'failed'].includes(beforePrepare.status)
    || (beforePrepare.status === 'completed' && Number(beforePrepare.failed) > 0);
  if (!recoverable) return null;
  if (Number(beforePrepare.recipient_count) === 0 && beforePrepare.status !== 'running') {
    await prepareLegacyJobRecipients(jobId, userEmail, userRole);
  }
  return getBroadcastJobStatus(jobId);
}

export async function resumeBroadcastJob(jobId, userEmail, userRole) {
  await reconcileStaleBroadcastJobs();
  let job = await getBroadcastJobStatus(jobId);
  if (!job) throw new Error('Job not found');
  if (userRole === 'crew' && job.created_by !== userEmail) {
    const error = new Error('この送信ジョブを再開する権限がありません');
    error.status = 403;
    throw error;
  }
  if (job.status === 'running') {
    const error = new Error('この送信ジョブは現在実行中です');
    error.status = 409;
    throw error;
  }

  if (Number(job.recipient_count) === 0) {
    await prepareLegacyJobRecipients(jobId, userEmail, userRole);
    job = await getBroadcastJobStatus(jobId);
  }

  const retryable = await query(
    `SELECT COUNT(*)::int AS count
     FROM broadcast_job_recipients
     WHERE job_id = $1 AND status IN ('pending', 'failed')`,
    [jobId]
  );
  if (retryable.rows[0].count === 0) {
    const error = new Error('再送可能な未送信者はいません');
    error.status = 409;
    throw error;
  }

  await query(
    `UPDATE broadcast_jobs SET status = 'pending', updated_at = NOW() WHERE job_id = $1`,
    [jobId]
  );
  _runBroadcastJob(jobId).catch(err => {
    console.error(`[Broadcast] Resumed job ${jobId} crashed:`, err.message);
  });
  return getBroadcastJobStatus(jobId);
}

export async function acknowledgeBroadcastJob(jobId, userEmail, userRole) {
  const job = await getBroadcastJobStatus(jobId);
  if (!job) throw new Error('Job not found');
  if (userRole === 'crew' && job.created_by !== userEmail) {
    const error = new Error('この送信ジョブを確認済みにする権限がありません');
    error.status = 403;
    throw error;
  }
  if (job.status !== 'needs_review') {
    const error = new Error('確認が必要な送信ジョブではありません');
    error.status = 409;
    throw error;
  }
  await syncJobProgress(jobId, 'completed');
  return getBroadcastJobStatus(jobId);
}

// ─── バックグラウンド送信ジョブ ───────────────────────────────────────────────

async function _runBroadcastJob(jobId) {
  if (activeBroadcastJobs.has(jobId)) return;
  activeBroadcastJobs.add(jobId);

  try {
    const startResult = await query(
      `UPDATE broadcast_jobs
       SET status = 'running', updated_at = NOW()
       WHERE job_id = $1
         AND status <> 'running'
         AND EXISTS (
           SELECT 1 FROM broadcast_job_recipients
           WHERE job_id = $1 AND status IN ('pending', 'failed')
         )
       RETURNING *`,
      [jobId]
    );
    if (startResult.rows.length === 0) return;

    const messageResult = await query(
      `SELECT bj.broadcast_id, bj.is_test, bj.created_by,
              bm.content, bm.image_url, bm.channel_type, bm.target_status
       FROM broadcast_jobs bj
       JOIN broadcast_messages bm ON bm.id = bj.broadcast_id
       WHERE bj.job_id = $1`,
      [jobId]
    );
    const job = messageResult.rows[0];
    if (!job) throw new Error('Broadcast message not found');
    const usesExplicitTargets = (
      job.created_by === GAS_BROADCAST_CREATED_BY &&
      job.target_status === 'explicit' &&
      job.channel_type === 'chat'
    );

    const imageData = await loadBroadcastImage(job.image_url);
    let broadcastInfoMap = new Map();
    if (!job.is_test && !usesExplicitTargets) {
      console.log(`[Broadcast Job ${jobId}] Fetching student broadcast info from sheets...`);
      const studentBroadcastInfo = await fetchStudentBroadcastInfo();
      broadcastInfoMap = new Map(studentBroadcastInfo.map(s => [String(s.studentId), s]));
      console.log(`[Broadcast Job ${jobId}] Sheet data loaded: ${studentBroadcastInfo.length} records`);
    }

    const recipientResult = await query(
      `SELECT student_id, student_name, chat_url
       FROM broadcast_job_recipients
       WHERE job_id = $1 AND status IN ('pending', 'failed')
       ORDER BY recipient_order`,
      [jobId]
    );

    for (let i = 0; i < recipientResult.rows.length; i++) {
      const recipient = recipientResult.rows[i];
      const claimResult = await query(
        `UPDATE broadcast_job_recipients
         SET status = 'sending', attempt_count = attempt_count + 1,
             error_message = NULL, started_at = NOW(), updated_at = NOW()
         WHERE job_id = $1 AND student_id = $2
           AND status IN ('pending', 'failed')
           AND EXISTS (SELECT 1 FROM broadcast_jobs WHERE job_id = $1 AND status = 'running')
         RETURNING *`,
        [jobId, recipient.student_id]
      );
      if (claimResult.rows.length === 0) break;

      const student = {
        student_id: recipient.student_id,
        name: recipient.student_name
      };
      let webhookUrl = null;
      let discordId = null;

      if (job.is_test) {
        webhookUrl = 'https://discord.com/api/webhooks/1282616705817903146/M4KSUtmoHYSDqySMBgtgjU0wZywkUkVtfh3KOOA-BNzgXMnwVnEphKwuleMXhFn60MYd';
        discordId = '766666980086120470';
      } else {
        const broadcastInfo = resolveBroadcastInfo(
          { ...student, chat_url: recipient.chat_url },
          broadcastInfoMap,
          usesExplicitTargets
        );
        if (broadcastInfo) {
          discordId = broadcastInfo.discordId;
          if      (job.channel_type === 'notice') webhookUrl = broadcastInfo.noticeWebhook;
          else if (job.channel_type === 'tips')   webhookUrl = broadcastInfo.tipsWebhook;
          else if (job.channel_type === 'anken')  webhookUrl = broadcastInfo.ankenWebhook;
          else if (job.channel_type === 'chat')   webhookUrl = broadcastInfo.chatUrl;
        }
      }

      if (!webhookUrl) {
        const errorMessage = job.is_test ? 'Test webhook is not configured' : `No ${job.channel_type} URL`;
        await setRecipientStatus(jobId, student.student_id, 'failed', errorMessage);
        await logBroadcastSend(job.broadcast_id, student, job.channel_type, null, 'failed', errorMessage);
      } else {
        let deliveryConfirmed = false;
        try {
          if (job.channel_type === 'chat' && !job.is_test) {
            await sendViaBot(webhookUrl, discordId, job.content, imageData);
          } else {
            await sendViaWebhook(webhookUrl, discordId, job.content, imageData);
          }
          deliveryConfirmed = true;
          await setRecipientStatus(jobId, student.student_id, 'sent');
          await logBroadcastSend(job.broadcast_id, student, job.channel_type, webhookUrl, 'sent', null);
        } catch (err) {
          const status = (deliveryConfirmed || err.deliveryUncertain) ? 'unknown' : 'failed';
          console.error(`[Broadcast Job ${jobId}] ${status} for ${student.student_id}: ${err.message}`);
          await setRecipientStatus(jobId, student.student_id, status, err.message);
          await logBroadcastSend(job.broadcast_id, student, job.channel_type, webhookUrl, status, err.message);
        }
      }

      await syncJobProgress(jobId);
      if ((i + 1) % 50 === 0) {
        console.log(`[Broadcast Job ${jobId}] Progress: ${i + 1}/${recipientResult.rows.length} attempted`);
      }
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    const finalCounts = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,
         COUNT(*) FILTER (WHERE status = 'unknown')::int AS unknown_count
       FROM broadcast_job_recipients WHERE job_id = $1`,
      [jobId]
    );
    const { pending, unknown_count: unknownCount } = finalCounts.rows[0];
    const finalStatus = pending > 0 ? 'interrupted' : (unknownCount > 0 ? 'needs_review' : 'completed');
    const finalJob = await syncJobProgress(jobId, finalStatus);
    console.log(`[Broadcast Job ${jobId}] Finished with status=${finalStatus}, sent=${finalJob.sent}, failed=${finalJob.failed}, unknown=${finalJob.unknown_count}`);
  } catch (err) {
    console.error(`[Broadcast Job ${jobId}] Fatal error:`, err.message);
    await query(
      `UPDATE broadcast_job_recipients
       SET status = 'unknown', error_message = $2, completed_at = NOW(), updated_at = NOW()
       WHERE job_id = $1 AND status = 'sending'`,
      [jobId, `Worker stopped: ${err.message}`]
    ).catch(() => {});
    await syncJobProgress(jobId, 'interrupted').catch(() => {});
  } finally {
    activeBroadcastJobs.delete(jobId);
  }
}

/**
 * GAS明示対象ではスプレッドシートを再検索せず、保存済みchat_urlだけを使用する。
 */
export function resolveBroadcastInfo(student, broadcastInfoMap, explicitTargets) {
  if (explicitTargets === true) {
    return {
      chatUrl: student.chat_url,
      discordId: null
    };
  }
  return broadcastInfoMap.get(String(student.student_id));
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
