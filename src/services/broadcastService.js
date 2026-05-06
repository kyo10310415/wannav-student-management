import axios from 'axios';
import { query } from '../db/connection.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { client as discordClient } from './discordService.js';

/**
 * Get target students for broadcast
 * @param {string} targetStatus - Student status filter (e.g., 'active')
 * @param {string} targetTutor - Tutor filter (null = all tutors)
 * @param {string} userEmail - Current user email
 * @param {string} userRole - Current user role (crew/leader/admin)
 * @returns {Array} - Array of target students
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
    let whereConditions = [];
    
    // Handle special "レッスン中" status (active students excluding permanent members and enrollment plan)
    if (targetStatus === 'レッスン中') {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push('アクティブ');
      whereConditions.push(`(s.contract_plan IS NULL OR (s.contract_plan != $${params.length + 1} AND s.contract_plan != $${params.length + 2}))`);
      params.push('永久会員');
      params.push('在籍プラン');
      console.log('[Broadcast] レッスン中 mode: アクティブ excluding 永久会員 and 在籍プラン');
    } else if (targetStatus === '永久会員') {
      // 永久会員: アクティブ且つ contract_plan が '永久会員'
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push('アクティブ');
      whereConditions.push(`s.contract_plan = $${params.length + 1}`);
      params.push('永久会員');
      console.log('[Broadcast] 永久会員 mode: アクティブ AND contract_plan = 永久会員');
    } else {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push(targetStatus);
    }
    
    // Add WHERE clause
    if (whereConditions.length > 0) {
      sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    // Role-based filtering
    if (userRole === 'crew') {
      // Crew can only send to their own students
      sqlQuery += ` AND t.email = $${params.length + 1}`;
      params.push(userEmail);
      console.log('[Broadcast] Crew mode: filtering by email', userEmail);
    } else if (targetTutor && targetTutor !== 'all') {
      // Leader/Admin can filter by tutor
      sqlQuery += ` AND s.homeroom_tutor = $${params.length + 1}`;
      params.push(targetTutor);
      console.log('[Broadcast] Leader/Admin mode: filtering by tutor', targetTutor);
    } else {
      console.log('[Broadcast] Leader/Admin mode: no tutor filter (all students)');
    }
    
    sqlQuery += ' ORDER BY s.student_id';
    
    console.log('[Broadcast] Executing SQL:', sqlQuery);
    console.log('[Broadcast] With params:', params);
    
    const result = await query(sqlQuery, params);
    
    console.log(`[Broadcast] Found ${result.rows.length} target students`);
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting target students:', error);
    throw error;
  }
}

/**
 * Send broadcast message via webhook
 * @param {string} webhookUrl - Discord webhook URL
 * @param {string} discordId - Discord user ID for mention
 * @param {string} content - Message content
 * @param {string} imageId - Image ID (for database-stored images)
 */
async function sendViaWebhook(webhookUrl, discordId, content, imageId) {
  try {
    console.log('[Broadcast] sendViaWebhook called with:', {
      webhookUrl: webhookUrl ? webhookUrl.substring(0, 50) + '...' : 'none',
      discordId: discordId || 'none',
      contentLength: content ? content.length : 0,
      hasImage: !!imageId,
      imageId: imageId || 'none'
    });
    
    const embed = {
      description: content,
      color: 0x5865F2, // Discord blue
      timestamp: new Date().toISOString()
    };
    
    // Build payload
    const payload = {
      embeds: [embed]
    };
    
    // Add mention if Discord ID exists
    if (discordId) {
      payload.content = `<@${discordId}>`;
    }
    
    // If image exists, get it from database and attach as file
    if (imageId) {
      console.log('[Broadcast] Fetching image from database:', imageId);
      
      try {
        // Get image from database
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
          
          // Use FormData to send image as attachment
          const FormData = (await import('form-data')).default;
          const formData = new FormData();
          
          // Attach the image file
          formData.append('files[0]', imageData.image_data, {
            filename: imageData.filename,
            contentType: imageData.content_type
          });
          
          // Attach the payload as JSON
          formData.append('payload_json', JSON.stringify(payload));
          
          console.log('[Broadcast] Sending webhook with file attachment');
          
          const response = await axios.post(webhookUrl, formData, {
            headers: {
              ...formData.getHeaders()
            }
          });
          
          console.log('[Broadcast] Webhook response status:', response.status);
          
          return { success: true };
        } else {
          console.warn('[Broadcast] Image not found in database:', imageId);
          // Continue without image
        }
      } catch (imageError) {
        console.error('[Broadcast] Error fetching image:', imageError);
        // Continue without image
      }
    }
    
    // No image or image fetch failed, send as normal
    console.log('[Broadcast] Sending webhook without image');
    console.log('[Broadcast] Payload:', JSON.stringify(payload, null, 2));
    
    const response = await axios.post(webhookUrl, payload);
    console.log('[Broadcast] Webhook response status:', response.status);
    
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Webhook send error:', error.message);
    throw error;
  }
}

