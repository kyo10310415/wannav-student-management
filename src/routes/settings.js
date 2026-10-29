import { Hono } from 'hono';
import { getPool } from '../db/connection.js';

const app = new Hono();

/**
 * GET /api/settings/:key
 * システム設定を取得
 */
app.get('/:key', async (c) => {
  try {
    const { key } = c.req.param();
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        setting_key,
        setting_value,
        description,
        updated_by,
        updated_at
      FROM system_settings
      WHERE setting_key = $1
    `, [key]);

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Setting not found'
      }, 404);
    }

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching setting');
    return c.json({
      success: false,
      error: 'Settings operation failed'
    }, 500);
  }
});

/**
 * PUT /api/settings/:key
 * システム設定を更新（リーダー以上の権限が必要）
 * Body: { value }; updated_by comes from the authenticated session.
 */
app.put('/:key', async (c) => {
  try {
    const { key } = c.req.param();
    let body;
    try { body = await c.req.json(); }
    catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ success: false, error: 'JSON入力が不正です' }, 400);
    const { value } = body;

    if (value === undefined) {
      return c.json({
        success: false,
        error: 'value is required'
      }, 400);
    }

    const actor = c.get('authenticatedUser');
    if (typeof actor?.email !== 'string' || !actor.email) return c.json({ success: false, error: '更新者を確認できません' }, 503);

    const pool = getPool();

    // 設定を更新（存在しない場合はエラー）
    const result = await pool.query(`
      UPDATE system_settings
      SET 
        setting_value = $1,
        updated_by = $2,
        updated_at = NOW()
      WHERE setting_key = $3
      RETURNING *
    `, [value, actor.email, key]);

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Setting not found'
      }, 404);
    }

    console.log('[Settings] Updated');

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating setting');
    return c.json({
      success: false,
      error: 'Settings operation failed'
    }, 500);
  }
});

/**
 * GET /api/settings
 * 全てのシステム設定を取得
 */
app.get('/', async (c) => {
  try {
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        setting_key,
        setting_value,
        description,
        updated_by,
        updated_at
      FROM system_settings
      ORDER BY setting_key
    `);

    return c.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching settings');
    return c.json({
      success: false,
      error: 'Settings operation failed'
    }, 500);
  }
});

export default app;
