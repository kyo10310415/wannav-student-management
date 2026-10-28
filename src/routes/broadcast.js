import { Hono } from 'hono';
import { 
  getTargetStudents, 
  enqueueBroadcast,
  getBroadcastJobStatus,
  getLatestRecoverableBroadcastJob,
  reconcileStaleBroadcastJobs,
  resumeBroadcastJob,
  acknowledgeBroadcastJob,
  getTemplates, 
  saveTemplate, 
  deleteTemplate,
  getBroadcastLogs
} from '../services/broadcastService.js';
import { query } from '../db/connection.js';

// Images are now stored in database (broadcast_images table)
// No need for in-memory storage

const app = new Hono();
function broadcastInlineImageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function broadcastImageDisposition(inline, filename) {
  const name = typeof filename === 'string' && filename ? filename : 'image';
  const encoded = encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="image"; filename*=UTF-8''${encoded}`;
}


const SAFE_BROADCAST_ERRORS = new Set([
  'Job not found',
  'この送信ジョブを再開する権限がありません',
  'この送信ジョブは現在実行中です',
  '再送可能な未送信者はいません',
  'この送信ジョブを確認済みにする権限がありません',
  '確認が必要な送信ジョブではありません',
  '送信開始時から対象者の内訳が変化しています。重複や対象外送信を防ぐため、このジョブは自動復旧できません。'
]);

function safeBroadcastError(error) {
  const message = error?.message;
  if (SAFE_BROADCAST_ERRORS.has(message)) return message;
  if (typeof message === 'string' && /^送信開始時から対象者数が変化しています（開始時 [0-9]{1,9}名、現在 [0-9]{1,9}名）。重複や対象外送信を防ぐため、このジョブは自動復旧できません。$/.test(message)) return message;
  return 'Broadcast operation failed';
}

function serializeBroadcastJob(job) {
  return {
    jobId:             job.job_id,
    broadcastId:       job.broadcast_id,
    status:            job.status,
    total:             Number(job.total),
    sent:              Number(job.sent),
    failed:            Number(job.failed),
    unknown:           Number(job.unknown_count || 0),
    pending:           Number(job.pending || 0),
    isTest:            job.is_test,
    updatedAt:         job.updated_at,
    lastError:         job.last_error ? safeBroadcastError({ message: job.last_error }) : null,
    unknownRecipients: job.unknown_recipients || []
  };
}

/**
 * Middleware: Verify session authentication
 */
async function authMiddleware(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  
  try {
    // Verify session
    const sessionResult = await query(
      `SELECT s.*, u.email, u.role 
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [sessionToken]
    );
    
    if (sessionResult.rows.length === 0) {
      return c.json({ success: false, error: 'Invalid or expired session' }, 401);
    }
    
    const session = sessionResult.rows[0];
    c.set('user', {
      id: session.user_id,
      email: session.email,
      role: session.role
    });
    
    await next();
  } catch (error) {
    console.error('Auth middleware error:');
    return c.json({ success: false, error: 'Authentication failed' }, 401);
  }
}

// Apply auth middleware to all routes
app.use('*', authMiddleware);

/**
 * GET /api/broadcast/preview
 * Get preview of target students
 */
