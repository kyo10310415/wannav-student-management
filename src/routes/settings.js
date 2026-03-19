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
    console.error('Error fetching setting:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * PUT /api/settings/:key
 * システム設定を更新（リーダー以上の権限が必要）
 * Body: { value, updatedBy }
 */
app.put('/:key', async (c) => {
  try {
    const { key } = c.req.param();
    const { value, updatedBy } = await c.req.json();

    if (value === undefined) {
      return c.json({
        success: false,
        error: 'value is required'
      }, 400);
    }

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
    `, [value, updatedBy || 'unknown', key]);

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Setting not found'
      }, 404);
    }

    console.log(`[Settings] Updated ${key} = ${value} by ${updatedBy}`);

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    return c.json({
      success: false,
      error: error.message
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
    console.error('Error fetching settings:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
