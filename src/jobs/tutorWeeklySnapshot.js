import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';

/**
 * 毎週日曜日23:59 JSTにTutorの満足度スナップショットを保存するジョブ
 *
 * 保存するデータ:
 *   - アクティブ生徒数 (その時点の実値)
 *   - アンケート回答数
 *   - 満足度平均 (0-10スケール)
 *   - 満足度 (0-100スケール)
 *   - 回収率 (%)
 *   - 満足度スコア (満足度×回収率/100)
 *
 * ※ この値は「先週日曜日時点の数値」として前週比較に使用するため、
 *   後から生徒数が変わっても変化しない確定値として保存する。
 */
export async function weeklyTutorSnapshot() {
  try {
    console.log('[Tutor Weekly Snapshot] Starting weekly snapshot...');

    // --- JST現在時刻 ---
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);

    // スナップショット日付（今日の日付）
    const snapshotYear  = jstTime.getFullYear();
    const snapshotMonth = jstTime.getMonth() + 1;
    const snapshotDay   = jstTime.getDate();
    const snapshotDate  = `${snapshotYear}-${String(snapshotMonth).padStart(2, '0')}-${String(snapshotDay).padStart(2, '0')}`;

    // 対象年月 YYYY/M
    const yearMonth = `${snapshotYear}/${snapshotMonth}`;

    console.log(`[Tutor Weekly Snapshot] snapshot_date=${snapshotDate}, year_month=${yearMonth}`);

    // --- 満足度データ取得 ---
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    const satisfactionRaw = await fetchSatisfactionFromCache(cacheSpreadsheetId);

    // tutorName -> yearMonth -> { average, count }
    const satisfactionByTutor = {};
    satisfactionRaw.forEach(record => {
      const tName  = record.tutor_name;
      const ym     = record.year_month;
      const score  = parseFloat(record.satisfaction_score);
      if (!tName || !ym || isNaN(score)) return;
      if (!satisfactionByTutor[tName]) satisfactionByTutor[tName] = {};
      if (!satisfactionByTutor[tName][ym])
        satisfactionByTutor[tName][ym] = { scores: [] };
      satisfactionByTutor[tName][ym].scores.push(score);
    });

    // 平均を計算してキャッシュ
    for (const tName in satisfactionByTutor) {
      for (const ym in satisfactionByTutor[tName]) {
        const d = satisfactionByTutor[tName][ym];
        d.average = d.scores.reduce((a, b) => a + b, 0) / d.scores.length;
        d.count   = d.scores.length;
      }
    }

    // --- アクティブTutor取得 ---
    const tutorsResult = await query(`
      SELECT * FROM tutors
      WHERE status = 'アクティブ'
        AND LOWER(job_type) LIKE '%tutor%'
        AND tutor_name != 'きょうへい先生'
      ORDER BY tutor_name ASC
    `);
    const tutors = tutorsResult.rows;

    // --- アクティブ生徒数 ---
    const studentsResult = await query(
      `SELECT homeroom_tutor, status, contract_plan FROM students`
    );
    const students = studentsResult.rows;

    // --- 各Tutorのスナップショットを保存 ---
    let savedCount = 0;
    let skippedCount = 0;

    for (const tutor of tutors) {
      const activeStudentCount = students.filter(s =>
        s.homeroom_tutor === tutor.notion_name &&
        s.status === 'アクティブ' &&
        s.contract_plan !== '永久会員' &&
        s.contract_plan !== '在籍プラン'
      ).length;

      const tutorSatData = satisfactionByTutor[tutor.tutor_name] || {};
      const monthData    = tutorSatData[yearMonth];

      const satisfactionCount = monthData ? monthData.count : 0;
      const satisfactionAvg   = monthData ? monthData.average : null;

      // 満足度 (0-100スケール)
      const satisfactionValue = satisfactionAvg !== null
        ? satisfactionAvg * 10
        : null;

      // 回収率 (%)
      let collectionRate = null;
      if (activeStudentCount > 0) {
        collectionRate = (satisfactionCount / activeStudentCount) * 100;
      }

      // 満足度スコア
      let satisfactionScore = null;
      if (satisfactionValue !== null && collectionRate !== null) {
        satisfactionScore = satisfactionValue * collectionRate / 100;
      }

      try {
        await query(`
          INSERT INTO tutor_weekly_snapshots
            (snapshot_date, tutor_notion_name, year_month,
             active_student_count, satisfaction_count, satisfaction_avg,
             satisfaction_value, collection_rate, satisfaction_score)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (snapshot_date, tutor_notion_name)
          DO UPDATE SET
            year_month           = EXCLUDED.year_month,
            active_student_count = EXCLUDED.active_student_count,
            satisfaction_count   = EXCLUDED.satisfaction_count,
            satisfaction_avg     = EXCLUDED.satisfaction_avg,
            satisfaction_value   = EXCLUDED.satisfaction_value,
            collection_rate      = EXCLUDED.collection_rate,
            satisfaction_score   = EXCLUDED.satisfaction_score,
            created_at           = EXCLUDED.created_at
        `, [
          snapshotDate,
          tutor.notion_name,
          yearMonth,
          activeStudentCount,
          satisfactionCount,
          satisfactionAvg,
          satisfactionValue,
          collectionRate,
          satisfactionScore
        ]);
        savedCount++;
      } catch (err) {
        console.error(`[Tutor Weekly Snapshot] Error saving ${tutor.notion_name}:`, err.message);
        skippedCount++;
      }
    }

    console.log(`[Tutor Weekly Snapshot] Done. saved=${savedCount}, skipped=${skippedCount}`);
    return { success: true, savedCount, skippedCount, snapshotDate };

  } catch (error) {
    console.error('[Tutor Weekly Snapshot] Fatal error:', error);
    return { success: false, error: error.message };
  }
}
