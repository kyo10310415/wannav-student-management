import { Hono } from 'hono';
import { getPool } from '../db/connection.js';
import crypto from 'crypto';

const app = new Hono();

/**
 * POST /api/roulette/generate
 * ルーレットURLを生成（特典達成時に自動実行）
 * Body: { studentId, achievementType }
 */
app.post('/generate', async (c) => {
  try {
    const { studentId, achievementType } = await c.req.json();

    if (!studentId || !achievementType) {
      return c.json({
        success: false,
        error: 'studentId and achievementType are required'
      }, 400);
    }

    const pool = getPool();

    // 生徒情報取得
    const studentResult = await pool.query(`
      SELECT student_id, name, result_score_prev_month as result_score
      FROM students
      WHERE student_id = $1
    `, [studentId]);

    if (studentResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Student not found'
      }, 404);
    }

    const student = studentResult.rows[0];

    // トークン生成（32バイト = 64文字の16進数）
    const token = crypto.randomBytes(32).toString('hex');
    
    // ルーレットURL生成
    const baseUrl = process.env.APP_BASE_URL || 'https://webapp.pages.dev';
    const rouletteUrl = `${baseUrl}/roulette?token=${token}`;

    // 有効期限（30日後）
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // トークン情報をDBに保存（roulette_tokensテーブル）
    // Note: このテーブルは後で追加する必要があります
    // 今回は stamp_rally_achievements に roulette_url を保存

    // スタンプラリー達成記録に保存
    const achievementResult = await pool.query(`
      INSERT INTO stamp_rally_achievements 
        (student_id, achievement_type, achievement_date, roulette_url)
      VALUES ($1, $2, CURRENT_DATE, $3)
      RETURNING id, achievement_date
    `, [studentId, achievementType, rouletteUrl]);

    const achievement = achievementResult.rows[0];

    console.log(`[Roulette] URL generated for ${studentId}: ${rouletteUrl}`);

    return c.json({
      success: true,
      data: {
        studentId,
        studentName: student.name,
        rouletteUrl,
        token,
        achievementId: achievement.id,
        achievementDate: achievement.achievement_date,
        expiresAt,
        probability: student.result_score === 'S' ? 100 : 50
      }
    });
  } catch (error) {
    console.error('Error generating roulette URL:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/roulette/verify/:token
 * ルーレットトークンを検証し、生徒情報を取得
 */
app.get('/verify/:token', async (c) => {
  try {
    const { token } = c.req.param();
    const pool = getPool();

    // トークンから達成記録を検索
    const baseUrl = process.env.APP_BASE_URL || 'https://webapp.pages.dev';
    const rouletteUrl = `${baseUrl}/roulette?token=${token}`;

    const achievementResult = await pool.query(`
      SELECT 
        sa.id as achievement_id,
        sa.student_id,
        sa.achievement_type,
        sa.achievement_date,
        sa.notified_at,
        sa.roulette_url,
        sa.created_at,
        s.name as student_name,
        s.result_score_prev_month as result_score
      FROM stamp_rally_achievements sa
      JOIN students s ON sa.student_id = s.student_id
      WHERE sa.roulette_url = $1
    `, [rouletteUrl]);

    if (achievementResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Invalid or expired token'
      }, 404);
    }

    const achievement = achievementResult.rows[0];

    // 有効期限チェック（30日）
    const createdAt = new Date(achievement.created_at);
    const expiresAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();

    if (now > expiresAt) {
      return c.json({
        success: false,
        error: 'Token expired'
      }, 410);
    }

    // 既に抽選済みかチェック
    const existingResult = await pool.query(`
      SELECT id, result, probability, created_at
      FROM roulette_results
      WHERE student_id = $1 AND roulette_url = $2
    `, [achievement.student_id, rouletteUrl]);

    if (existingResult.rows.length > 0) {
      return c.json({
        success: false,
        error: 'Token already used',
        result: existingResult.rows[0]
      }, 409);
    }

    // トークン有効
    const probability = achievement.result_score === 'S' ? 100 : 50;

    return c.json({
      success: true,
      data: {
        studentId: achievement.student_id,
        studentName: achievement.student_name,
        achievementType: achievement.achievement_type,
        achievementDate: achievement.achievement_date,
        probability,
        resultScore: achievement.result_score,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error verifying roulette token:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/roulette/spin
 * ルーレット抽選を実行
 * Body: { token }
 */
app.post('/spin', async (c) => {
  try {
    const { token } = await c.req.json();

    if (!token) {
      return c.json({
        success: false,
        error: 'token is required'
      }, 400);
    }

    const pool = getPool();

    // トークン検証
    const baseUrl = process.env.APP_BASE_URL || 'https://webapp.pages.dev';
    const rouletteUrl = `${baseUrl}/roulette?token=${token}`;

    const achievementResult = await pool.query(`
      SELECT 
        sa.id as achievement_id,
        sa.student_id,
        sa.achievement_type,
        sa.roulette_url,
        sa.created_at,
        s.name as student_name,
        s.result_score_prev_month as result_score,
        s.discord_url
      FROM stamp_rally_achievements sa
      JOIN students s ON sa.student_id = s.student_id
      WHERE sa.roulette_url = $1
    `, [rouletteUrl]);

    if (achievementResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Invalid token'
      }, 404);
    }

    const achievement = achievementResult.rows[0];

    // 有効期限チェック
    const createdAt = new Date(achievement.created_at);
    const expiresAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() > expiresAt) {
      return c.json({
        success: false,
        error: 'Token expired'
      }, 410);
    }

    // 既に抽選済みかチェック
    const existingResult = await pool.query(`
      SELECT id FROM roulette_results
      WHERE student_id = $1 AND roulette_url = $2
    `, [achievement.student_id, rouletteUrl]);

    if (existingResult.rows.length > 0) {
      return c.json({
        success: false,
        error: 'Already drawn'
      }, 409);
    }

    // 抽選実行
    const probability = achievement.result_score === 'S' ? 100 : 50;
    let result;

    if (probability === 100) {
      result = '当たり';
    } else {
      result = Math.random() < 0.5 ? '当たり' : 'はずれ';
    }

    // 結果を保存
    const insertResult = await pool.query(`
      INSERT INTO roulette_results 
        (student_id, result, probability, roulette_url)
      VALUES ($1, $2, $3, $4)
      RETURNING id, result, probability, created_at
    `, [achievement.student_id, result, probability, rouletteUrl]);

    const rouletteResult = insertResult.rows[0];

    // 通知日時を更新
    await pool.query(`
      UPDATE stamp_rally_achievements
      SET notified_at = NOW()
      WHERE id = $1
    `, [achievement.achievement_id]);

    console.log(`[Roulette] ${achievement.student_id} - ${result} (${probability}%)`);

    return c.json({
      success: true,
      data: {
        studentId: achievement.student_id,
        studentName: achievement.student_name,
        result: rouletteResult.result,
        probability: rouletteResult.probability,
        drawnAt: rouletteResult.created_at,
        resultScore: achievement.result_score
      }
    });
  } catch (error) {
    console.error('Error spinning roulette:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/roulette/result/:studentId
 * 生徒の最新ルーレット結果を取得
 */
app.get('/result/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param();
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        id,
        student_id,
        result,
        probability,
        roulette_url,
        created_at
      FROM roulette_results
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [studentId]);

    if (result.rows.length === 0) {
      return c.json({
        success: true,
        data: null
      });
    }

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching roulette result:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/roulette/test-draw
 * テスト用ルーレット抽選（Discord通知なし）
 * Body: { studentId }
 */
app.post('/test-draw', async (c) => {
  try {
    const { studentId } = await c.req.json();

    if (!studentId) {
      return c.json({
        success: false,
        error: 'studentId is required'
      }, 400);
    }

    const pool = getPool();

    // 生徒情報取得
    const studentResult = await pool.query(`
      SELECT student_id, name, result_overall as result_score
      FROM students
      WHERE student_id = $1
    `, [studentId]);

    if (studentResult.rows.length === 0) {
      return c.json({
        success: false,
        error: 'Student not found'
      }, 404);
    }

    const student = studentResult.rows[0];

    // 抽選実行
    const probability = student.result_score === 'S' ? 100 : 50;
    let result;

    if (probability === 100) {
      result = '当たり';
    } else {
      result = Math.random() < 0.5 ? '当たり' : 'はずれ';
    }

    // 結果を保存（test_drawフラグを追加）
    const insertResult = await pool.query(`
      INSERT INTO roulette_results 
        (student_id, result, probability, roulette_url)
      VALUES ($1, $2, $3, $4)
      RETURNING id, result, probability, created_at
    `, [studentId, result, probability, 'test-draw-' + Date.now()]);

    const rouletteResult = insertResult.rows[0];

    console.log(`[Roulette TEST] ${studentId} (${student.name}) - ${result} (${probability}%) - NO DISCORD NOTIFICATION`);

    return c.json({
      success: true,
      data: {
        studentId: studentId,
        studentName: student.name,
        result: rouletteResult.result,
        probability: rouletteResult.probability,
        drawnAt: rouletteResult.created_at,
        resultScore: student.result_score,
        isTest: true
      }
    });
  } catch (error) {
    console.error('Error in test draw:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
