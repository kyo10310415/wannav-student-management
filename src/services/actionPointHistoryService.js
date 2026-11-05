import { query } from '../db/connection.js';
import { ensureActionPointSchema } from './actionPointSchema.js';
import { actionMonth, ACTION_RULES, summarizeActionPoints } from './actionPointRules.js';

export function createActionPointHistoryService({ db = query, ensure = ensureActionPointSchema } = {}) {
  async function snapshot(now = new Date()) {
    const month = actionMonth(now);
    if (actionMonth(new Date(now.getTime() + 86400000)) === month) return { saved: 0 };
    await ensure();
    const missing = summarizeActionPoints(ACTION_RULES.map(rule => ({ ...rule, status: 'unknown', point: null, reason: '月末時点で未評価', evidence: [] })));
    const result = await db(`INSERT INTO action_point_monthly_snapshots
      (student_id,year_month,student_name,status,contract_plan,homeroom_tutor,payload,evaluated_at,saved_at)
      SELECT s.student_id,$1,s.name,s.status,s.contract_plan,s.homeroom_tutor,COALESCE(a.payload,$3::jsonb),a.updated_at,$2
      FROM students s LEFT JOIN action_point_results a ON a.student_id=s.student_id AND a.year_month=$1
      WHERE s.status='アクティブ' OR a.student_id IS NOT NULL
      ON CONFLICT (student_id,year_month) DO NOTHING`, [month, now, missing]);
    return { saved: result.rowCount };
  }
  async function studentHistory(studentId) {
    await ensure();
    const result = await db(`SELECT year_month,payload AS action_points,evaluated_at,saved_at,'snapshot' AS source
      FROM action_point_monthly_snapshots WHERE student_id=$1
      UNION ALL
      SELECT a.year_month,a.payload,a.updated_at,NULL::timestamptz,'latest_saved'
      FROM action_point_results a WHERE a.student_id=$1 AND NOT EXISTS (
        SELECT 1 FROM action_point_monthly_snapshots m WHERE m.year_month=a.year_month)
      ORDER BY year_month DESC`, [studentId]);
    return result.rows;
  }
  return { snapshot, studentHistory };
}
const history = createActionPointHistoryService();
export const snapshotMonthlyActionPoints = history.snapshot;
export const getStudentActionPointHistory = history.studentHistory;
