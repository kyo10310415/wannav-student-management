import { query } from '../db/connection.js';

// Normal Render startup does not run db:migrate. Initialize only this feature's
// additive tables, without applying unrelated pending migrations or changing data.
export const ACTION_POINT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS action_point_results (
    student_id TEXT NOT NULL, year_month VARCHAR(7) NOT NULL,
    payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(student_id, year_month));
  CREATE TABLE IF NOT EXISTS action_point_tutor_snapshots (
    student_id TEXT NOT NULL, year_month VARCHAR(7) NOT NULL,
    tutor_name TEXT, captured_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(student_id, year_month));
  CREATE TABLE IF NOT EXISTS action_point_x_cache (
    username VARCHAR(15) PRIMARY KEY, x_user_id TEXT,
    last_attempt_at TIMESTAMPTZ, last_checked_at TIMESTAMPTZ,
    last_post_at TIMESTAMPTZ, last_inactive BOOLEAN);`;

export function createActionPointSchemaInitializer(db = query) {
  let pending;
  return function ensureSchema() {
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const result = await db(`SELECT to_regclass('public.action_point_results') IS NOT NULL
          AND to_regclass('public.action_point_tutor_snapshots') IS NOT NULL
          AND to_regclass('public.action_point_x_cache') IS NOT NULL AS ready`);
        if (!result.rows[0]?.ready) await db(ACTION_POINT_SCHEMA_SQL);
      }).catch(() => {
        pending = undefined;
        console.error('[Action Points] Schema initialization failed');
        throw new Error('Action point schema initialization failed');
      });
    }
    return pending;
  };
}

export const ensureActionPointSchema = createActionPointSchemaInitializer();
