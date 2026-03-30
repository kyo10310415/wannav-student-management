import { Hono } from 'hono';
import { query } from '../db/connection.js';

const app = new Hono();

/**
 * POST /api/lesson-reports
 * レッスン報告を作成または更新
 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const {
      student_id,
      lesson_date,
      lesson_result,
      lesson_number,
      pro_curriculum,
      pro_text_number,
      reported_by,
      tutor_name
    } = body;

    // バリデーション
    if (!student_id || !lesson_date || !lesson_result || !lesson_number) {
      return c.json({
        success: false,
        error: '必須項目が不足しています'
      }, 400);
    }

    // レッスン結果の値チェック
    const validResults = ['実施済み', '生徒様都合でリスケ', 'Tutor都合でリスケ', '無断キャンセル'];
    if (!validResults.includes(lesson_result)) {
      return c.json({
        success: false,
        error: '無効なレッスン結果です'
      }, 400);
    }

    // PROプランの場合、カリキュラムとテキスト番号が必要
    if (lesson_number === 'PROプラン') {
      if (!pro_curriculum || !pro_text_number) {
        return c.json({
          success: false,
          error: 'PROプランの場合、カリキュラムとテキスト番号が必要です'
        }, 400);
      }
    }

    // UPSERT（存在すれば更新、なければ挿入）
    const result = await query(
      `INSERT INTO lesson_reports 
        (student_id, lesson_date, lesson_result, lesson_number, pro_curriculum, pro_text_number, reported_by, tutor_name, reported_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (student_id, lesson_date) 
      DO UPDATE SET
        lesson_result = EXCLUDED.lesson_result,
        lesson_number = EXCLUDED.lesson_number,
        pro_curriculum = EXCLUDED.pro_curriculum,
        pro_text_number = EXCLUDED.pro_text_number,
        reported_by = EXCLUDED.reported_by,
        tutor_name = EXCLUDED.tutor_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        student_id,
        lesson_date,
        lesson_result,
        lesson_number,
        pro_curriculum || null,
        pro_text_number || null,
        reported_by || 'unknown',
        tutor_name || null
      ]
    );

    console.log(`✅ レッスン報告保存: ${student_id} - ${lesson_date} - ${lesson_result}`);

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ レッスン報告保存エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-reports/by-date/:date
 * 特定の日付のすべてのレッスン報告を取得
 * ⚠️ このルートは /:studentId/:date よりも前に定義する必要があります
 */
app.get('/by-date/:date', async (c) => {
  try {
    const date = c.req.param('date');

    const result = await query(
      'SELECT * FROM lesson_reports WHERE lesson_date = $1 ORDER BY student_id ASC',
      [date]
    );

    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ レッスン報告取得エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-reports/:studentId/:date
 * 特定の学籍番号・日付のレッスン報告を取得
 */
app.get('/:studentId/:date', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const date = c.req.param('date');

    const result = await query(
      'SELECT * FROM lesson_reports WHERE student_id = $1 AND lesson_date = $2',
      [studentId, date]
    );

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'レッスン報告が見つかりません'
      }, 404);
    }

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ レッスン報告取得エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-reports
 * レッスン報告を検索・一覧取得
 * クエリパラメータ:
 *   - start_date: 開始日 (YYYY-MM-DD)
 *   - end_date: 終了日 (YYYY-MM-DD)
 *   - student_id: 学籍番号（部分一致）
 *   - tutor_name: Tutor名（部分一致）
 *   - lesson_result: レッスン結果（完全一致）
 *   - limit: 取得件数（デフォルト100）
 *   - offset: オフセット（デフォルト0）
 */
app.get('/', async (c) => {
  try {
    const { start_date, end_date, student_id, tutor_name, lesson_result, limit = 100, offset = 0 } = c.req.query();

    let sql = `
      SELECT 
        lr.*,
        s.name as student_name,
        s.homeroom_tutor
      FROM lesson_reports lr
      LEFT JOIN students s ON lr.student_id = s.student_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // 日付範囲フィルター
    if (start_date) {
      sql += ` AND lr.lesson_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      sql += ` AND lr.lesson_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    // 学籍番号フィルター（部分一致）
    if (student_id) {
      sql += ` AND lr.student_id ILIKE $${paramIndex}`;
      params.push(`%${student_id}%`);
      paramIndex++;
    }

    // Tutor名フィルター（部分一致）
    if (tutor_name) {
      sql += ` AND lr.tutor_name ILIKE $${paramIndex}`;
      params.push(`%${tutor_name}%`);
      paramIndex++;
    }

    // レッスン結果フィルター（完全一致）
    if (lesson_result) {
      sql += ` AND lr.lesson_result = $${paramIndex}`;
      params.push(lesson_result);
      paramIndex++;
    }

    sql += ` ORDER BY lr.lesson_date DESC, lr.student_id ASC`;
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    // 総件数を取得
    let countSql = `
      SELECT COUNT(*) as total
      FROM lesson_reports lr
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;

    if (start_date) {
      countSql += ` AND lr.lesson_date >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }
    if (end_date) {
      countSql += ` AND lr.lesson_date <= $${countParamIndex}`;
      countParams.push(end_date);
      countParamIndex++;
    }
    if (student_id) {
      countSql += ` AND lr.student_id ILIKE $${countParamIndex}`;
      countParams.push(`%${student_id}%`);
      countParamIndex++;
    }
    if (tutor_name) {
      countSql += ` AND lr.tutor_name ILIKE $${countParamIndex}`;
      countParams.push(`%${tutor_name}%`);
      countParamIndex++;
    }
    if (lesson_result) {
      countSql += ` AND lr.lesson_result = $${countParamIndex}`;
      countParams.push(lesson_result);
      countParamIndex++;
    }

    const countResult = await query(countSql, countParams);
    const total = parseInt(countResult.rows[0].total);

    console.log(`📋 レッスン報告検索: ${result.rows.length}件 / 合計${total}件`);

    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('❌ レッスン報告検索エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * DELETE /api/lesson-reports/:id
 * レッスン報告を削除
 */
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const result = await query(
      'DELETE FROM lesson_reports WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: 'レッスン報告が見つかりません'
      }, 404);
    }

    console.log(`✅ レッスン報告削除: ID ${id}`);

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ レッスン報告削除エラー:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