/**
 * Send broadcast message via Discord bot
 * @param {string} chatUrl - Discord chat URL
 * @param {string} discordId - Discord user ID for mention
 * @param {string} content - Message content
 * @param {string} imageId - Image ID stored in database (optional)
 */
async function sendViaBot(chatUrl, discordId, content, imageId) {
  try {
    // Extract channel ID from URL
    const channelIdMatch = chatUrl.match(/channels\/\d+\/(\d+)/);
    if (!channelIdMatch) {
      throw new Error('Invalid chat URL format');
    }
    
    const channelId = channelIdMatch[1];
    
    // Fetch channel
    const channel = await discordClient.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error('Channel not found');
    }
    
    // Build message
    let messageContent = '';
    if (discordId) {
      messageContent += `<@${discordId}>\n`;
    }
    messageContent += content;
    
    const messageOptions = {
      content: messageContent
    };
    
    // If imageId exists, fetch image data from database and attach as file
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
          // discord.js accepts AttachmentBuilder or { attachment: Buffer, name: filename }
          messageOptions.files = [{
            attachment: imageData.image_data,
            name: imageData.filename
          }];
        } else {
          console.warn('[Broadcast] Bot: Image not found in database:', imageId);
        }
      } catch (imageError) {
        console.error('[Broadcast] Bot: Error fetching image:', imageError);
        // Continue without image
      }
    }
    
    await channel.send(messageOptions);
    
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Bot send error:', error.message);
    throw error;
  }
}

/**
 * schedulerService.js との後方互換用ラッパー
 * スケジューラーはサーバー内部で呼ぶので同期的に完了まで待つ
 */
