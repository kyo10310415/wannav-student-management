/**
 * 議事録 API Routes
 *
 * GET  /api/minutes/:studentId          — 生徒の議事録一覧（日付降順）
 * GET  /api/minutes/:studentId/:id      — 議事録1件取得
 * POST /api/minutes/generate            — 議事録を生成してDBに保存
 * PUT  /api/minutes/:id                 — 議事録テキストを手動編集
 * DELETE /api/minutes/:id              — 議事録削除
 *
 * GET  /api/minutes/templates           — テンプレート一覧
 * PUT  /api/minutes/templates/:id       — テンプレート更新
 */

import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchTranscript } from '../services/driveService.js';
import { buildMinutesText } from '../services/minutesService.js';

const app = new Hono();

// ─── テンプレート ───────────────────────────────────────────────

/** テンプレート一覧 */
app.get('/templates', async (c) => {
  try {
    const result = await query('SELECT * FROM minutes_templates ORDER BY id ASC');
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Minutes] GET /templates error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** テンプレート更新 */
app.put('/templates/:id', async (c) => {
  try {
    const id   = c.req.param('id');
    const body = await c.req.json();
    const { name, template_text } = body;

    const result = await query(
      `UPDATE minutes_templates
          SET name = COALESCE($1, name),
              template_text = COALESCE($2, template_text),
              updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [name || null, template_text || null, id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Minutes] PUT /templates/:id error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── 議事録一覧 ────────────────────────────────────────────────

/** 全生徒の議事録一覧（生徒名・日付降順） */
app.get('/all', async (c) => {
  try {
    const limit  = parseInt(c.req.query('limit')  || '100', 10);
    const offset = parseInt(c.req.query('offset') || '0',   10);
    const result = await query(
      `SELECT id, student_id, student_name, lesson_date, lesson_number,
              drive_file_name, created_at, updated_at,
              LEFT(generated_text, 200) AS preview
         FROM minutes
        ORDER BY lesson_date DESC, student_id ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countRes = await query('SELECT COUNT(*) AS total FROM minutes');
    return c.json({
      success: true,
      data:    result.rows,
      total:   parseInt(countRes.rows[0].total, 10),
    });
  } catch (err) {
    console.error('[Minutes] GET /all error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** 生徒の議事録一覧（日付降順） */
app.get('/list/:studentId', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const result = await query(
      `SELECT id, student_id, student_name, lesson_date, lesson_number,
              drive_file_name, created_at, updated_at,
              LEFT(generated_text, 300) AS preview
         FROM minutes
        WHERE student_id = $1
        ORDER BY lesson_date DESC, created_at DESC`,
      [studentId]
    );
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Minutes] GET /list/:studentId error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** 議事録1件（全文） */
app.get('/detail/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await query('SELECT * FROM minutes WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '議事録が見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Minutes] GET /detail/:id error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── 議事録生成 ────────────────────────────────────────────────

/**
 * POST /api/minutes/generate
 * Body: { studentId, studentName, lessonDate, lessonNumber?, templateId? }
 *
 * 処理フロー:
 * 1. Drive から文字起こしを取得
 * 2. lesson_contents から今回・次回のレッスン内容を取得
 * 3. minutes_templates からテンプレートを取得
 * 4. OpenAI で議事録本文を生成
 * 5. minutes テーブルに UPSERT（同じ studentId × lessonDate は上書き）
 */
app.post('/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { studentId, studentName, lessonDate, lessonNumber, templateId } = body;

    if (!studentId || !lessonDate) {
      return c.json({ success: false, error: 'studentId と lessonDate は必須です' }, 400);
    }

    // 1. Drive から文字起こし取得
    console.log(`[Minutes] Fetching transcript for ${studentId} on ${lessonDate}...`);
    const driveResult = await fetchTranscript(studentId, lessonDate);
    if (!driveResult || !driveResult.transcript) {
      return c.json({
        success: false,
        error: `Google Drive に文字起こしファイルが見つかりませんでした（学籍番号: ${studentId}、日付: ${lessonDate}）`,
      }, 404);
    }

    // 2. レッスン番号を確定（未指定の場合は lesson_reports から自動取得）
    let resolvedLessonNumber = lessonNumber ?? null;
    if (resolvedLessonNumber == null) {
      try {
        const lrRes = await query(
          `SELECT lesson_number FROM lesson_reports
            WHERE student_id = $1
              AND lesson_date::date = $2::date
            ORDER BY reported_at DESC
            LIMIT 1`,
          [studentId, lessonDate]
        );
        if (lrRes.rows.length > 0) {
          const parsed = parseInt(lrRes.rows[0].lesson_number, 10);
          if (!isNaN(parsed)) resolvedLessonNumber = parsed;
        }
      } catch (err) {
        console.warn(`[Minutes] Could not fetch lesson_number from lesson_reports:`, err.message);
      }
    }

    // 3. レッスン内容取得（今回・次回）— lesson_contents から title + content を結合
    let todayContent = '';
    let nextContent  = '';
    if (resolvedLessonNumber != null) {
      const todayRow = await query(
        'SELECT title, content FROM lesson_contents WHERE lesson_number = $1',
        [resolvedLessonNumber]
      );
      const nextRow = await query(
        'SELECT title, content FROM lesson_contents WHERE lesson_number = $1',
        [resolvedLessonNumber + 1]
      );
      const tr = todayRow.rows[0];
      const nr = nextRow.rows[0];
      todayContent = tr ? `${tr.title}\n${tr.content}`.trim() : '';
      nextContent  = nr ? `${nr.title}\n${nr.content}`.trim() : '';
    }

    // 4. テンプレート取得
    const tmplId  = templateId || 1;
    const tmplRes = await query('SELECT * FROM minutes_templates WHERE id = $1', [tmplId]);
    const template = tmplRes.rows[0] || { template_text: '{{summary}}\n\n{{notes}}' };

    // 5. AI で議事録生成
    console.log(`[Minutes] Generating minutes with AI... (lessonNumber=${resolvedLessonNumber})`);
    const generatedText = await buildMinutesText({
      templateText: template.template_text,
      studentName:  studentName || studentId,
      studentId,
      lessonDate,
      lessonNumber: resolvedLessonNumber,
      todayContent,
      nextContent,
      transcript:   driveResult.transcript,
    });

    // 6. UPSERT
    const upsertResult = await query(
      `INSERT INTO minutes
          (student_id, student_name, lesson_date, lesson_number,
           drive_file_id, drive_file_name, transcript, generated_text,
           template_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       ON CONFLICT (student_id, lesson_date)
       DO UPDATE SET
           student_name   = EXCLUDED.student_name,
           lesson_number  = EXCLUDED.lesson_number,
           drive_file_id  = EXCLUDED.drive_file_id,
           drive_file_name= EXCLUDED.drive_file_name,
           transcript     = EXCLUDED.transcript,
           generated_text = EXCLUDED.generated_text,
           template_id    = EXCLUDED.template_id,
           updated_at     = NOW()
       RETURNING *`,
      [
        studentId,
        studentName || studentId,
        lessonDate,
        resolvedLessonNumber,
        driveResult.fileId,
        driveResult.fileName,
        driveResult.transcript,
        generatedText,
        tmplId,
      ]
    );

    return c.json({ success: true, data: upsertResult.rows[0] });
  } catch (err) {
    console.error('[Minutes] POST /generate error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** 議事録テキストを手動編集 */
app.put('/:id', async (c) => {
  try {
    const id   = c.req.param('id');
    const { generated_text } = await c.req.json();
    const result = await query(
      'UPDATE minutes SET generated_text = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [generated_text, id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '議事録が見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Minutes] PUT /:id error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** 議事録削除 */
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await query('DELETE FROM minutes WHERE id = $1', [id]);
    return c.json({ success: true, message: '削除しました' });
  } catch (err) {
    console.error('[Minutes] DELETE /:id error:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default app;
