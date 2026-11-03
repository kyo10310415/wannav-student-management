import { Hono } from 'hono';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';
import { getPool } from '../db/connection.js';
import { aggregateExtensionStats, EXTENSION_ROUNDS } from '../services/extensionStatsService.js';

const app = new Hono();

// Only fixed, code-defined column names are interpolated; no request input is used.
const extensionColumns = EXTENSION_ROUNDS.flatMap(({ round }) => [
  `extension_certainty_${round}`, `hearing_status_${round}`, `examination_result_${round}`
]).join(', ');

async function loadExtensionStats() {
  const extensionResult = await queryExtension(`
    SELECT student_id, ${extensionColumns} FROM student_extensions
  `);
  const studentsResult = await getPool().query(`
    SELECT s.student_id, s.continued_months, s.pro_plan_start_date,
           s.homeroom_tutor, s.status, s.contract_plan, t.team
    FROM students s
    LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
    WHERE s.status = 'アクティブ'
      AND s.contract_plan NOT IN ('永久会員', '在籍プラン')
  `);
  return aggregateExtensionStats(studentsResult.rows, extensionResult.rows);
}

for (const [path, key, errorMessage] of [
  ['/stats', 'stats', 'Extension statistics could not be loaded'],
  ['/by-tutor', 'tutors', 'Extension tutor statistics could not be loaded'],
  ['/by-team', 'teams', 'Extension team statistics could not be loaded']
]) {
  app.get(path, async c => {
    try {
      if (!getExtensionPool()) return c.json({
        success: false,
        error: 'Extension database not configured. Please set EXTENSION_DATABASE_URL environment variable.'
      }, 503);
      const result = await loadExtensionStats();
      return c.json({ success: true, data: result[key] });
    } catch {
      console.error(errorMessage);
      return c.json({ success: false, error: errorMessage }, 500);
    }
  });
}

export default app;
