import { query } from '../db/connection.js';

export const AUTO_LESSON_REPORT_SCHEMA_SQL = `
  ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS report_origin TEXT NOT NULL DEFAULT 'manual';
  ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS auto_evidence_file_id TEXT;
  ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS auto_evidence JSONB;
  CREATE TABLE IF NOT EXISTS auto_lesson_report_state (
    id INTEGER PRIMARY KEY CHECK(id=1), start_date DATE NOT NULL);
  CREATE TABLE IF NOT EXISTS auto_lesson_report_checks (
    student_id TEXT NOT NULL, lesson_date DATE NOT NULL,
    status TEXT NOT NULL, source_hash TEXT, next_check_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(student_id,lesson_date));`;

export function createAutoLessonReportSchemaInitializer(db = query) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(async () => {
      const result = await db(`SELECT (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='lesson_reports'
        AND column_name IN ('report_origin','auto_evidence_file_id','auto_evidence'))=3
        AND to_regclass('public.auto_lesson_report_state') IS NOT NULL
        AND to_regclass('public.auto_lesson_report_checks') IS NOT NULL AS ready`);
      if (!result.rows[0]?.ready) await db(AUTO_LESSON_REPORT_SCHEMA_SQL);
    }).catch(() => {
      pending = null;
      console.error('[AutoLessonReport] Schema initialization failed');
      throw new Error('Automatic lesson report initialization failed');
    });
    return pending;
  };
}
export const ensureAutoLessonReportSchema = createAutoLessonReportSchemaInitializer();
