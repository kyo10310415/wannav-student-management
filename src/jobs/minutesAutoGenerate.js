/**
 * 議事録 自動生成ジョブ
 *
 * 1時間に1回実行。
 * 処理対象: 今日・前日のレッスン（JST）に該当し、品質評価済み議事録が存在しない生徒
 *
 * フロー:
 * 1. lessons テーブルから「今日・前日」のレッスンを持つ student_id 一覧を取得
 * 2. minutes テーブルで同日の品質評価済み議事録が存在する student_id を除外
 * 3. 残った生徒について fetchTranscript → buildMinutesResult → DB UPSERT
 */

import { query } from '../db/connection.js';
import { fetchTranscript } from '../services/driveService.js';
import { buildMinutesResult } from '../services/minutesService.js';
import {
  getPreviousMinutesContext,
  resolveMinutesTutor
} from '../services/minutesContextService.js';

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
  // lessons.lesson_date は TIMESTAMP 型。DATE にキャストして比較する
  // lessons.student_id は学籍番号文字列（students.student_id と同じ型）
  let lessonsResult;
  try {
    lessonsResult = await query(
      `SELECT DISTINCT
              l.student_id,
              s.name                              AS student_name,
              l.lesson_date::date::text           AS lesson_date
         FROM lessons l
         LEFT JOIN students s ON s.student_id = l.student_id
        WHERE l.lesson_date::date IN ($1::date, $2::date)
          AND l.student_id IS NOT NULL
          AND l.student_id <> ''
        ORDER BY lesson_date DESC, l.student_id`,
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

  // ── 2. 既に品質評価済みの議事録が存在するものをスキップ ────────────
  let existingResult;
  try {
    // 対象の student_id 一覧と日付一覧で絞り込み、後でSetで照合
    const studentIds = [...new Set(candidates.map(c => c.student_id))];
    const dates      = [...new Set(candidates.map(c => c.lesson_date))];
    const sidPlaceholders  = studentIds.map((_, i) => `$${i + 1}`).join(',');
    const datePlaceholders = dates.map((_, i) => `$${studentIds.length + i + 1}`).join(',');
    existingResult = await query(
      `SELECT student_id, lesson_date::text
         FROM minutes
        WHERE student_id IN (${sidPlaceholders})
          AND lesson_date::text IN (${datePlaceholders})
          AND quality_evaluation IS NOT NULL`,
      [...studentIds, ...dates]
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

  // ── 4. lesson_contents を全件取得しておく（番号→内容のMap） ─────────
  const lessonContentsMap = new Map(); // key: lesson_number(int), value: content(string)
  try {
    const lcRes = await query('SELECT lesson_number, title, content FROM lesson_contents ORDER BY lesson_number ASC');
    for (const row of lcRes.rows) {
      lessonContentsMap.set(row.lesson_number, { title: row.title, content: row.content });
    }
  } catch (err) {
    console.warn('[MinutesAutoGen] Could not fetch lesson_contents:', err.message);
  }

  // ── 5. 各生徒について生成 ────────────────────────────────────────────
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

      // lesson_reports から当日のレッスン番号を取得
      let lessonNumber  = null;
      let todayContent  = '';
      let nextContent   = '';
      try {
        const lrRes = await query(
          `SELECT lesson_number FROM lesson_reports
            WHERE student_id = $1
              AND lesson_date::date = $2::date
            ORDER BY reported_at DESC
            LIMIT 1`,
          [student_id, lesson_date]
        );
        if (lrRes.rows.length > 0) {
          const rawNum = lrRes.rows[0].lesson_number;
          // "1"〜"28" など数値文字列。PROプランは null 扱い
          const parsed = parseInt(rawNum, 10);
          if (!isNaN(parsed)) {
            lessonNumber = parsed;
            // lesson_contents から今回・次回の内容を取得
            const todayRow = lessonContentsMap.get(lessonNumber);
            const nextRow  = lessonContentsMap.get(lessonNumber + 1);
            todayContent = todayRow ? `${todayRow.title}\n${todayRow.content}`.trim() : '';
            nextContent  = nextRow  ? `${nextRow.title}\n${nextRow.content}`.trim() : '';
          }
        }
      } catch (err) {
        console.warn(`${tag} Could not fetch lesson_number from lesson_reports:`, err.message);
      }

      console.log(`${tag} lessonNumber=${lessonNumber}, todayContent=${todayContent ? '有り' : '無し'}, nextContent=${nextContent ? '有り' : '無し'}`);

      const [previousMinutesContext, resolvedTutor] = await Promise.all([
        getPreviousMinutesContext(student_id, lesson_date),
        resolveMinutesTutor(student_id, lesson_date)
      ]);
      const { generatedText, qualityEvaluation } = await buildMinutesResult({
        templateText: template.template_text,
        studentName:  student_name || student_id,
        studentId:    student_id,
        lessonDate:   lesson_date,
        lessonNumber,
        todayContent,
        nextContent,
        transcript:   driveResult.transcript,
        previousMinutesContext,
      });

      // UPSERT（同一 student_id × lesson_date は上書き）
      await query(
        `INSERT INTO minutes
            (student_id, student_name, lesson_date, lesson_number,
             drive_file_id, drive_file_name, transcript, generated_text,
             template_id, tutor_name, tutor_employee_id, quality_evaluation, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
         ON CONFLICT (student_id, lesson_date)
         DO UPDATE SET
             student_name    = EXCLUDED.student_name,
             drive_file_id   = EXCLUDED.drive_file_id,
             drive_file_name = EXCLUDED.drive_file_name,
             transcript      = EXCLUDED.transcript,
             generated_text  = EXCLUDED.generated_text,
             template_id     = EXCLUDED.template_id,
             tutor_name      = EXCLUDED.tutor_name,
             tutor_employee_id = EXCLUDED.tutor_employee_id,
             quality_evaluation = EXCLUDED.quality_evaluation,
             updated_at      = NOW()`,
        [
          student_id,
          student_name || student_id,
          lesson_date,
          lessonNumber,   // lesson_reports から取得した値（null の場合もある）
          driveResult.fileId,
          driveResult.fileName,
          driveResult.transcript,
          generatedText,
          template.id,
          resolvedTutor.tutorName,
          resolvedTutor.tutorEmployeeId,
          JSON.stringify(qualityEvaluation),
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
