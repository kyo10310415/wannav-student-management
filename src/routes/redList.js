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
       WHERE s.token = $1 AND s.expires_at > NOW()`,
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
 * 送信メッセージテンプレート一覧取得
 */
app.get('/messages', async (c) => {
  try {
    const result = await query(
      `SELECT id, title, content, created_by, created_at, updated_at
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
 * 送信メッセージテンプレート作成
 */
app.post('/messages', async (c) => {
  try {
    const user = c.get('user');
    const { title, content } = await c.req.json();
    if (!title || !content) {
      return c.json({ success: false, error: 'title と content は必須です' }, 400);
    }
    const result = await query(
      `INSERT INTO red_list_messages (title, content, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), content.trim(), user.email]
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating red list message:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * PUT /api/red-list/messages/:id
 * 送信メッセージテンプレート更新
 */
app.put('/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { title, content } = await c.req.json();
    if (!title || !content) {
      return c.json({ success: false, error: 'title と content は必須です' }, 400);
    }
    const result = await query(
      `UPDATE red_list_messages
       SET title = $1, content = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [title.trim(), content.trim(), id]
    );
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

// ─────────────────────────────────────────
// ▼▼▼  Discord 送信 API  ▼▼▼
// ─────────────────────────────────────────

/**
 * POST /api/red-list/discord/send
 * 対象生徒に Discord メッセージを送信し、ログを保存
 * body: { studentId, yearMonth, messageId, messageContent? }
 *   - messageId  … red_list_messages.id（テンプレート使用時）
 *   - messageContent … 自由入力テキスト（messageId と排他）
 */
app.post('/discord/send', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { studentId, yearMonth, messageId, messageContent } = body;

    if (!studentId || !yearMonth) {
      return c.json({ success: false, error: 'studentId と yearMonth は必須です' }, 400);
    }
    if (!messageId && !messageContent) {
      return c.json({ success: false, error: 'messageId か messageContent のどちらかは必須です' }, 400);
    }

    // メッセージ本文とタイトルを解決
    let finalContent = messageContent || null;
    let finalTitle   = null;

    if (messageId) {
      const msgResult = await query(
        'SELECT title, content FROM red_list_messages WHERE id = $1',
        [messageId]
      );
      if (msgResult.rows.length === 0) {
        return c.json({ success: false, error: '指定されたメッセージが見つかりません' }, 404);
      }
      finalTitle   = msgResult.rows[0].title;
      finalContent = msgResult.rows[0].content;
    }

    // 生徒の Discord チャット URL を取得
    const discordInfo = await getStudentDiscordInfo(studentId);
    if (!discordInfo.chatUrl) {
      return c.json({ success: false, error: `生徒 ${studentId} の Discord チャット URL が設定されていません` }, 400);
    }

    // Discord 送信（discordId があればメンション付き）
    let sendContent = finalContent;
    if (discordInfo.discordId) {
      sendContent = `<@${discordInfo.discordId}>\n\n${finalContent}`;
    }

    const sendResult = await sendDiscordMessage(discordInfo.chatUrl, sendContent);

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

    return c.json({ success: true, messageId: sendResult.id });
  } catch (error) {
    console.error('Error sending red list discord message:', error);
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
