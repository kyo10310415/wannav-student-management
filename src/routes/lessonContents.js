/**
 * レッスン内容管理 API Routes
 *
 * GET    /api/lesson-contents          — 一覧（レッスン番号順）
 * POST   /api/lesson-contents          — 新規作成
 * PUT    /api/lesson-contents/:number  — 更新（レッスン番号で指定）
 * DELETE /api/lesson-contents/:number  — 削除
 * POST   /api/lesson-contents/bulk     — 一括登録（JSON配列）
 */

import { Hono } from 'hono';
import { query } from '../db/connection.js';
import {
  deriveLessonContentKey,
  resolveLessonReference
} from '../services/lessonReferenceService.js';

const app = new Hono();

async function readLessonContentBody(c) {
  try { const body = await c.req.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body : null; }
  catch { return null; }
}
function validLessonContentText(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    [body.title, body.content].every(value => value == null || (typeof value === 'string' && !value.includes('\u0000')));
}
function validLessonContentItem(item) {
  return validLessonContentText(item) && (item.lesson_number == null ||
    (typeof item.lesson_number === 'string' && !item.lesson_number.includes('\u0000')) ||
    (typeof item.lesson_number === 'number' && Number.isFinite(item.lesson_number)));
}

/** 一覧取得 */
app.get('/', async (c) => {
  try {
    const result = await query(
      'SELECT * FROM lesson_contents ORDER BY lesson_number ASC'
    );
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[LessonContents] GET / error:');
    return c.json({ success: false, error: 'Lesson content operation failed' }, 500);
  }
});

/** 新規作成 */
app.post('/', async (c) => {
  try {
    const body = await readLessonContentBody(c);
    if (!validLessonContentItem(body)) return c.json({ success: false, error: 'Invalid lesson content fields' }, 400);
    const { lesson_number, title, content } = body;
    if (lesson_number == null) {
      return c.json({ success: false, error: 'lesson_number は必須です' }, 400);
    }
    const lessonKey = String(lesson_number).includes(',')
      ? deriveLessonContentKey({ lesson_number, title, content })
      : resolveLessonReference({ lesson_number })?.lessonKey;
    if (!lessonKey) {
      return c.json({
        success: false,
        error: 'lesson_number は数値または Pro_コース_番号 の形式で入力してください'
      }, 400);
    }
    const result = await query(
      `INSERT INTO lesson_contents (lesson_number, title, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (lesson_number)
       DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = NOW()
       RETURNING *`,
      [lessonKey, title || '', content || '']
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[LessonContents] POST / error:');
    return c.json({ success: false, error: 'Lesson content operation failed' }, 500);
  }
});

/** 更新（レッスン番号で指定） */
app.put('/:number', async (c) => {
  try {
    const num  = c.req.param('number');  // TEXT型なのでparseInt不要
    if (num.includes('\u0000')) return c.json({ success: false, error: 'Invalid lesson content key' }, 400);
    const body = await readLessonContentBody(c);
    if (!validLessonContentText(body)) return c.json({ success: false, error: 'Invalid lesson content fields' }, 400);
    const { title, content } = body;
    const result = await query(
      `UPDATE lesson_contents
          SET title   = COALESCE($1, title),
              content = COALESCE($2, content),
              updated_at = NOW()
        WHERE lesson_number = $3 RETURNING *`,
      [title ?? null, content ?? null, num]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'レッスン内容が見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[LessonContents] PUT /:number error:');
    return c.json({ success: false, error: 'Lesson content operation failed' }, 500);
  }
});

/** 削除 */
app.delete('/:number', async (c) => {
  try {
    const num = c.req.param('number');  // TEXT型なのでparseInt不要
    if (num.includes('\u0000')) return c.json({ success: false, error: 'Invalid lesson content key' }, 400);
    await query('DELETE FROM lesson_contents WHERE lesson_number = $1', [num]);
    return c.json({ success: true, message: '削除しました' });
  } catch (err) {
    console.error('[LessonContents] DELETE /:number error:');
    return c.json({ success: false, error: 'Lesson content operation failed' }, 500);
  }
});

/** 一括登録 */
app.post('/bulk', async (c) => {
  try {
    const body = await readLessonContentBody(c);
    if (!body) return c.json({ success: false, error: 'Invalid lesson content fields' }, 400);
    const { items } = body;
    if (!Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 配列が空です' }, 400);
    }
    // Check the entire shape before the first write; invalid lesson keys still skip as before.
    if (!items.every(validLessonContentItem)) return c.json({ success: false, error: 'Invalid lesson content fields' }, 400);
    let count = 0;
    for (const item of items) {
      if (item.lesson_number == null) continue;
      const lessonKey = String(item.lesson_number).includes(',')
        ? deriveLessonContentKey(item)
        : resolveLessonReference({ lesson_number: item.lesson_number })?.lessonKey;
      if (!lessonKey) continue;
      await query(
        `INSERT INTO lesson_contents (lesson_number, title, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (lesson_number)
         DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = NOW()`,
        [lessonKey, item.title || '', item.content || '']
      );
      count++;
    }
    return c.json({ success: true, message: `${count}件を登録しました` });
  } catch (err) {
    console.error('[LessonContents] POST /bulk error:');
    return c.json({ success: false, error: 'Lesson content operation failed' }, 500);
  }
});

export default app;
