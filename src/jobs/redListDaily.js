import { updateAllRedLists } from '../services/redListService.js';

/**
 * Daily red list update job
 * Runs every day at 0:00 JST to recalculate all students' red list scores
 */
export async function dailyRedListUpdate() {
  try {
    console.log('[Red List Daily] Starting daily red list update...');
    
    const now = new Date();
    const jstOffset = 9 * 60; // JST is UTC+9
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    const yearMonth = `${jstTime.getFullYear()}-${String(jstTime.getMonth() + 1).padStart(2, '0')}`;
    
    console.log(`[Red List Daily] Updating red list for ${yearMonth}`);
    
    const result = await updateAllRedLists(yearMonth);
    
    console.log(`[Red List Daily] Update complete: ${result.updated} updated, ${result.errors} errors`);
    
    return result;
  } catch (error) {
    console.error('[Red List Daily] Error during daily update:', error);
    throw error;
  }
}
