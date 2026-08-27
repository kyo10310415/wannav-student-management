import { query } from '../db/connection.js';

/**
 * 同一生徒の直前議事録を、前回不安・前回小目標の評価コンテキストとして取得する。
 */
export async function getPreviousMinutesContext(studentId, lessonDate) {
  const result = await query(
    `SELECT lesson_date::text AS lesson_date, generated_text, quality_evaluation
       FROM minutes
      WHERE student_id = $1
        AND lesson_date < $2::date
      ORDER BY lesson_date DESC, created_at DESC
      LIMIT 1`,
    [studentId, lessonDate]
  );

  return result.rows[0] || null;
}

/**
 * 実施Tutor名を、レッスン報告 → 予約 → 現在の担任の順で解決する。
 */
export async function resolveMinutesTutor(studentId, lessonDate) {
  const result = await query(
    `WITH resolved_name AS (
       SELECT COALESCE(
       (
         SELECT NULLIF(TRIM(lr.tutor_name), '')
           FROM lesson_reports lr
          WHERE lr.student_id = $1
            AND lr.lesson_date::date = $2::date
          ORDER BY lr.reported_at DESC
          LIMIT 1
       ),
       (
         SELECT NULLIF(TRIM(l.tutor_name), '')
           FROM lessons l
          WHERE l.student_id = $1
            AND l.lesson_date::date = $2::date
          ORDER BY l.updated_at DESC
          LIMIT 1
       ),
       (
         SELECT NULLIF(TRIM(t.tutor_name), '')
           FROM students s
           LEFT JOIN tutors t ON t.notion_name = s.homeroom_tutor
          WHERE s.student_id = $1
          LIMIT 1
       ),
       (
         SELECT NULLIF(TRIM(s.homeroom_tutor), '')
           FROM students s
          WHERE s.student_id = $1
         LIMIT 1
       )
       ) AS raw_tutor_name
     )
     SELECT
       COALESCE(t.tutor_name, resolved_name.raw_tutor_name) AS tutor_name,
       t.employee_id AS tutor_employee_id
     FROM resolved_name
     LEFT JOIN LATERAL (
       SELECT candidate.employee_id, candidate.tutor_name
         FROM tutors candidate
        WHERE resolved_name.raw_tutor_name IS NOT NULL
          AND resolved_name.raw_tutor_name = ANY(
            ARRAY[candidate.tutor_name, candidate.notion_name, candidate.name, candidate.email]
          )
        ORDER BY CASE WHEN candidate.tutor_name = resolved_name.raw_tutor_name THEN 0 ELSE 1 END
        LIMIT 1
     ) t ON TRUE`,
    [studentId, lessonDate]
  );

  return {
    tutorName: result.rows[0]?.tutor_name || null,
    tutorEmployeeId: result.rows[0]?.tutor_employee_id || null
  };
}

export async function resolveMinutesTutorName(studentId, lessonDate) {
  const tutor = await resolveMinutesTutor(studentId, lessonDate);
  return tutor.tutorName;
}