export async function sendBroadcast(messageData, targetStudents, userEmail) {
  const { jobId } = await enqueueBroadcast(messageData, targetStudents, userEmail);

  // バックグラウンドジョブの完了を待つ（スケジューラー用）
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

/**
 * ジョブIDを生成して即返す。実際の送信はバックグラウンドで非同期実行。
 * @returns {string} jobId
 */
export async function enqueueBroadcast(messageData, targetStudents, userEmail) {
  const { content, imageId, channelType, name, saveAsTemplate, isTest } = messageData;

  // 1. broadcast_messages に記録
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

  // 2. ジョブレコードを作成
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const total = isTest ? 1 : targetStudents.length;

  await query(
    `INSERT INTO broadcast_jobs (job_id, broadcast_id, status, total, sent, failed, is_test, created_by)
     VALUES ($1, $2, 'pending', $3, 0, 0, $4, $5)`,
    [jobId, broadcastId, total, isTest, userEmail]
  );

  // 3. バックグラウンドで送信を開始（await しない）
  _runBroadcastJob(jobId, broadcastId, messageData, targetStudents, userEmail).catch(err => {
    console.error(`[Broadcast] Background job ${jobId} crashed:`, err.message);
  });

  return { jobId, broadcastId, total };
}

/**
 * ジョブの進捗を取得
 */
export async function getBroadcastJobStatus(jobId) {
  const result = await query(
    `SELECT job_id, broadcast_id, status, total, sent, failed, is_test, created_at, updated_at
     FROM broadcast_jobs WHERE job_id = $1`,
    [jobId]
  );
  return result.rows[0] || null;
}

/**
 * 実際の送信処理（バックグラウンド）
 */
async function _runBroadcastJob(jobId, broadcastId, messageData, targetStudents, userEmail) {
  const { content, imageId, channelType, isTest } = messageData;

  // ジョブを running に更新
  await query(
    `UPDATE broadcast_jobs SET status = 'running', updated_at = NOW() WHERE job_id = $1`,
    [jobId]
  );

  try {
    // テストモード
    if (isTest) {
      console.log(`[Broadcast Job ${jobId}] Test mode`);
      const testWebhookUrl = 'https://discord.com/api/webhooks/1282616705817903146/M4KSUtmoHYSDqySMBgtgjU0wZywkUkVtfh3KOOA-BNzgXMnwVnEphKwuleMXhFn60MYd';
      const testDiscordId = '766666980086120470';

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

    // 通常モード: スプレッドシートから送信先情報を取得
    const studentBroadcastInfo = await fetchStudentBroadcastInfo();
    const broadcastInfoMap = new Map(studentBroadcastInfo.map(s => [s.studentId, s]));

    let sent = 0;
    let failed = 0;

    for (const student of targetStudents) {
      const broadcastInfo = broadcastInfoMap.get(student.student_id);

      if (!broadcastInfo) {
        console.log(`[Broadcast Job ${jobId}] No broadcast info for ${student.student_id}`);
        failed++;
        await logBroadcastSend(broadcastId, student, channelType, null, 'failed', 'No broadcast info found');
        // 10件ごとに進捗を DB へ保存
        if ((sent + failed) % 10 === 0) {
          await query(
            `UPDATE broadcast_jobs SET sent = $1, failed = $2, updated_at = NOW() WHERE job_id = $3`,
            [sent, failed, jobId]
          );
        }
        continue;
      }

      try {
        let webhookUrl = null;
        if (channelType === 'notice')      webhookUrl = broadcastInfo.noticeWebhook;
        else if (channelType === 'tips')   webhookUrl = broadcastInfo.tipsWebhook;
        else if (channelType === 'anken')  webhookUrl = broadcastInfo.ankenWebhook;
        else if (channelType === 'chat')   webhookUrl = broadcastInfo.chatUrl;

        if (!webhookUrl) {
          failed++;
          await logBroadcastSend(broadcastId, student, channelType, null, 'failed', `No ${channelType} URL`);
        } else {
          if (channelType === 'chat') {
            await sendViaBot(webhookUrl, broadcastInfo.discordId, content, imageId);
          } else {
            await sendViaWebhook(webhookUrl, broadcastInfo.discordId, content, imageId);
          }
          sent++;
          await logBroadcastSend(broadcastId, student, channelType, webhookUrl, 'sent', null);
        }
      } catch (err) {
        console.error(`[Broadcast Job ${jobId}] Error sending to ${student.student_id}:`, err.message);
        failed++;
        await logBroadcastSend(broadcastId, student, channelType, null, 'failed', err.message);
      }

      // 10件ごとに進捗を DB へ保存（ポーリングで取得できるようにする）
      if ((sent + failed) % 10 === 0) {
        await query(
          `UPDATE broadcast_jobs SET sent = $1, failed = $2, updated_at = NOW() WHERE job_id = $3`,
          [sent, failed, jobId]
        );
      }

      // レート制限: 200ms 待機（Discord 5req/s 制限対策）
      await new Promise(resolve => setTimeout(resolve, 200));
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

/**
 * Log broadcast send to database
 */
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

/**
 * Get broadcast templates
 */
export async function getTemplates(userEmail, userRole) {
  try {
    let sqlQuery = `
      SELECT id, name, content, image_url, channel_type, target_tutor, created_at, last_sent_at
      FROM broadcast_messages
      WHERE is_template = true
    `;
    
    const params = [];
    
    // Crew can only see their own templates
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

/**
 * Save or update template
 */
export async function saveTemplate(templateData, userEmail) {
  try {
    const { id, name, content, imageUrl, channelType, targetTutor } = templateData;
    
    if (id) {
      // Update existing template
      await query(
        `UPDATE broadcast_messages
        SET name = $1, content = $2, image_url = $3, channel_type = $4, target_tutor = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND created_by = $7`,
        [name, content, imageUrl, channelType, targetTutor, id, userEmail]
      );
      
      return { success: true, id };
    } else {
      // Create new template
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

/**
 * Delete template
 */
export async function deleteTemplate(templateId, userEmail, userRole) {
  try {
    let sqlQuery = 'DELETE FROM broadcast_messages WHERE id = $1 AND is_template = true';
    const params = [templateId];
    
    // Crew can only delete their own templates
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

/**
 * Get broadcast logs
 */
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
