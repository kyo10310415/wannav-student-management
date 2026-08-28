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
import { buildMinutesResult } from '../services/minutesService.js';
import {
  getPreviousMinutesContext,
  resolveMinutesTutor
} from '../services/minutesContextService.js';
import {
  buildLessonContentIndex,
  getLessonContent,
  resolveLessonReference
} from '../services/lessonReferenceService.js';

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

    // 1. 通常・PRO共通のレッスン識別子を確定
    let lessonReference = lessonNumber != null
      ? resolveLessonReference({ lesson_number: lessonNumber })
      : null;
    if (!lessonReference) {
      try {
        const lrRes = await query(
          `SELECT lesson_number, pro_curriculum, pro_text_number
             FROM lesson_reports
            WHERE student_id = $1
              AND lesson_date::date = $2::date
            ORDER BY reported_at DESC
            LIMIT 1`,
          [studentId, lessonDate]
        );
        if (lrRes.rows.length > 0) {
          lessonReference = resolveLessonReference(lrRes.rows[0]);
        }
      } catch (err) {
        console.warn(`[Minutes] Could not fetch lesson_number from lesson_reports:`, err.message);
      }
    }

    if (!lessonReference) {
      return c.json({
        success: false,
        error: 'レッスン番号を解決できません。先にレッスン報告を登録するか、レッスン識別子を入力してください。'
      }, 409);
    }

    // 2. Drive から文字起こし取得
    console.log(`[Minutes] Fetching transcript for ${studentId} on ${lessonDate}...`);
    const driveResult = await fetchTranscript(studentId, lessonDate);
    if (!driveResult || !driveResult.transcript) {
      return c.json({
        success: false,
        error: `Google Drive に文字起こしファイルが見つかりませんでした（学籍番号: ${studentId}、日付: ${lessonDate}）`,
      }, 404);
    }

    // 3. 本文から正規化したキーで今回・次回のマスターを取得
    const lessonContentsResult = await query(
      'SELECT lesson_number, title, content FROM lesson_contents ORDER BY lesson_number ASC'
    );
    const lessonContentsIndex = buildLessonContentIndex(lessonContentsResult.rows);
    const todayRow = getLessonContent(lessonContentsIndex, lessonReference.lessonKey);
    const nextRow = getLessonContent(lessonContentsIndex, lessonReference.nextLessonKey);
    const todayContent = todayRow ? `${todayRow.title}\n${todayRow.content}`.trim() : '';
    const nextContent = nextRow ? `${nextRow.title}\n${nextRow.content}`.trim() : '';

    // 4. テンプレート取得
    const tmplId  = templateId || 1;
    const tmplRes = await query('SELECT * FROM minutes_templates WHERE id = $1', [tmplId]);
    const template = tmplRes.rows[0] || { template_text: '{{summary}}\n\n{{notes}}' };

    // 5. AI で議事録生成
    console.log(`[Minutes] Generating minutes with AI... (lessonKey=${lessonReference.lessonKey})`);
    const [previousMinutesContext, resolvedTutor] = await Promise.all([
      getPreviousMinutesContext(studentId, lessonDate),
      resolveMinutesTutor(studentId, lessonDate)
    ]);
    const { generatedText, qualityEvaluation } = await buildMinutesResult({
      templateText: template.template_text,
      studentName:  studentName || studentId,
      studentId,
      lessonDate,
      lessonNumber: lessonReference.lessonKey,
      lessonLabel:  lessonReference.lessonLabel,
      todayContent,
      nextContent,
      transcript:   driveResult.transcript,
      previousMinutesContext,
    });

    // 6. UPSERT
    const upsertResult = await query(
      `INSERT INTO minutes
          (student_id, student_name, lesson_date, lesson_number,
           drive_file_id, drive_file_name, transcript, generated_text,
           template_id, tutor_name, tutor_employee_id, quality_evaluation, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       ON CONFLICT (student_id, lesson_date)
       DO UPDATE SET
           student_name   = EXCLUDED.student_name,
           lesson_number  = EXCLUDED.lesson_number,
           drive_file_id  = EXCLUDED.drive_file_id,
           drive_file_name= EXCLUDED.drive_file_name,
           transcript     = EXCLUDED.transcript,
           generated_text = EXCLUDED.generated_text,
           template_id    = EXCLUDED.template_id,
           tutor_name     = EXCLUDED.tutor_name,
           tutor_employee_id = EXCLUDED.tutor_employee_id,
           quality_evaluation = EXCLUDED.quality_evaluation,
           updated_at     = NOW()
       RETURNING *`,
      [
        studentId,
        studentName || studentId,
        lessonDate,
        lessonReference.lessonKey,
        driveResult.fileId,
        driveResult.fileName,
        driveResult.transcript,
        generatedText,
        tmplId,
        resolvedTutor.tutorName,
        resolvedTutor.tutorEmployeeId,
        JSON.stringify(qualityEvaluation),
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
