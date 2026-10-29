import { Hono } from 'hono';
import { getClient, query } from '../db/connection.js';
import bcrypt from 'bcryptjs';
import { generateTemporaryPassword } from '../security/temporaryPassword.js';

const app = new Hono();

async function readUserSettingsBody(c) {
  try { const body = await c.req.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body : null; }
  catch { return null; }
}
function optionalUserText(value) {
  return value == null || (typeof value === 'string' && !value.includes('\u0000'));
}

/**
 * Middleware to verify admin role
 */
async function requireAdmin(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return c.json({
      success: false,
      error: '認証が必要です'
    }, 401);
  }
  
  let sessionResult;
  try {
    sessionResult = await query(
      'SELECT u.role, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.expires_at > NOW()',
      [sessionToken]
    );
  } catch {
    console.error('[Users] Admin session lookup failed');
    return c.json({ success: false, error: '認証情報を確認できません' }, 500);
  }
  
  if (sessionResult.rows.length === 0) {
    return c.json({
      success: false,
      error: 'セッションが無効です'
    }, 401);
  }
  
  if (sessionResult.rows[0].role !== 'admin') {
    return c.json({
      success: false,
      error: '管理者権限が必要です'
    }, 403);
  }

  c.set('currentUser', sessionResult.rows[0]);
  
  await next();
}

/**
 * Get all users (admin only)
 */
