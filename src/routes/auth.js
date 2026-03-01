import { Hono } from 'hono';
import { query } from '../db/connection.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const app = new Hono();

/**
 * Generate session token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Login endpoint
 */
app.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    if (!email || !password) {
      return c.json({
        success: false,
        error: 'メールアドレスとパスワードを入力してください'
      }, 400);
    }
    
    // Find user by email
    const userResult = await query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'メールアドレスまたはパスワードが正しくありません'
      }, 401);
    }
    
    const user = userResult.rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return c.json({
        success: false,
        error: 'メールアドレスまたはパスワードが正しくありません'
      }, 401);
    }
    
    // Get tutor name from tutors table
    const tutorResult = await query(
      'SELECT name FROM tutors WHERE LOWER(email) = $1',
      [email.toLowerCase()]
    );
    
    const tutorName = tutorResult.rows.length > 0 ? tutorResult.rows[0].name : null;
    
    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    await query(
      'INSERT INTO sessions (session_token, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionToken, user.id, expiresAt]
    );
    
    // Update last login
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    return c.json({
      success: true,
      data: {
        sessionToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          tutorName,
          mustChangePassword: user.must_change_password
        }
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return c.json({
      success: false,
      error: 'ログインに失敗しました'
    }, 500);
  }
});

/**
 * Logout endpoint
 */
app.post('/logout', async (c) => {
  try {
    const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
    
    if (sessionToken) {
      await query('DELETE FROM sessions WHERE session_token = $1', [sessionToken]);
    }
    
    return c.json({ success: true });
    
  } catch (error) {
    console.error('Logout error:', error);
    return c.json({
      success: false,
      error: 'ログアウトに失敗しました'
    }, 500);
  }
});

/**
 * Verify session endpoint
 */
app.get('/verify', async (c) => {
  try {
    const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({
        success: false,
        error: 'セッショントークンがありません'
      }, 401);
    }
    
    // Find session
    const sessionResult = await query(
      'SELECT s.*, u.email, u.role, u.must_change_password FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.expires_at > NOW()',
      [sessionToken]
    );
    
    if (sessionResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'セッションが無効または期限切れです'
      }, 401);
    }
    
    const session = sessionResult.rows[0];
    
    // Get tutor name
    const tutorResult = await query(
      'SELECT name FROM tutors WHERE LOWER(email) = $1',
      [session.email.toLowerCase()]
    );
    
    const tutorName = tutorResult.rows.length > 0 ? tutorResult.rows[0].name : null;
    
    return c.json({
      success: true,
      data: {
        user: {
          id: session.user_id,
          email: session.email,
          role: session.role,
          tutorName,
          mustChangePassword: session.must_change_password
        }
      }
    });
    
  } catch (error) {
    console.error('Verify session error:', error);
    return c.json({
      success: false,
      error: 'セッション検証に失敗しました'
    }, 500);
  }
});

/**
 * Change password endpoint
 */
app.post('/change-password', async (c) => {
  try {
    const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
    const { currentPassword, newPassword } = await c.req.json();
    
    if (!sessionToken) {
      return c.json({
        success: false,
        error: '認証が必要です'
      }, 401);
    }
    
    if (!currentPassword || !newPassword) {
      return c.json({
        success: false,
        error: '現在のパスワードと新しいパスワードを入力してください'
      }, 400);
    }
    
    if (newPassword.length < 4) {
      return c.json({
        success: false,
        error: 'パスワードは4文字以上にしてください'
      }, 400);
    }
    
    // Verify session
    const sessionResult = await query(
      'SELECT s.user_id, u.password_hash FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.expires_at > NOW()',
      [sessionToken]
    );
    
    if (sessionResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'セッションが無効です'
      }, 401);
    }
    
    const { user_id, password_hash } = sessionResult.rows[0];
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, password_hash);
    
    if (!isValidPassword) {
      return c.json({
        success: false,
        error: '現在のパスワードが正しくありません'
      }, 401);
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, user_id]
    );
    
    return c.json({
      success: true,
      message: 'パスワードを変更しました'
    });
    
  } catch (error) {
    console.error('Change password error:', error);
    return c.json({
      success: false,
      error: 'パスワード変更に失敗しました'
    }, 500);
  }
});

/**
 * Reset password endpoint (admin only)
 */
app.post('/reset-password', async (c) => {
  try {
    const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
    const { userId } = await c.req.json();
    
    if (!sessionToken) {
      return c.json({
        success: false,
        error: '認証が必要です'
      }, 401);
    }
    
    // Verify admin session
    const sessionResult = await query(
      'SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = $1 AND s.expires_at > NOW()',
      [sessionToken]
    );
    
    if (sessionResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'セッションが無効です'
      }, 401);
    }
    
    const { role } = sessionResult.rows[0];
    
    if (role !== 'admin') {
      return c.json({
        success: false,
        error: '管理者権限が必要です'
      }, 403);
    }
    
    // Reset password to default
    const defaultPassword = '1111';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, userId]
    );
    
    return c.json({
      success: true,
      message: 'パスワードを初期値（1111）にリセットしました'
    });
    
  } catch (error) {
    console.error('Reset password error:', error);
    return c.json({
      success: false,
      error: 'パスワードリセットに失敗しました'
    }, 500);
  }
});

export default app;
