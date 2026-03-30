import { Hono } from 'hono';
import { getPool } from '../db/connection.js';
import crypto from 'crypto';
import axios from 'axios';

const app = new Hono();

// Discord Webhook URL for roulette win notifications
const ROULETTE_WIN_WEBHOOK = 'https://discord.com/api/webhooks/1454123104698761260/V4dCIKzhu3OCc5FWLro0ttzj3dCsin5B4-kuWu1yxLUn_cIN68fiV4Iqjqmiox6jPR1d';
const ROLE_MENTION_ID = '1294923221107478571';

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
        s.discord_url,
        s.notion_url,
        s.notion_page_id
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

    // 当たりの場合、Discord通知を送信
    if (result === '当たり') {
      try {
        // Generate Notion URL
        let notionUrl = achievement.notion_url;
        if (!notionUrl && achievement.notion_page_id) {
          notionUrl = `https://www.notion.so/${achievement.notion_page_id.replace(/-/g, '')}`;
        }

        // Send Discord notification with role mention
        const embed = {
          title: '🎊 ルーレット当選通知 🎊',
          description: `<@&${ROLE_MENTION_ID}>\n\n**アンケートスタンプラリーのルーレットで当たりが出ました！**`,
          color: 0xFF0000, // 赤色
          fields: [
            {
              name: '🎓 生徒情報',
              value: `**生徒名**: ${achievement.student_name}\n**学籍番号**: ${achievement.student_id}`,
              inline: false
            },
            {
              name: '📝 Notionリンク',
              value: notionUrl ? `[Notionページを開く](${notionUrl})` : 'Notionリンクなし',
              inline: false
            },
            {
              name: '🎁 特典内容',
              value: '**弊社事務所マネージャーによる**1時間コンサル権',
              inline: false
            },
            {
              name: '📅 抽選日時',
              value: new Date(rouletteResult.created_at).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }),
              inline: true
            }
          ],
          footer: {
            text: 'ご対応をよろしくお願いいたします'
          },
          timestamp: new Date().toISOString()
        };

        await axios.post(ROULETTE_WIN_WEBHOOK, {
          content: `<@&${ROLE_MENTION_ID}>`,
          username: 'WannaV Roulette',
          avatar_url: 'https://cdn-icons-png.flaticon.com/512/3588/3588592.png',
          embeds: [embed]
        });

        console.log(`[Roulette] Win notification sent to Discord for ${achievement.student_id}`);
      } catch (notificationError) {
        console.error(`[Roulette] Failed to send Discord notification:`, notificationError.message);
        // Continue even if notification fails
      }
    }

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

    let result;
    try {
      result = await pool.query(`
        SELECT 
          id,
          student_id,
          result,
          probability,
          roulette_url,
          created_at
        FROM roulette_results
        WHERE student_id = $1 AND (is_test = FALSE OR is_test IS NULL)
        ORDER BY created_at DESC
        LIMIT 1
      `, [studentId]);
    } catch (error) {
      console.error('[Roulette] Error with is_test filter, using fallback query:', error.message);
      // Fallback to query without is_test column
      result = await pool.query(`
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
    }

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

    // 結果を保存（is_test=true を追加）
    let insertResult;
    try {
      insertResult = await pool.query(`
        INSERT INTO roulette_results 
          (student_id, result, probability, roulette_url, is_test)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, result, probability, created_at
      `, [studentId, result, probability, 'test-draw-' + Date.now(), true]);
    } catch (error) {
      console.error('[Roulette TEST] Error inserting with is_test column:', error.message);
      // Fallback to insert without is_test column
      insertResult = await pool.query(`
        INSERT INTO roulette_results 
          (student_id, result, probability, roulette_url)
        VALUES ($1, $2, $3, $4)
        RETURNING id, result, probability, created_at
      `, [studentId, result, probability, 'test-draw-' + Date.now()]);
    }

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

/**
 * POST /api/roulette/reset-test-results
 * テスト抽選結果を全て削除（UIを「抽選可能」に戻す）
 */
app.post('/reset-test-results', async (c) => {
  try {
    const pool = getPool();
    
    // is_test=true のレコードを削除
    let deleteResult;
    try {
      deleteResult = await pool.query(`
        DELETE FROM roulette_results
        WHERE is_test = true
        RETURNING student_id
      `);
    } catch (error) {
      console.error('[Roulette] Error deleting with is_test column:', error.message);
      // Fallback: roulette_url が 'test-draw-' で始まるものを削除
      deleteResult = await pool.query(`
        DELETE FROM roulette_results
        WHERE roulette_url LIKE 'test-draw-%'
        RETURNING student_id
      `);
    }
    
    const deletedCount = deleteResult.rows.length;
    const deletedStudents = [...new Set(deleteResult.rows.map(r => r.student_id))];
    
    console.log(`[Roulette] Deleted ${deletedCount} test results for ${deletedStudents.length} students`);
    
    return c.json({
      success: true,
      data: {
        deletedCount: deletedCount,
        studentCount: deletedStudents.length,
        message: `${deletedStudents.length}名の生徒のテスト抽選結果を削除しました`
      }
    });
  } catch (error) {
    console.error('[Roulette] Error resetting test results:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/roulette/winners
 * 当たりを引いた生徒の一覧を取得
 */
app.get('/winners', async (c) => {
  try {
    const pool = getPool();

    let result;
    try {
      result = await pool.query(`
        SELECT 
          r.id,
          r.student_id,
          r.result,
          r.probability,
          r.created_at,
          s.name as student_name,
          s.notion_url,
          s.notion_page_id,
          s.homeroom_tutor,
          sa.achievement_type,
          sa.achievement_date
        FROM roulette_results r
        JOIN students s ON r.student_id = s.student_id
        LEFT JOIN stamp_rally_achievements sa ON r.student_id = sa.student_id 
          AND r.roulette_url = sa.roulette_url
        WHERE r.result = '当たり' 
          AND (r.is_test = FALSE OR r.is_test IS NULL)
        ORDER BY r.created_at DESC
      `);
    } catch (error) {
      console.error('[Roulette] Error with is_test filter, using fallback query:', error.message);
      // Fallback without is_test column
      result = await pool.query(`
        SELECT 
          r.id,
          r.student_id,
          r.result,
          r.probability,
          r.created_at,
          s.name as student_name,
          s.notion_url,
          s.notion_page_id,
          s.homeroom_tutor,
          sa.achievement_type,
          sa.achievement_date
        FROM roulette_results r
        JOIN students s ON r.student_id = s.student_id
        LEFT JOIN stamp_rally_achievements sa ON r.student_id = sa.student_id 
          AND r.roulette_url = sa.roulette_url
        WHERE r.result = '当たり' 
          AND r.roulette_url NOT LIKE 'test-draw-%'
        ORDER BY r.created_at DESC
      `);
    }

    // Build Notion URLs
    const winners = result.rows.map(row => {
      let notionUrl = row.notion_url;
      if (!notionUrl && row.notion_page_id) {
        notionUrl = `https://www.notion.so/${row.notion_page_id.replace(/-/g, '')}`;
      }

      return {
        id: row.id,
        studentId: row.student_id,
        studentName: row.student_name,
        homeroom_tutor: row.homeroom_tutor,
        notionUrl,
        probability: row.probability,
        achievementType: row.achievement_type,
        achievementDate: row.achievement_date,
        drawnAt: row.created_at
      };
    });

    console.log(`[Roulette] Found ${winners.length} winners`);

    return c.json({
      success: true,
      data: winners,
      count: winners.length
    });
  } catch (error) {
    console.error('Error fetching winners:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
