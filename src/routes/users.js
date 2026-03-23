import { Hono } from 'hono';
import { query } from '../db/connection.js';
import bcrypt from 'bcryptjs';

const app = new Hono();

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
  
  const sessionResult = await query(
    'SELECT u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.expires_at > NOW()',
    [sessionToken]
  );
  
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
        u.discord_webhook_url,
        u.discord_user_id,
        t.tutor_name as tutor_name
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      ORDER BY u.created_at DESC
    `);
    
    return c.json({
      success: true,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    return c.json({
      success: false,
      error: 'ユーザー一覧取得に失敗しました'
    }, 500);
  }
});

/**
 * Create user (admin only)
 */
app.post('/', requireAdmin, async (c) => {
  try {
    const { email, role } = await c.req.json();
    
    if (!email || !role) {
      return c.json({
        success: false,
        error: 'メールアドレスと権限を入力してください'
      }, 400);
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
    
    // Create user with default password '1111'
    const defaultPassword = '1111';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    
    const result = await query(
      'INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, $3, TRUE) RETURNING id, email, role',
      [email.toLowerCase(), passwordHash, role]
    );
    
    return c.json({
      success: true,
      data: result.rows[0],
      message: 'ユーザーを作成しました（初期パスワード: 1111）'
    });
    
  } catch (error) {
    console.error('Create user error:', error);
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
  try {
    const userId = c.req.param('id');
    const { role } = await c.req.json();
    
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
    console.error('Update user error:', error);
    return c.json({
      success: false,
      error: 'ユーザー更新に失敗しました'
    }, 500);
  }
});

/**
 * Delete user (admin only)
 */
/**
 * Update user Discord settings (admin only)
 */
app.put('/:id/discord', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');
    const { discord_webhook_url, discord_user_id } = await c.req.json();
    
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
    console.error('Update Discord settings error:', error);
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
    console.error('Delete user error:', error);
    return c.json({
      success: false,
      error: 'ユーザー削除に失敗しました'
    }, 500);
  }
});

export default app;
