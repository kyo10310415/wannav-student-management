/**
 * 議事録 自動生成ジョブ
 *
 * 1時間に1回実行。
 * 処理対象: 直近7日間（JST）に実施済み報告があり、品質評価済み議事録が存在しない生徒
 *
 * フロー:
 * 1. lessons・lesson_reports から直近7日間の実施済みレッスンを取得
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
import {
  buildLessonContentIndex,
  getLessonContent,
  resolveLessonReference
} from '../services/lessonReferenceService.js';

// JST の今日の日付を YYYY-MM-DD で返す
function getTodayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// JST の指定日数前の日付を YYYY-MM-DD で返す
function getDateDaysAgoJST(daysAgo) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() - daysAgo);
  return jst.toISOString().slice(0, 10);
}

export async function minutesAutoGenerate() {
  const today     = getTodayJST();
  const recentStart = getDateDaysAgoJST(7);

  console.log(`[MinutesAutoGen] Start — range=${recentStart}..${today}`);

  // ── 1. 直近7日間に実施済み報告がある生徒を取得 ──────────────────────
  // lessons.lesson_date は TIMESTAMP 型。DATE にキャストして比較する
  // lessons.student_id は学籍番号文字列（students.student_id と同じ型）
  let lessonsResult;
  try {
    lessonsResult = await query(
      `SELECT DISTINCT
              l.student_id,
              s.name                              AS student_name,
              l.lesson_date::date::text           AS lesson_date,
              lr.lesson_number,
              lr.pro_curriculum,
              lr.pro_text_number
         FROM lessons l
         LEFT JOIN students s ON s.student_id = l.student_id
         JOIN lesson_reports lr
           ON lr.student_id = l.student_id
          AND lr.lesson_date = l.lesson_date::date
          AND lr.lesson_result = '実施済み'
        WHERE l.lesson_date::date BETWEEN $1::date AND $2::date
          AND l.student_id IS NOT NULL
          AND l.student_id <> ''
        ORDER BY lesson_date DESC, l.student_id`,
      [recentStart, today]
    );
  } catch (err) {
    console.error('[MinutesAutoGen] Failed to query lessons:', err.message);
    return;
  }

  const candidates = lessonsResult.rows;
  if (candidates.length === 0) {
    console.log('[MinutesAutoGen] No completed lessons found in the recent range. Skipping.');
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
  let lessonContentsIndex = new Map();
  try {
    const lcRes = await query('SELECT lesson_number, title, content FROM lesson_contents ORDER BY lesson_number ASC');
    lessonContentsIndex = buildLessonContentIndex(lcRes.rows);
  } catch (err) {
    console.warn('[MinutesAutoGen] Could not fetch lesson_contents:', err.message);
  }

  // ── 5. 各生徒について生成 ────────────────────────────────────────────
  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const target of targets) {
    const {
      student_id,
      student_name,
      lesson_date,
      lesson_number,
      pro_curriculum,
      pro_text_number
    } = target;
    const tag = `[MinutesAutoGen][${student_id}][${lesson_date}]`;

    try {
      const lessonReference = resolveLessonReference({
        lesson_number,
        pro_curriculum,
        pro_text_number
      });
      if (!lessonReference) {
        console.warn(`${tag} Could not resolve lesson reference — skip.`);
        skipCount++;
        continue;
      }

      // Drive から文字起こし取得
      const driveResult = await fetchTranscript(student_id, lesson_date);
      if (!driveResult || !driveResult.transcript) {
        console.log(`${tag} No transcript found — skip.`);
        skipCount++;
        continue;
      }

      const todayRow = getLessonContent(lessonContentsIndex, lessonReference.lessonKey);
      const nextRow = getLessonContent(lessonContentsIndex, lessonReference.nextLessonKey);
      const todayContent = todayRow ? `${todayRow.title}\n${todayRow.content}`.trim() : '';
      const nextContent = nextRow ? `${nextRow.title}\n${nextRow.content}`.trim() : '';

      console.log(`${tag} lessonKey=${lessonReference.lessonKey}, todayContent=${todayContent ? '有り' : '無し'}, nextContent=${nextContent ? '有り' : '無し'}`);

      const [previousMinutesContext, resolvedTutor] = await Promise.all([
        getPreviousMinutesContext(student_id, lesson_date),
        resolveMinutesTutor(student_id, lesson_date)
      ]);
      const { generatedText, qualityEvaluation } = await buildMinutesResult({
        templateText: template.template_text,
        studentName:  student_name || student_id,
        studentId:    student_id,
        lessonDate:   lesson_date,
        lessonNumber: lessonReference.lessonKey,
        lessonLabel:  lessonReference.lessonLabel,
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
             lesson_number   = EXCLUDED.lesson_number,
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
          lessonReference.lessonKey,
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
