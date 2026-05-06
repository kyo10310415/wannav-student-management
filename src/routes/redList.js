import { Hono } from 'hono';
import { calculateRedListScore, updateRedList, updateAllRedLists, getRedList, getAllRedLists } from '../services/redListService.js';
import { query } from '../db/connection.js';
import { sendDiscordMessage, getStudentDiscordInfo } from '../services/discordService.js';

const app = new Hono();

// ─────────────────────────────────────────
// 認証ミドルウェア（Bearer トークン検証）
// ─────────────────────────────────────────
async function authMiddleware(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const result = await query(
      `SELECT u.id, u.email, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401);
    }
    c.set('user', result.rows[0]);
    await next();
  } catch (error) {
    return c.json({ success: false, error: 'Auth error' }, 500);
  }
}

// Hono v4 では app.use() でスコープを絞って適用する
app.use('/messages', authMiddleware);
app.use('/messages/*', authMiddleware);
app.use('/senders', authMiddleware);
app.use('/senders/*', authMiddleware);
app.use('/discord/*', authMiddleware);

// ─────────────────────────────────────────
// GET /api/red-list  — 今月のレッドリスト一覧
// ─────────────────────────────────────────
app.get('/', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    const redLists = await getAllRedLists(yearMonth);
    return c.json({ success: true, data: redLists, count: redLists.length });
  } catch (error) {
    console.error('Error fetching red lists:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// POST /api/red-list/update  — 全員更新
// ─────────────────────────────────────────
app.post('/update', async (c) => {
  try {
    let yearMonth = null;
    try {
      const body = await c.req.json();
      yearMonth = body.yearMonth;
    } catch (e) { /* empty body → current month */ }
    const result = await updateAllRedLists(yearMonth);
    return c.json({
      success: true,
      message: `Red list updated: ${result.updated} students, ${result.errors} errors`,
      data: result
    });
  } catch (error) {
    console.error('Error updating red lists:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// POST /api/red-list/update/:studentId  — 個別更新
// ─────────────────────────────────────────
app.post('/update/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    let yearMonth = null;
    try {
      const body = await c.req.json();
      yearMonth = body.yearMonth;
    } catch (e) { /* empty body → current month */ }
    const scores = await updateRedList(studentId, yearMonth);
    return c.json({ success: true, message: `Red list updated for ${studentId}`, data: scores });
  } catch (error) {
    console.error('Error updating red list:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// GET /api/red-list/history  — 過去月履歴
// ─────────────────────────────────────────
app.get('/history', async (c) => {
  try {
    const { yearMonth } = c.req.query();
    if (!yearMonth) {
      return c.json({ success: false, error: 'yearMonth is required' }, 400);
    }
    const result = await query(
      `SELECT rlh.*, s.name AS student_name, s.homeroom_tutor
       FROM red_list_history rlh
       LEFT JOIN students s ON rlh.student_id = s.student_id
       WHERE rlh.year_month = $1
       ORDER BY rlh.final_score DESC, rlh.student_id`,
      [yearMonth]
    );
    return c.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching red list history:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// ▼▼▼  送信メッセージ管理 API  ▼▼▼
// ─────────────────────────────────────────

/**
 * GET /api/red-list/messages
 * 送信メッセージテンプレート一覧取得（image_data 以外を返す）
 */
app.get('/messages', async (c) => {
  try {
    const result = await query(
      `SELECT id, title, content,
              image_filename, image_content_type,
              CASE WHEN image_data IS NOT NULL THEN true ELSE false END AS has_image,
              created_by, created_at, updated_at
       FROM red_list_messages
       ORDER BY created_at DESC`
    );
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching red list messages:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/red-list/messages
 * 送信メッセージテンプレート作成（multipart/form-data）
 * フィールド: title (string), content (string), image (File, optional)
 */
app.post('/messages', async (c) => {
  try {
    const user = c.get('user');
    const contentType = c.req.header('content-type') || '';

    let title, content, imageData = null, imageFilename = null, imageContentType = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      title   = formData.get('title');
      content = formData.get('content');
      const imageFile = formData.get('image');
      if (imageFile && imageFile.size > 0) {
        const buf = await imageFile.arrayBuffer();
        imageData        = Buffer.from(buf);
        imageFilename    = imageFile.name;
        imageContentType = imageFile.type;
      }
    } else {
      const body = await c.req.json();
      title   = body.title;
      content = body.content;
    }

    if (!title || !content) {
      return c.json({ success: false, error: 'title と content は必須です' }, 400);
    }

    const result = await query(
      `INSERT INTO red_list_messages
         (title, content, image_data, image_filename, image_content_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, image_filename, image_content_type,
                 CASE WHEN image_data IS NOT NULL THEN true ELSE false END AS has_image,
                 created_by, created_at, updated_at`,
      [title.trim(), content.trim(), imageData, imageFilename, imageContentType, user.email]
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating red list message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * PUT /api/red-list/messages/:id
 * 送信メッセージテンプレート更新（multipart/form-data）
 * フィールド: title, content, image (optional), removeImage (optional "true")
 */
app.put('/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const contentType = c.req.header('content-type') || '';

    let title, content, imageData, imageFilename, imageContentType, removeImage = false;

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      title       = formData.get('title');
      content     = formData.get('content');
      removeImage = formData.get('removeImage') === 'true';
      const imageFile = formData.get('image');
      if (imageFile && imageFile.size > 0) {
        const buf = await imageFile.arrayBuffer();
        imageData        = Buffer.from(buf);
        imageFilename    = imageFile.name;
        imageContentType = imageFile.type;
      }
    } else {
      const body = await c.req.json();
      title   = body.title;
      content = body.content;
    }

    if (!title || !content) {
      return c.json({ success: false, error: 'title と content は必須です' }, 400);
    }

    let result;
    if (imageData) {
      // 新しい画像で上書き
      result = await query(
        `UPDATE red_list_messages
         SET title = $1, content = $2,
             image_data = $3, image_filename = $4, image_content_type = $5,
             updated_at = NOW()
         WHERE id = $6
         RETURNING id, title, content, image_filename, image_content_type,
                   CASE WHEN image_data IS NOT NULL THEN true ELSE false END AS has_image,
                   created_by, created_at, updated_at`,
        [title.trim(), content.trim(), imageData, imageFilename, imageContentType, id]
      );
    } else if (removeImage) {
      // 画像を削除
      result = await query(
        `UPDATE red_list_messages
         SET title = $1, content = $2,
             image_data = NULL, image_filename = NULL, image_content_type = NULL,
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, title, content, image_filename, image_content_type,
                   CASE WHEN image_data IS NOT NULL THEN true ELSE false END AS has_image,
                   created_by, created_at, updated_at`,
        [title.trim(), content.trim(), id]
      );
    } else {
      // テキストのみ更新（画像は変更しない）
      result = await query(
        `UPDATE red_list_messages
         SET title = $1, content = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, title, content, image_filename, image_content_type,
                   CASE WHEN image_data IS NOT NULL THEN true ELSE false END AS has_image,
                   created_by, created_at, updated_at`,
        [title.trim(), content.trim(), id]
      );
    }

    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'メッセージが見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating red list message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * DELETE /api/red-list/messages/:id
 * 送信メッセージテンプレート削除
 */
app.delete('/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await query('DELETE FROM red_list_messages WHERE id = $1', [id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting red list message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/red-list/messages/:id/image
 * テンプレートに添付された画像を返す
 */
app.get('/messages/:id/image', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await query(
      'SELECT image_data, image_content_type, image_filename FROM red_list_messages WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0 || !result.rows[0].image_data) {
      return c.json({ success: false, error: '画像が見つかりません' }, 404);
    }
    const { image_data, image_content_type, image_filename } = result.rows[0];
    return new Response(image_data, {
      headers: {
        'Content-Type': image_content_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${image_filename || 'image'}"`,
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error fetching message image:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// ▼▼▼  送信者管理 API  ▼▼▼
// ─────────────────────────────────────────

/**
 * GET /api/red-list/senders
 * 送信者一覧取得
 */
app.get('/senders', async (c) => {
  try {
    const result = await query(
      `SELECT id, name, booking_url, created_by, created_at, updated_at
       FROM red_list_senders
       ORDER BY created_at ASC`
    );
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching senders:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/red-list/senders
 * 送信者作成
 */
app.post('/senders', async (c) => {
  try {
    const user = c.get('user');
    const { name, booking_url } = await c.req.json();
    if (!name || !booking_url) {
      return c.json({ success: false, error: '送信者名と予約URLは必須です' }, 400);
    }
    const result = await query(
      `INSERT INTO red_list_senders (name, booking_url, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), booking_url.trim(), user.email]
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating sender:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * PUT /api/red-list/senders/:id
 * 送信者更新
 */
app.put('/senders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { name, booking_url } = await c.req.json();
    if (!name || !booking_url) {
      return c.json({ success: false, error: '送信者名と予約URLは必須です' }, 400);
    }
    const result = await query(
      `UPDATE red_list_senders
       SET name = $1, booking_url = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name.trim(), booking_url.trim(), id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '送信者が見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating sender:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * DELETE /api/red-list/senders/:id
 * 送信者削除
 */
app.delete('/senders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await query('DELETE FROM red_list_senders WHERE id = $1', [id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting sender:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// ▼▼▼  Discord 送信 API  ▼▼▼
// ─────────────────────────────────────────

/**
 * POST /api/red-list/discord/send
 * 対象生徒に Discord メッセージを送信し、ログを保存
 * body (JSON): { studentId, yearMonth, studentName, messageId?, messageContent? }
 *   - messageId      … red_list_messages.id（テンプレート使用時）
 *   - messageContent … 自由入力テキスト（テンプレート未使用時）
 *   - studentName    … 〇〇 プレースホルダー置換用
 *   - senderId       … red_list_senders.id（送信者選択時、メッセージ末尾に予約URLを付加）
 */
app.post('/discord/send', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { studentId, yearMonth, studentName, messageId, messageContent, senderId } = body;

    if (!studentId || !yearMonth) {
      return c.json({ success: false, error: 'studentId と yearMonth は必須です' }, 400);
    }
    if (!messageId && !messageContent) {
      return c.json({ success: false, error: 'messageId か messageContent のどちらかは必須です' }, 400);
    }

    // メッセージ本文・タイトル・画像を解決
    let finalContent      = messageContent || null;
    let finalTitle        = null;
    let attachmentBuffer  = null;
    let attachmentFilename = null;

    if (messageId) {
      const msgResult = await query(
        'SELECT title, content, image_data, image_filename, image_content_type FROM red_list_messages WHERE id = $1',
        [messageId]
      );
      if (msgResult.rows.length === 0) {
        return c.json({ success: false, error: '指定されたメッセージが見つかりません' }, 404);
      }
      finalTitle        = msgResult.rows[0].title;
      finalContent      = msgResult.rows[0].content;
      attachmentBuffer  = msgResult.rows[0].image_data;
      attachmentFilename = msgResult.rows[0].image_filename;
    }

    // 〇〇（全角・半角）→ 生徒名に置換
    if (studentName && finalContent) {
      finalContent = finalContent
        .replace(/〇〇/g, studentName)
        .replace(/○○/g, studentName);
    }

    // 送信者の予約URLをメッセージ末尾に追加
    if (senderId) {
      const senderResult = await query(
        'SELECT name, booking_url FROM red_list_senders WHERE id = $1',
        [senderId]
      );
      if (senderResult.rows.length > 0) {
        const { name, booking_url } = senderResult.rows[0];
        finalContent = `${finalContent}\n\n📅 **予約はこちらから（担当: ${name}）**\n${booking_url}`;
      }
    }

    // 生徒の Discord チャット URL を取得
    const discordInfo = await getStudentDiscordInfo(studentId);
    if (!discordInfo.chatUrl) {
      return c.json({ success: false, error: `生徒 ${studentId} の Discord チャット URL が設定されていません` }, 400);
    }

    // Discord 送信ペイロードを構築
    let sendPayload;
    if (discordInfo.discordId) {
      const textWithMention = `<@${discordInfo.discordId}>\n\n${finalContent}`;
      if (attachmentBuffer) {
        const { AttachmentBuilder } = await import('discord.js');
        sendPayload = {
          content: textWithMention,
          files: [new AttachmentBuilder(attachmentBuffer, { name: attachmentFilename || 'image.png' })]
        };
      } else {
        sendPayload = textWithMention;
      }
    } else {
      if (attachmentBuffer) {
        const { AttachmentBuilder } = await import('discord.js');
        sendPayload = {
          content: finalContent,
          files: [new AttachmentBuilder(attachmentBuffer, { name: attachmentFilename || 'image.png' })]
        };
      } else {
        sendPayload = finalContent;
      }
    }

    const sendResult = await sendDiscordMessage(discordInfo.chatUrl, sendPayload);

    if (!sendResult.success) {
      return c.json({
        success: false,
        error: sendResult.error || 'Discord への送信に失敗しました'
      }, 500);
    }

    // 送信ログを DB に保存
    await query(
      `INSERT INTO red_list_discord_logs
         (student_id, year_month, message_id, message_title, message_content, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        studentId,
        yearMonth,
        messageId || null,
        finalTitle,
        finalContent,
        user.email
      ]
    );

    // 送信者名（senderId があれば送信者マスタの name、なければメールアドレス）を担当にセット
    let assignedToName = user.email;
    if (senderId) {
      const senderRow = await query(
        'SELECT name FROM red_list_senders WHERE id = $1',
        [senderId]
      );
      if (senderRow.rows.length > 0) assignedToName = senderRow.rows[0].name;
    }
    await query(
      `UPDATE red_list
         SET assigned_to = $1, updated_at = NOW()
       WHERE student_id = $2 AND year_month = $3`,
      [assignedToName, studentId, yearMonth]
    );

    return c.json({ success: true, messageId: sendResult.id, assignedTo: assignedToName });
  } catch (error) {
    console.error('Error sending red list discord message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/red-list/discord/test-send
 * テスト送信（固定チャンネル・固定ユーザーへ送信）
 * body (JSON): { messageId?, messageContent? }
 */
const TEST_CHANNEL_URL = 'https://discord.com/channels/1176426605309083678/1293539258069417994';
const TEST_USER_ID     = '766666980086120470';

app.post('/discord/test-send', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { messageId, messageContent, senderId } = body;

    if (!messageId && !messageContent) {
      return c.json({ success: false, error: 'messageId か messageContent のどちらかは必須です' }, 400);
    }

    // メッセージ本文・タイトル・画像を解決
    let finalContent       = messageContent || null;
    let finalTitle         = 'テスト送信';
    let attachmentBuffer   = null;
    let attachmentFilename = null;

    if (messageId) {
      const msgResult = await query(
        'SELECT title, content, image_data, image_filename FROM red_list_messages WHERE id = $1',
        [messageId]
      );
      if (msgResult.rows.length === 0) {
        return c.json({ success: false, error: '指定されたメッセージが見つかりません' }, 404);
      }
      finalTitle         = msgResult.rows[0].title;
      finalContent       = msgResult.rows[0].content;
      attachmentBuffer   = msgResult.rows[0].image_data;
      attachmentFilename = msgResult.rows[0].image_filename;
    }

    // 〇〇 → テスト表記に置換
    if (finalContent) {
      finalContent = finalContent
        .replace(/〇〇/g, 'テスト生徒')
        .replace(/○○/g, 'テスト生徒');
    }

    // 送信者の予約URLをメッセージ末尾に追加
    if (senderId) {
      const senderResult = await query(
        'SELECT name, booking_url FROM red_list_senders WHERE id = $1',
        [senderId]
      );
      if (senderResult.rows.length > 0) {
        const { name, booking_url } = senderResult.rows[0];
        finalContent = `${finalContent}\n\n📅 **予約はこちらから（担当: ${name}）**\n${booking_url}`;
      }
    }

    // テスト用メンション付きメッセージ
    const testHeader  = `🧪 **【テスト送信】** ｜送信者: ${user.email}\n\n`;
    const textContent = `<@${TEST_USER_ID}>\n\n${testHeader}${finalContent}`;

    // 送信ペイロードを構築
    let sendPayload;
    if (attachmentBuffer) {
      const { AttachmentBuilder } = await import('discord.js');
      sendPayload = {
        content: textContent,
        files: [new AttachmentBuilder(attachmentBuffer, { name: attachmentFilename || 'image.png' })]
      };
    } else {
      sendPayload = textContent;
    }

    const sendResult = await sendDiscordMessage(TEST_CHANNEL_URL, sendPayload);

    if (!sendResult.success) {
      return c.json({
        success: false,
        error: sendResult.error || 'テスト送信に失敗しました'
      }, 500);
    }

    return c.json({
      success: true,
      messageId: sendResult.id,
      testChannelUrl: TEST_CHANNEL_URL,
      testUserId: TEST_USER_ID
    });
  } catch (error) {
    console.error('Error sending test discord message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/red-list/discord/logs
 * 送信ログ一覧
 * query: studentId (optional), yearMonth (optional)
 */
app.get('/discord/logs', async (c) => {
  try {
    const { studentId, yearMonth } = c.req.query();
    const conditions = [];
    const params = [];

    if (studentId) {
      params.push(studentId);
      conditions.push(`l.student_id = $${params.length}`);
    }
    if (yearMonth) {
      params.push(yearMonth);
      conditions.push(`l.year_month = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT l.*, s.name AS student_name
       FROM red_list_discord_logs l
       LEFT JOIN students s ON l.student_id = s.student_id
       ${where}
       ORDER BY l.sent_at DESC
       LIMIT 200`,
      params
    );

    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching discord logs:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// PATCH /api/red-list/:studentId/status  — 対応状況・担当を更新
// ─────────────────────────────────────────
app.patch('/:studentId/status', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const { yearMonth, correspondence_status, assigned_to } = await c.req.json();

    if (!yearMonth) {
      return c.json({ success: false, error: 'yearMonth は必須です' }, 400);
    }

    const fields = [];
    const params = [];

    if (correspondence_status !== undefined) {
      params.push(correspondence_status);
      fields.push(`correspondence_status = $${params.length}`);
    }
    if (assigned_to !== undefined) {
      params.push(assigned_to);
      fields.push(`assigned_to = $${params.length}`);
    }

    if (fields.length === 0) {
      return c.json({ success: false, error: '更新するフィールドがありません' }, 400);
    }

    params.push(studentId, yearMonth);
    const result = await query(
      `UPDATE red_list
         SET ${fields.join(', ')}, updated_at = NOW()
       WHERE student_id = $${params.length - 1}
         AND year_month = $${params.length}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'レコードが見つかりません' }, 404);
    }

    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating red list status:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// GET /api/red-list/:studentId  — 個別取得（動的ルートは最後）
// ─────────────────────────────────────────
app.get('/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const { yearMonth } = c.req.query();
    const redList = await getRedList(studentId, yearMonth);
    if (!redList) {
      const scores = await calculateRedListScore(studentId, yearMonth || getCurrentYearMonth());
      await updateRedList(studentId, yearMonth);
      return c.json({ success: true, data: scores, message: 'Calculated and saved' });
    }
    return c.json({ success: true, data: redList });
  } catch (error) {
    console.error('Error fetching red list:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────
function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default app;
