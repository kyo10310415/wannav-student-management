import { createHash } from 'node:crypto';
import { query } from '../db/connection.js';
import { ensureAutoLessonReportSchema } from '../services/autoLessonReportSchema.js';
import { fetchAutoReportTranscript } from '../services/driveService.js';
import { assessAutomaticLesson } from '../services/autoLessonReportAI.js';

const jstDate = date => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export function createAutoLessonReportJob({ db = query, ensure = ensureAutoLessonReportSchema, fetch = fetchAutoReportTranscript,
  assess = assessAutomaticLesson, enabled = () => process.env.LESSON_AUTO_REPORT_ENABLED !== 'false' } = {}) {
  let running = false;
  return async function run(now = new Date()) {
    if (!enabled()) return { disabled: true };
    if (running) return { busy: true };
    running = true;
    try {
      await ensure();
      const today = jstDate(now);
      // Initial deployment starts today. Do not silently rewrite older history.
      await db('INSERT INTO auto_lesson_report_state (id,start_date) VALUES (1,$1) ON CONFLICT (id) DO NOTHING', [today]);
      const candidates = (await db(`WITH single_days AS (
        SELECT l.student_id,l.lesson_date::date AS lesson_date FROM lessons l
        WHERE l.lesson_date::date BETWEEN GREATEST((SELECT start_date FROM auto_lesson_report_state WHERE id=1),$1::date-7) AND $1::date
        GROUP BY l.student_id,l.lesson_date::date HAVING COUNT(*)=1)
        SELECT l.student_id,l.lesson_date::date::text AS lesson_date,l.calendar_event_id,l.tutor_name,s.name AS student_name
        FROM single_days d JOIN lessons l ON l.student_id=d.student_id AND l.lesson_date::date=d.lesson_date
        JOIN students s ON s.student_id=l.student_id
        LEFT JOIN lesson_reports r ON r.student_id=d.student_id AND r.lesson_date=d.lesson_date
        LEFT JOIN auto_lesson_report_checks c ON c.student_id=d.student_id AND c.lesson_date=d.lesson_date
        WHERE r.id IS NULL AND COALESCE(c.status,'') <> 'suppressed'
          AND (c.next_check_at IS NULL OR c.next_check_at <= $2)
          AND (TRIM(l.lesson_time::text) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' OR l.lesson_date::time <> TIME '00:00')
          AND ((l.lesson_date::date + CASE WHEN TRIM(l.lesson_time::text) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN l.lesson_time::time ELSE l.lesson_date::time END) AT TIME ZONE 'Asia/Tokyo') <= $2::timestamptz - INTERVAL '2 hours'
        ORDER BY d.lesson_date,l.student_id LIMIT 50`, [today, now])).rows;
      let keys = [];
      try { keys = (await db('SELECT lesson_number FROM lesson_contents ORDER BY lesson_number')).rows.map(row => String(row.lesson_number)); }
      catch { console.warn('[AutoLessonReport] Lesson reference master unavailable; numbers remain unconfirmed'); }
      const summary = { checked: 0, reported: 0, pending: 0, errors: 0 };
      for (const lesson of candidates) {
        try {
          // Atomic cross-instance claim. A failed/missing source is retried after six hours.
          const claim = await db(`INSERT INTO auto_lesson_report_checks (student_id,lesson_date,status,next_check_at)
            VALUES ($1,$2,'checking',$3::timestamptz + INTERVAL '6 hours')
            ON CONFLICT (student_id,lesson_date) DO UPDATE SET next_check_at=EXCLUDED.next_check_at,updated_at=NOW()
            WHERE auto_lesson_report_checks.status <> 'suppressed' AND auto_lesson_report_checks.next_check_at <= $3::timestamptz RETURNING source_hash`,
          [lesson.student_id, lesson.lesson_date, now]);
          if (!claim.rows.length) continue;
          summary.checked++;
          const source = await fetch(lesson.student_id, lesson.lesson_date);
          if (!source || source.fileDate !== lesson.lesson_date || source.transcript.length < 200 || source.transcript.length > 100000 || !lesson.tutor_name || !lesson.student_name) {
            await db("UPDATE auto_lesson_report_checks SET status='needs_review',updated_at=NOW() WHERE student_id=$1 AND lesson_date=$2 AND status <> 'suppressed'", [lesson.student_id, lesson.lesson_date]);
            summary.pending++; continue;
          }
          const hash = createHash('sha256').update(JSON.stringify([1,source.fileId,source.transcript,lesson.student_name,lesson.tutor_name,keys])).digest('hex');
          if (hash === claim.rows[0].source_hash) { summary.pending++; continue; }
          const assessment = await assess({ transcript: source.transcript, studentName: lesson.student_name, tutorName: lesson.tutor_name, allowedKeys: keys });
          if (!assessment) {
            await db("UPDATE auto_lesson_report_checks SET status='needs_review',source_hash=$3,updated_at=NOW() WHERE student_id=$1 AND lesson_date=$2 AND status <> 'suppressed'", [lesson.student_id, lesson.lesson_date, hash]);
            summary.pending++; continue;
          }
          // Auto never updates a report: manual-before-auto and auto-before-manual
          // both converge to the one manual record under the existing unique key.
          const inserted = await db(`INSERT INTO lesson_reports
            (student_id,lesson_date,lesson_result,lesson_number,tutor_name,reported_by,report_origin,auto_evidence_file_id,auto_evidence)
            SELECT $1,$2,'実施済み',$3,$4,'自動報告（AI確認）','auto',$5,$6::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM auto_lesson_report_checks WHERE student_id=$1 AND lesson_date=$2 AND status='suppressed')
            ON CONFLICT (student_id,lesson_date) DO NOTHING RETURNING id`,
          [lesson.student_id, lesson.lesson_date, assessment.lessonKey || '未確認', lesson.tutor_name, source.fileId, assessment.evidence]);
          summary.reported += inserted.rowCount || 0;
          await db("UPDATE auto_lesson_report_checks SET status='reported',source_hash=$3,updated_at=NOW() WHERE student_id=$1 AND lesson_date=$2 AND status <> 'suppressed'", [lesson.student_id, lesson.lesson_date, hash]);
        } catch { summary.errors++; console.error('[AutoLessonReport] Lesson check failed'); }
      }
      console.log('[AutoLessonReport] Completed', summary);
      return summary;
    } finally { running = false; }
  };
}
export const autoLessonReport = createAutoLessonReportJob();
