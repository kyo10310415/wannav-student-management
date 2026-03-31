import { query } from '../db/connection.js';

/**
 * Monthly red list reset job
 * Runs on the 1st of each month at 0:00 JST to archive previous month and reset current month
 */
export async function monthlyRedListReset() {
  try {
    console.log('[Red List Monthly] Starting monthly red list reset...');
    
    const now = new Date();
    const jstOffset = 9 * 60; // JST is UTC+9
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    
    // Calculate previous month
    const prevDate = new Date(jstTime.getFullYear(), jstTime.getMonth() - 1, 1);
    const prevYearMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    
    console.log(`[Red List Monthly] Archiving data for ${prevYearMonth}`);
    
    // 1. Archive previous month's final scores to history
    const archiveResult = await query(`
      INSERT INTO red_list_history 
        (student_id, year_month, final_score, final_rank, 
         satisfaction_score, absence_score, survey_score, reschedule_score, reservation_score)
      SELECT 
        student_id, year_month, total_score, rank,
        satisfaction_score, absence_score, survey_score, reschedule_score, reservation_score
      FROM red_list
      WHERE year_month = $1
      ON CONFLICT DO NOTHING
    `, [prevYearMonth]);
    
    console.log(`[Red List Monthly] Archived ${archiveResult.rowCount} records for ${prevYearMonth}`);
    
    // 2. Delete old red_list records (keep only current and previous month)
    const deleteResult = await query(`
      DELETE FROM red_list
      WHERE year_month < $1
    `, [prevYearMonth]);
    
    console.log(`[Red List Monthly] Deleted ${deleteResult.rowCount} old records`);
    
    // 3. Current month will be created automatically by daily job
    
    console.log('[Red List Monthly] Monthly reset complete');
    
    return {
      archived: archiveResult.rowCount,
      deleted: deleteResult.rowCount
    };
  } catch (error) {
    console.error('[Red List Monthly] Error during monthly reset:', error);
    throw error;
  }
}