app.post('/preview', async (c) => {
  try {
    const user = c.get('user');
    const { targetStatus, targetTutor } = await c.req.json();
    
    const students = await getTargetStudents(
      targetStatus || 'アクティブ',
      targetTutor,
      user.email,
      user.role
    );
    
    return c.json({
      success: true,
      count: students.length,
      students: students.map(s => ({
        student_id: s.student_id,
        name: s.name,
        homeroom_tutor: s.homeroom_tutor
      }))
    });
  } catch (error) {
    console.error('Error getting preview:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * POST /api/broadcast/send
 * Send broadcast message
 * Body: { content, imageUrl, channelType, targetStatus, targetTutor, name, saveAsTemplate, isTest }
 */
app.post('/send', async (c) => {
  try {
    const user = c.get('user');
    const messageData = await c.req.json();
    
    // Validate required fields
    if (!messageData.content) {
      return c.json({
        success: false,
        error: 'Message content is required'
      }, 400);
    }
    
    if (!messageData.channelType) {
      return c.json({
        success: false,
        error: 'Channel type is required'
      }, 400);
    }
    
    // テストモード: 生徒検索をスキップしてすぐにジョブ登録
    if (messageData.isTest) {
      console.log('[Broadcast] Test mode: enqueuing job');
      const { jobId, broadcastId, total } = await enqueueBroadcast(messageData, [], user.email);
      return c.json({ success: true, jobId, broadcastId, total });
    }

    // 通常モード: 送信対象生徒を取得してジョブ登録
    const targetStudents = await getTargetStudents(
      messageData.targetStatus || 'アクティブ',
      messageData.targetTutor,
      user.email,
      user.role
    );

    if (targetStudents.length === 0) {
      return c.json({ success: false, error: '送信対象の生徒が見つかりませんでした' }, 400);
    }

    // ジョブを登録して即座にレスポンスを返す（バックグラウンドで送信開始）
    const { jobId, broadcastId, total } = await enqueueBroadcast(messageData, targetStudents, user.email);

    return c.json({
      success: true,
      jobId,
      broadcastId,
      total,
      message: `送信ジョブを開始しました（対象: ${total}名）`
    });
  } catch (error) {
    console.error('Error sending broadcast:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * GET /api/broadcast/templates
 * Get all templates for current user
 */
app.get('/templates', async (c) => {
  try {
    const user = c.get('user');
    
    const templates = await getTemplates(user.email, user.role);
    
    return c.json({
      success: true,
      templates
    });
  } catch (error) {
    console.error('Error getting templates:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * POST /api/broadcast/templates
 * Create or update template
 * Body: { id (optional), name, content, imageUrl, channelType, targetTutor }
 */
app.post('/templates', async (c) => {
  try {
    const user = c.get('user');
    let templateData;
    try { templateData = await c.req.json(); } catch { return c.json({ success: false, error: '入力が不正です' }, 400); }
    if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) return c.json({ success: false, error: '入力が不正です' }, 400);
    if (templateData.id != null && (!/^\d+$/.test(String(templateData.id)) || !Number.isSafeInteger(Number(templateData.id)) || Number(templateData.id) <= 0)) return c.json({ success: false, error: 'IDが不正です' }, 400);
    if (templateData.channelType != null && !['notice', 'tips', 'anken', 'chat'].includes(templateData.channelType)) return c.json({ success: false, error: 'チャンネルが不正です' }, 400);
    if (['imageUrl', 'targetTutor'].some(key => templateData[key] != null && typeof templateData[key] !== 'string')) return c.json({ success: false, error: '入力が不正です' }, 400);
    
    // Validate required fields
    if (typeof templateData.name !== 'string' || !templateData.name.trim()) {
      return c.json({
        success: false,
        error: 'Template name is required'
      }, 400);
    }
    
    if (typeof templateData.content !== 'string' || !templateData.content.trim()) {
      return c.json({
        success: false,
        error: 'Template content is required'
      }, 400);
    }
    
    const result = await saveTemplate(templateData, user.email);
    
    return c.json({
      success: true,
      message: templateData.id ? 'Template updated' : 'Template created',
      templateId: result.id
    });
  } catch (error) {
    if (error?.status === 404) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    console.error('Error saving template:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * DELETE /api/broadcast/templates/:id
 * Delete template
 */
app.delete('/templates/:id', async (c) => {
  try {
    const user = c.get('user');
    const templateId = c.req.param('id');
    if (!/^\d+$/.test(templateId) || !Number.isSafeInteger(Number(templateId)) || Number(templateId) <= 0) return c.json({ success: false, error: 'IDが不正です' }, 400);
    
    await deleteTemplate(templateId, user.email, user.role);
    
    return c.json({
      success: true,
      message: 'Template deleted'
    });
  } catch (error) {
    if (error?.status === 404) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    console.error('Error deleting template:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * GET /api/broadcast/logs
 * Get broadcast logs
 * Query: ?broadcastId=xxx&limit=100
 */
app.get('/logs', async (c) => {
  try {
    const broadcastId = c.req.query('broadcastId');
    const limit = parseInt(c.req.query('limit')) || 100;
    
    const logs = await getBroadcastLogs(broadcastId, limit);
    
    return c.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error getting logs:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * GET /api/broadcast/jobs/recoverable
 * ログインユーザーが再接続または再開できる最新ジョブを返す
 */
app.get('/jobs/recoverable', async (c) => {
  try {
    const user = c.get('user');
    const job = await getLatestRecoverableBroadcastJob(user.email, user.role);
    return c.json({
      success: true,
      job: job ? serializeBroadcastJob(job) : null
    });
  } catch (error) {
    console.error('Error getting recoverable broadcast job:');
    return c.json({ success: false, error: safeBroadcastError(error) }, 500);
  }
});

/**
 * POST /api/broadcast/jobs/:jobId/resume
 * 成功済みと送達不明を除外し、未送信・失敗分だけ再開する
 */
app.post('/jobs/:jobId/resume', async (c) => {
  try {
    const user = c.get('user');
    const job = await resumeBroadcastJob(c.req.param('jobId'), user.email, user.role);
    return c.json({
      success: true,
      job: serializeBroadcastJob(job),
      message: '未送信分の送信を再開しました'
    });
  } catch (error) {
    console.error('Error resuming broadcast job:');
    return c.json(
      { success: false, error: safeBroadcastError(error) },
      error.status || 500
    );
  }
});

/**
 * POST /api/broadcast/jobs/:jobId/acknowledge
 * 送達不明者を確認した後、要確認表示を閉じる
 */
app.post('/jobs/:jobId/acknowledge', async (c) => {
  try {
    const user = c.get('user');
    const job = await acknowledgeBroadcastJob(c.req.param('jobId'), user.email, user.role);
    return c.json({ success: true, job: serializeBroadcastJob(job) });
  } catch (error) {
    console.error('Error acknowledging broadcast job:');
    return c.json(
      { success: false, error: safeBroadcastError(error) },
      error.status || 500
    );
  }
});

/**
 * GET /api/broadcast/jobs/:jobId
 * ジョブの進捗を返す（フロントエンドがポーリングで呼び出す）
 */
app.get('/jobs/:jobId', async (c) => {
  try {
    const user = c.get('user');
    const jobId = c.req.param('jobId');
    let job = await getBroadcastJobStatus(jobId);

    if (!job) {
      return c.json({ success: false, error: 'Job not found' }, 404);
    }
    if (user.role === 'crew' && job.created_by !== user.email) {
      return c.json({ success: false, error: 'この送信ジョブを表示する権限がありません' }, 403);
    }
    await reconcileStaleBroadcastJobs(jobId);
    job = await getBroadcastJobStatus(jobId);
    if (!job) return c.json({ success: false, error: 'Job not found' }, 404);

    return c.json({
      success: true,
      job: serializeBroadcastJob(job)
    });
  } catch (error) {
    console.error('Error getting job status:');
    return c.json({ success: false, error: safeBroadcastError(error) }, 500);
  }
});

/**
 * GET /api/broadcast/tutors
 * Get list of tutors for filtering (only users registered in users table)
 */
app.get('/tutors', async (c) => {
  try {
    const user = c.get('user');
    
    // Import query function
    const { query } = await import('../db/connection.js');
    
    // Get tutors that are registered as users (have email in users table)
    let sqlQuery = `
      SELECT DISTINCT t.notion_name, t.email 
      FROM tutors t
      INNER JOIN users u ON LOWER(t.email) = LOWER(u.email)
      WHERE t.notion_name IS NOT NULL 
      ORDER BY t.notion_name
    `;
    const params = [];
    
    // If crew, only return their own info
    if (user.role === 'crew') {
      sqlQuery = `
        SELECT t.notion_name, t.email 
        FROM tutors t
        INNER JOIN users u ON LOWER(t.email) = LOWER(u.email)
        WHERE LOWER(t.email) = LOWER($1)
      `;
      params.push(user.email);
    }
    
    const result = await query(sqlQuery, params);
    
    return c.json({
      success: true,
      tutors: result.rows
    });
  } catch (error) {
    console.error('Error getting tutors:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * POST /api/broadcast/upload-image
 * Store image in database (persistent storage)
 */
app.post('/upload-image', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const file = body['image'];
    
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || typeof file.size !== 'number' || !file.size) {
      return c.json({
        success: false,
        error: 'No image file provided'
      }, 400);
    }
    
    // Check file size (max 8MB)
    if (file.size > 8 * 1024 * 1024) {
      return c.json({
        success: false,
        error: 'Image file too large (max 8MB)'
      }, 400);
    }
    
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({
        success: false,
        error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP'
      }, 400);
    }
    
    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = broadcastInlineImageType(buffer);
    if (!contentType) return c.json({ success: false, error: 'Invalid image content' }, 400);
    
    // Generate unique image ID
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    console.log('[Broadcast] Storing image in database');
    
    // Store image in database
    await query(
      `INSERT INTO broadcast_images (image_id, filename, content_type, file_size, image_data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [imageId, file.name, contentType, buffer.length, buffer, user.email]
    );
    
    console.log('[Broadcast] Image stored successfully');
    
    return c.json({
      success: true,
      imageId: imageId,
      filename: file.name
    });
  } catch (error) {
    console.error('Error storing image:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * GET /api/broadcast/schedules
 * Get all scheduled broadcasts
 */
app.get('/schedules', async (c) => {
  try {
    const user = c.get('user');
    
    console.log('[Broadcast] Loading schedules');
    
    let sqlQuery = `
      SELECT id, name, content, image_url, channel_type, target_status, target_tutor, 
             schedule_cron, schedule_enabled, last_sent_at, schedule_start_date, created_at, updated_at, created_by
      FROM broadcast_messages
      WHERE is_scheduled = true
    `;
    
    // Crew can only see their own schedules
    if (user.role === 'crew') {
      sqlQuery += ` AND LOWER(created_by) = LOWER($1)`;
      const result = await query(sqlQuery, [user.email]);
      console.log('[Broadcast] Crew schedules found:', result.rows.length);
      if (result.rows.length > 0) {
        console.log('[Broadcast] Schedule sample available');
      } else {
        console.log('[Broadcast] No schedules found for crew');
        // Check if any schedules exist at all
        const allSchedulesResult = await query(`SELECT COUNT(*) as count, created_by FROM broadcast_messages WHERE is_scheduled = true GROUP BY created_by`);
        console.log(`[Broadcast] Schedule owner groups: ${allSchedulesResult.rows.length}`);
      }
      return c.json({
        success: true,
        schedules: result.rows
      });
    } else {
      const result = await query(sqlQuery);
      console.log('[Broadcast] All schedules found:', result.rows.length);
      return c.json({
        success: true,
        schedules: result.rows
      });
    }
  } catch (error) {
    console.error('Error getting schedules:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * POST /api/broadcast/schedules
 * Create or update scheduled broadcast
 * Body: { id (optional), name, content, imageId, channelType, targetStatus, targetTutor, scheduleCron, scheduleEnabled }
 */
app.post('/schedules', async (c) => {
  try {
    const user = c.get('user');
    let scheduleData;
    try { scheduleData = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
    if (!scheduleData || typeof scheduleData !== 'object' || Array.isArray(scheduleData)) return c.json({ success: false, error: '入力が不正です' }, 400);
    if (['name', 'content', 'scheduleCron'].some(key => typeof scheduleData[key] !== 'string' || !scheduleData[key].trim())) return c.json({ success: false, error: '名前・本文・スケジュールは文字列で入力してください' }, 400);
    if (scheduleData.id != null && (!/^\d+$/.test(String(scheduleData.id)) || !Number.isSafeInteger(Number(scheduleData.id)) || Number(scheduleData.id) <= 0)) return c.json({ success: false, error: 'IDが不正です' }, 400);
    if (['imageId', 'channelType', 'targetStatus', 'targetTutor'].some(key => scheduleData[key] != null && typeof scheduleData[key] !== 'string') || (scheduleData.scheduleEnabled != null && typeof scheduleData.scheduleEnabled !== 'boolean')) return c.json({ success: false, error: '設定の形式が不正です' }, 400);
    
    // Validate required fields
    if (!scheduleData.name) {
      return c.json({
        success: false,
        error: 'Schedule name is required'
      }, 400);
    }
    
    if (!scheduleData.content) {
      return c.json({
        success: false,
        error: 'Message content is required'
      }, 400);
    }
    
    if (!scheduleData.scheduleCron) {
      return c.json({
        success: false,
        error: 'Schedule cron expression is required'
      }, 400);
    }
    
    if (scheduleData.id) {
      // Update existing schedule
      const updateResult = await query(
        `UPDATE broadcast_messages 
        SET name = $1, content = $2, image_url = $3, channel_type = $4, 
            target_status = $5, target_tutor = $6, schedule_cron = $7, 
            schedule_enabled = $8, updated_at = CURRENT_TIMESTAMP
        WHERE id = $9 AND created_by = $10 AND is_scheduled = true
        RETURNING id`,
        [
          scheduleData.name,
          scheduleData.content,
          scheduleData.imageId || null,
          scheduleData.channelType,
          scheduleData.targetStatus || 'アクティブ',
          scheduleData.targetTutor || null,
          scheduleData.scheduleCron,
          scheduleData.scheduleEnabled !== false,
          scheduleData.id,
          user.email
        ]
      );
      
      if (updateResult.rows.length === 0) {
        return c.json({
          success: false,
          error: 'Schedule not found or permission denied'
        }, 404);
      }
      
      return c.json({
        success: true,
        message: 'Schedule updated',
        id: scheduleData.id
      });
    } else {
      // Create new schedule
      const insertResult = await query(
        `INSERT INTO broadcast_messages 
          (name, content, image_url, channel_type, target_status, target_tutor, 
           created_by, is_template, is_scheduled, schedule_cron, schedule_enabled, schedule_start_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, $8, $9, CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          scheduleData.name,
          scheduleData.content,
          scheduleData.imageId || null,
          scheduleData.channelType,
          scheduleData.targetStatus || 'アクティブ',
          scheduleData.targetTutor || null,
          user.email,
          scheduleData.scheduleCron,
          scheduleData.scheduleEnabled !== false
        ]
      );
      
      return c.json({
        success: true,
        message: 'Schedule created',
        id: insertResult.rows[0].id
      });
    }
  } catch (error) {
    console.error('Error saving schedule:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * DELETE /api/broadcast/schedules/:id
 * Delete scheduled broadcast
 */
app.delete('/schedules/:id', async (c) => {
  try {
    const user = c.get('user');
    const scheduleId = c.req.param('id');
    if (!/^\d+$/.test(scheduleId) || !Number.isSafeInteger(Number(scheduleId)) || Number(scheduleId) <= 0) return c.json({ success: false, error: 'IDが不正です' }, 400);
    
    let deleteQuery = `DELETE FROM broadcast_messages WHERE id = $1 AND is_scheduled = true`;
    const params = [scheduleId];
    
    // Crew can only delete their own schedules
    if (user.role === 'crew') {
      deleteQuery += ` AND created_by = $2`;
      params.push(user.email);
    }
    
    const result = await query(deleteQuery, params);
    
    if (result.rowCount === 0) {
      return c.json({
        success: false,
        error: 'Schedule not found or permission denied'
      }, 404);
    }
    
    return c.json({
      success: true,
      message: 'Schedule deleted'
    });
  } catch (error) {
    console.error('Error deleting schedule:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * POST /api/broadcast/schedules/:id/toggle
 * Toggle schedule enabled/disabled
 */
app.post('/schedules/:id/toggle', async (c) => {
  try {
    const user = c.get('user');
    const scheduleId = c.req.param('id');
    if (!/^\d+$/.test(scheduleId) || !Number.isSafeInteger(Number(scheduleId)) || Number(scheduleId) <= 0) return c.json({ success: false, error: 'IDが不正です' }, 400);
    
    let updateQuery = `
      UPDATE broadcast_messages 
      SET schedule_enabled = NOT schedule_enabled, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND is_scheduled = true
    `;
    const params = [scheduleId];
    
    // Crew can only toggle their own schedules
    if (user.role === 'crew') {
      updateQuery += ` AND created_by = $2`;
      params.push(user.email);
    }
    
    updateQuery += ` RETURNING schedule_enabled`;
    
    const result = await query(updateQuery, params);
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Schedule not found or permission denied'
      }, 404);
    }
    
    return c.json({
      success: true,
      enabled: result.rows[0].schedule_enabled
    });
  } catch (error) {
    console.error('Error toggling schedule:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

/**
 * GET /api/broadcast/images/:imageId
 * Get image data from database
 */
app.get('/images/:imageId', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Vary', 'Authorization');
  try {
    const imageId = c.req.param('imageId');
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(imageId)) return c.json({ success: false, error: 'Invalid image ID' }, 400);
    
    console.log('[Broadcast] Retrieving image from database');
    
    const result = await query(
      'SELECT filename, content_type, image_data FROM broadcast_images WHERE image_id = $1',
      [imageId]
    );
    
    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Image not found'
      }, 404);
    }
    
    const image = result.rows[0];
    const bytes = Buffer.from(image.image_data);
    const contentType = broadcastInlineImageType(bytes);
    
    console.log('[Broadcast] Image retrieved');
    
    // Return image data
    return new Response(bytes, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Disposition': broadcastImageDisposition(Boolean(contentType), image.filename),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
        'Cache-Control': 'private, no-store',
        'Vary': 'Authorization'
      }
    });
  } catch (error) {
    console.error('Error retrieving image:');
    return c.json({
      success: false,
      error: safeBroadcastError(error)
    }, 500);
  }
});

export default app;
