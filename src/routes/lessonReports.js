import { Hono } from 'hono';
import { query } from '../db/connection.js';
import {
  formatLessonLabel,
  resolveLessonReference
} from '../services/lessonReferenceService.js';

const app = new Hono();

function validReportDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validReportStudentId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * POST /api/lesson-reports
 * レッスン報告を作成または更新
 */
app.post('/', async (c) => {
  try {
    let body;
    try { body = await c.req.json(); }
    catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ success: false, error: 'JSON入力が不正です' }, 400);
    }
    const {
      student_id,
      lesson_date,
      lesson_result,
      lesson_number,
      pro_curriculum,
      pro_text_number,
      tutor_name: suppliedTutorName
    } = body;
    const reporter = c.get('authenticatedUser');
    const reported_by = reporter.email;
    const tutor_name = reporter.role === 'crew' ? reporter.tutor_name : suppliedTutorName;

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

    // 議事録が報告より先に生成されていた場合も、番号を即時に補完する。
    const lessonReference = resolveLessonReference(result.rows[0]);
    if (lesson_result === '実施済み' && lessonReference) {
      const lessonLabel = formatLessonLabel(lessonReference.lessonKey);
      await query(
        `UPDATE minutes
            SET lesson_number = $1,
                generated_text = CASE
                  WHEN generated_text LIKE '%- レッスン番号: （未確認）回目%'
                    THEN REPLACE(
                      generated_text,
                      '- レッスン番号: （未確認）回目',
                      '- レッスン番号: ' || $2
                    )
                  ELSE generated_text
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE student_id = $3
            AND lesson_date = $4::date`,
        [lessonReference.lessonKey, lessonLabel, student_id, lesson_date]
      );
    }

    console.log('[Lesson reports] Report saved');

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ レッスン報告保存エラー:');
    return c.json({
      success: false,
      error: 'Lesson report operation failed'
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
    if (!validReportDate(date)) return c.json({ success: false, error: 'Invalid report date' }, 400);

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
    console.error('❌ レッスン報告取得エラー:');
    return c.json({
      success: false,
      error: 'Lesson report operation failed'
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
    if (!validReportStudentId(studentId) || !validReportDate(date)) {
      return c.json({ success: false, error: 'Invalid report reference' }, 400);
    }

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
    console.error('❌ レッスン報告取得エラー:');
    return c.json({
      success: false,
      error: 'Lesson report operation failed'
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
    if (!/^[1-9][0-9]*$/.test(String(limit)) || !Number.isSafeInteger(Number(limit)) || Number(limit) > 1000 ||
        !/^(0|[1-9][0-9]*)$/.test(String(offset)) || !Number.isSafeInteger(Number(offset)) ||
        (start_date && !validReportDate(start_date)) || (end_date && !validReportDate(end_date)) ||
        (start_date && end_date && start_date > end_date) ||
        [student_id, tutor_name, lesson_result].some(value => value !== undefined && (value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)))) {
      return c.json({ success: false, error: 'Invalid report search' }, 400);
    }

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
    console.error('❌ レッスン報告検索エラー:');
    return c.json({
      success: false,
      error: 'Lesson report operation failed'
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

    console.log('[Lesson reports] Report deleted');

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ レッスン報告削除エラー:');
    return c.json({
      success: false,
      error: 'Lesson report operation failed'
    }, 500);
  }
});

export default app;