app.get('/', requireAdmin, async (c) => {
  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.role,
        u.must_change_password,
        u.created_at,
        u.last_login,
        COALESCE(u.discord_webhook_url, '') <> '' AS has_discord_webhook,
        COALESCE(u.discord_user_id, '') <> '' AS has_discord_user_id,
        u.discord_reply_alerts_enabled,
        u.job_title,
        u.funnel_regular_booking_url,
        u.funnel_pro_booking_url,
        t.tutor_name as tutor_name,
        t.employee_id as tutor_number
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      ORDER BY u.created_at DESC
    `);
    
    return c.json({
      success: true,
      data: result.rows.map(({ discord_webhook_url, discord_user_id, ...user }) => user)
    });
    
  } catch (error) {
    console.error('Get users error:');
    return c.json({
      success: false,
      error: 'ユーザー情報の処理に失敗しました'
    }, 500);
  }
});

/**
 * Get consultation staff (leader and above with tutor_name)
 */
app.get('/consultation-staff', async (c) => {
  try {
    const result = await query(`
      SELECT 
        t.tutor_name
      FROM users u
      INNER JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE u.role IN ('admin', 'leader')
        AND t.tutor_name IS NOT NULL
        AND t.tutor_name != ''
      ORDER BY t.tutor_name ASC
    `);
    
    return c.json({
      success: true,
      data: result.rows.map(row => row.tutor_name)
    });
    
  } catch (error) {
    console.error('Get consultation staff error:');
    return c.json({
      success: false,
      error: 'ユーザー情報の処理に失敗しました'
    }, 500);
  }
});

/** Tutor別予約URLの変更履歴を取得（管理者のみ） */
app.get('/:id/booking-links/history', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');
    const userResult = await query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return c.json({ success: false, error: 'ユーザーが見つかりません' }, 404);
    }
    const result = await query(
      `SELECT id, previous_regular_url, previous_pro_url,
              new_regular_url, new_pro_url, changed_by, change_source, changed_at
         FROM tutor_booking_url_history
        WHERE user_id = $1 OR LOWER(user_email) = LOWER($2)
        ORDER BY changed_at DESC, id DESC
        LIMIT 20`,
      [userId, userResult.rows[0].email]
    );
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get booking link history error:');
    return c.json({ success: false, error: '予約URL変更履歴の取得に失敗しました' }, 500);
  }
});

/** Tutor別のファネル判定用予約URLを更新（管理者のみ） */
app.put('/:id/booking-links', requireAdmin, async (c) => {
  let client;
  try {
    const userId = c.req.param('id');
    const body = await readUserSettingsBody(c);
    if (!body || !optionalUserText(body.regularUrl) || !optionalUserText(body.proUrl)) return c.json({ success: false, error: '設定が不正です' }, 400);
    const { regularUrl = '', proUrl = '' } = body;
    for (const [label, value] of [['通常レッスン', regularUrl], ['PROプランレッスン', proUrl]]) {
      if (value && !/^https:\/\//i.test(String(value).trim())) {
        return c.json({ success: false, error: `${label}の予約URLは https:// から入力してください` }, 400);
      }
    }

    const normalizedRegularUrl = String(regularUrl ?? '').trim() || null;
    const normalizedProUrl = String(proUrl ?? '').trim() || null;
    client = await getClient();
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.booking_url_changed_by', $1, TRUE),
              set_config('app.booking_url_change_source', 'user_management', TRUE)`,
      [c.get('currentUser')?.email || 'unknown']
    );
    const currentResult = await client.query(
      `SELECT u.id, u.email, u.funnel_regular_booking_url, u.funnel_pro_booking_url
         FROM users u
        WHERE u.id = $1
          AND EXISTS (
            SELECT 1 FROM tutors t WHERE LOWER(t.email) = LOWER(u.email)
          )
        FOR UPDATE`,
      [userId]
    );
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Tutorと紐付くユーザーが見つかりません' }, 404);
    }

    const result = await client.query(
      `UPDATE users
          SET funnel_regular_booking_url = $1,
              funnel_pro_booking_url = $2,
              updated_at = NOW()
        WHERE id = $3
      RETURNING id`,
      [normalizedRegularUrl, normalizedProUrl, userId]
    );
    await client.query('COMMIT');
    return c.json({ success: true, data: result.rows[0], message: '予約URL設定を保存しました' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Update booking link settings error:');
    return c.json({ success: false, error: '予約URL設定の保存に失敗しました' }, 500);
  } finally {
    client?.release();
  }
});

/**
 * Create user (admin only)
 */
app.post('/', requireAdmin, async (c) => {
  try {
    const body = await readUserSettingsBody(c);
    if (!body) return c.json({ success: false, error: '設定が不正です' }, 400);
    const { email, role } = body;
    
    if (!email || !role) {
      return c.json({
        success: false,
        error: 'メールアドレスと権限を入力してください'
      }, 400);
    }
    if (typeof email !== 'string' || !email.trim() || [...email].length > 255 || email.includes('\u0000')) {
      return c.json({ success: false, error: 'メールアドレスが不正です' }, 400);
    }
    
    if (!['admin', 'leader', 'crew'].includes(role)) {
      return c.json({
        success: false,
        error: '権限は「admin」「leader」「crew」のいずれかにしてください'
      }, 400);
    }
    
    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return c.json({
        success: false,
        error: 'このメールアドレスは既に登録されています'
      }, 400);
    }
    
    // Issue a unique temporary password; persist only its hash.
    c.header('Cache-Control', 'no-store');
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    
    const result = await query(
      'INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, $3, TRUE) RETURNING id, email, role',
      [email.toLowerCase(), passwordHash, role]
    );
    
    return c.json({
      success: true,
      data: result.rows[0],
      message: 'ユーザーを作成しました',
      temporaryPassword
    });
    
  } catch (error) {
    console.error('Create user error:');
    return c.json({
      success: false,
      error: 'ユーザー作成に失敗しました'
    }, 500);
  }
});

/**
 * Update user role (admin only)
 */
app.put('/:id', requireAdmin, async (c) => {
  const rawId = c.req.param('id');
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) <= 0) {
    return c.json({ success: false, error: 'ユーザーIDが不正です' }, 400);
  }
  try {
    const userId = c.req.param('id');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: '設定が不正です' }, 400); }
    const role = body?.role;
    
    if (!role) {
      return c.json({
        success: false,
        error: '権限を指定してください'
      }, 400);
    }
    
    if (!['admin', 'leader', 'crew'].includes(role)) {
      return c.json({
        success: false,
        error: '権限は「admin」「leader」「crew」のいずれかにしてください'
      }, 400);
    }
    
    await query(
      'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [role, userId]
    );
    
    return c.json({
      success: true,
      message: 'ユーザーの権限を更新しました'
    });
    
  } catch (error) {
    console.error('Update user error:');
    return c.json({
      success: false,
      error: 'ユーザー更新に失敗しました'
    }, 500);
  }
});

/**
 * Update user job_title (admin only)
 */
app.put('/:id/job-title', requireAdmin, async (c) => {
  const rawId = c.req.param('id');
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) <= 0) {
    return c.json({ success: false, error: 'ユーザーIDが不正です' }, 400);
  }
  try {
    const userId = c.req.param('id');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: '設定が不正です' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ success: false, error: '設定が不正です' }, 400);
    const { job_title } = body;

    const VALID_TITLES = ['マネージャー', '統括', 'リーダー', 'クルー', '部署移動', '契約解除', ''];
    if (!VALID_TITLES.includes(job_title ?? '')) {
      return c.json({ success: false, error: '無効な役職です' }, 400);
    }

    await query(
      'UPDATE users SET job_title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [job_title || null, userId]
    );

    return c.json({ success: true, message: '役職を更新しました' });
  } catch (error) {
    console.error('Update job_title error:');
    return c.json({ success: false, error: '役職の更新に失敗しました' }, 500);
  }
});

/**
 * Delete user (admin only)
 */
/**
 * Update user Discord settings (admin only)
 */
app.put('/:id/reply-alerts', requireAdmin, async (c) => {
  const rawId = c.req.param('id');
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) <= 0) {
    return c.json({ success: false, error: 'ユーザーIDが不正です' }, 400);
  }
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ success:false, error:'設定が不正です' },400); }
  if (typeof body?.enabled !== 'boolean') return c.json({ success:false, error:'通知設定はON/OFFで指定してください' },400);
  try {
    const result = await query('UPDATE users SET discord_reply_alerts_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING id, discord_reply_alerts_enabled', [body.enabled,c.req.param('id')]);
    if (!result.rows.length) return c.json({success:false,error:'ユーザーが見つかりません'},404);
    return c.json({success:true,data:result.rows[0]});
  } catch {
    console.error('[DiscordReplyMonitor] Preference update failed');
    return c.json({success:false,error:'未返信通知の設定更新に失敗しました'},500);
  }
});

// Read selected settings only; never return these secrets in the users list.
app.get('/:id/discord', requireAdmin, async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const rawId = c.req.param('id');
  const userId = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(userId) || userId <= 0) {
    return c.json({ success: false, error: 'ユーザーIDが不正です' }, 400);
  }
  try {
    const result = await query(
      'SELECT id, email, discord_webhook_url, discord_user_id FROM users WHERE id = $1', [userId]
    );
    if (!result.rows[0]) return c.json({ success: false, error: 'ユーザーが見つかりません' }, 404);
    return c.json({ success: true, data: result.rows[0] });
  } catch {
    console.error('Get Discord settings error');
    return c.json({ success: false, error: 'Discord設定の取得に失敗しました' }, 500);
  }
});

app.put('/:id/discord', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');
    const body = await readUserSettingsBody(c);
    if (!body || !optionalUserText(body.discord_webhook_url) || !optionalUserText(body.discord_user_id)) return c.json({ success: false, error: '設定が不正です' }, 400);
    const { discord_webhook_url, discord_user_id } = body;
    
    // Check if user exists
    const userResult = await query('SELECT id FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'ユーザーが見つかりません'
      }, 404);
    }
    
    // Update Discord settings
    await query(
      'UPDATE users SET discord_webhook_url = $1, discord_user_id = $2, updated_at = NOW() WHERE id = $3',
      [discord_webhook_url, discord_user_id, userId]
    );
    
    return c.json({
      success: true,
      message: 'Discord設定を更新しました'
    });
    
  } catch (error) {
    console.error('Update Discord settings error:');
    return c.json({
      success: false,
      error: 'Discord設定の更新に失敗しました'
    }, 500);
  }
});

/**
 * Delete user (admin only)
 */
app.delete('/:id', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');
    
    // Check if user exists
    const userResult = await query('SELECT id FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'ユーザーが見つかりません'
      }, 404);
    }
    
    // Delete user (sessions will be deleted by CASCADE)
    await query('DELETE FROM users WHERE id = $1', [userId]);
    
    return c.json({
      success: true,
      message: 'ユーザーを削除しました'
    });
    
  } catch (error) {
    console.error('Delete user error:');
    return c.json({
      success: false,
      error: 'ユーザー削除に失敗しました'
    }, 500);
  }
});

export default app;
