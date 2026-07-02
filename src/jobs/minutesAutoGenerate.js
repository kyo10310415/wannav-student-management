/**
 * 議事録 自動生成ジョブ
 *
 * 1時間に1回実行。
 * 処理対象: 今日のレッスン（JST）に該当し、まだ議事録が存在しない生徒
 *
 * フロー:
 * 1. lessons テーブルから「今日・前日」のレッスンを持つ student_id 一覧を取得
 * 2. minutes テーブルで同日の議事録が既に存在する student_id を除外（スキップ）
 * 3. 残った生徒について fetchTranscript → buildMinutesText → DB UPSERT
 */

import { query } from '../db/connection.js';
import { fetchTranscript } from '../services/driveService.js';
import { buildMinutesText } from '../services/minutesService.js';

// JST の今日の日付を YYYY-MM-DD で返す
function getTodayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// JST の前日の日付を YYYY-MM-DD で返す
function getYesterdayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setDate(jst.getDate() - 1);
  return jst.toISOString().slice(0, 10);
}

export async function minutesAutoGenerate() {
  const today     = getTodayJST();
  const yesterday = getYesterdayJST();

  console.log(`[MinutesAutoGen] Start — today=${today}, yesterday=${yesterday}`);

  // ── 1. 今日・前日のレッスンがある生徒を取得 ──────────────────────────
  // lessons テーブルの date カラムで絞り込む
  let lessonsResult;
  try {
    lessonsResult = await query(
      `SELECT DISTINCT
              s.student_id,
              s.name        AS student_name,
              l.date        AS lesson_date
         FROM lessons l
         JOIN students s ON s.id = l.student_id
        WHERE l.date IN ($1, $2)
          AND s.student_id IS NOT NULL
          AND s.student_id <> ''
        ORDER BY l.date DESC, s.student_id`,
      [today, yesterday]
    );
  } catch (err) {
    console.error('[MinutesAutoGen] Failed to query lessons:', err.message);
    return;
  }

  const candidates = lessonsResult.rows;
  if (candidates.length === 0) {
    console.log('[MinutesAutoGen] No lessons found for today/yesterday. Skipping.');
    return;
  }
  console.log(`[MinutesAutoGen] ${candidates.length} lesson(s) found.`);

  // ── 2. 既に議事録が存在するものをスキップ ───────────────────────────
  // (student_id, lesson_date) の組み合わせで既存チェック
  const pairs = candidates.map(c => `('${c.student_id}','${c.lesson_date}')`).join(',');
  let existingResult;
  try {
    existingResult = await query(
      `SELECT student_id, lesson_date::text
         FROM minutes
        WHERE (student_id, lesson_date::text) IN (${pairs})`
    );
  } catch (err) {
    console.error('[MinutesAutoGen] Failed to query existing minutes:', err.message);
    return;
  }

  const existingSet = new Set(
    existingResult.rows.map(r => `${r.student_id}__${r.lesson_date}`)
  );

  const targets = candidates.filter(
    c => !existingSet.has(`${c.student_id}__${c.lesson_date}`)
  );

  if (targets.length === 0) {
    console.log('[MinutesAutoGen] All minutes already generated. Nothing to do.');
    return;
  }
  console.log(`[MinutesAutoGen] ${targets.length} target(s) to generate (${existingSet.size} skipped).`);

  // ── 3. テンプレート取得（id=1 固定、なければデフォルト） ────────────
  let template = { id: 1, template_text: '{{summary}}\n\n{{notes}}' };
  try {
    const tmplRes = await query('SELECT * FROM minutes_templates WHERE id = 1');
    if (tmplRes.rows.length > 0) template = tmplRes.rows[0];
  } catch (err) {
    console.warn('[MinutesAutoGen] Could not fetch template, using default:', err.message);
  }

  // ── 4. 各生徒について生成 ────────────────────────────────────────────
  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const target of targets) {
    const { student_id, student_name, lesson_date } = target;
    const tag = `[MinutesAutoGen][${student_id}][${lesson_date}]`;

    try {
      // Drive から文字起こし取得
      const driveResult = await fetchTranscript(student_id, lesson_date);
      if (!driveResult || !driveResult.transcript) {
        console.log(`${tag} No transcript found — skip.`);
        skipCount++;
        continue;
      }

      // レッスン番号は自動生成時には不明なので null
      const generatedText = await buildMinutesText({
        templateText: template.template_text,
        studentName:  student_name || student_id,
        studentId:    student_id,
        lessonDate:   lesson_date,
        lessonNumber: null,
        todayContent: '',
        nextContent:  '',
        transcript:   driveResult.transcript,
      });

      // UPSERT（同一 student_id × lesson_date は上書き）
      await query(
        `INSERT INTO minutes
            (student_id, student_name, lesson_date, lesson_number,
             drive_file_id, drive_file_name, transcript, generated_text,
             template_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
         ON CONFLICT (student_id, lesson_date)
         DO UPDATE SET
             student_name    = EXCLUDED.student_name,
             drive_file_id   = EXCLUDED.drive_file_id,
             drive_file_name = EXCLUDED.drive_file_name,
             transcript      = EXCLUDED.transcript,
             generated_text  = EXCLUDED.generated_text,
             template_id     = EXCLUDED.template_id,
             updated_at      = NOW()`,
        [
          student_id,
          student_name || student_id,
          lesson_date,
          null,           // lesson_number
          driveResult.fileId,
          driveResult.fileName,
          driveResult.transcript,
          generatedText,
          template.id,
        ]
      );

      console.log(`${tag} ✅ Generated successfully.`);
      successCount++;
    } catch (err) {
      console.error(`${tag} ❌ Error:`, err.message);
      errorCount++;
    }
  }

  console.log(
    `[MinutesAutoGen] Done — success=${successCount}, skipped(no transcript)=${skipCount}, error=${errorCount}`
  );
}
