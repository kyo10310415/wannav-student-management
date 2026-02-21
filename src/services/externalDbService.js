import { queryExternal } from '../db/externalConnection.js';

/**
 * 外部DBからレッスン開始日を取得
 * @returns {Promise<Object>} 学籍番号をキー、レッスン開始日を値とするオブジェクト
 */
export async function fetchLessonStartDates() {
  try {
    console.log('[External DB] Fetching lesson start dates...');
    
    const result = await queryExternal(
      `SELECT student_id, lesson_start_date 
       FROM notion_students_cache 
       WHERE lesson_start_date IS NOT NULL 
       ORDER BY student_id`
    );

    const lessonStartDates = {};
    
    result.rows.forEach(row => {
      if (row.student_id && row.lesson_start_date) {
        lessonStartDates[row.student_id] = row.lesson_start_date;
      }
    });

    console.log(`[External DB] Retrieved ${Object.keys(lessonStartDates).length} lesson start dates`);
    
    return lessonStartDates;
  } catch (error) {
    console.error('[External DB] Error fetching lesson start dates:', error);
    throw error;
  }
}

/**
 * レッスン開始日から継続月数を計算
 * @param {string} startDate - レッスン開始日 (YYYY-MM-DD形式)
 * @returns {number} 継続月数
 */
export function calculateContinuedMonths(startDate) {
  if (!startDate) return 0;
  
  try {
    const start = new Date(startDate);
    const now = new Date();
    
    const yearsDiff = now.getFullYear() - start.getFullYear();
    const monthsDiff = now.getMonth() - start.getMonth();
    
    const totalMonths = yearsDiff * 12 + monthsDiff;
    
    // 開始日が今月の日付より後の場合は1ヶ月引く
    if (now.getDate() < start.getDate()) {
      return Math.max(0, totalMonths - 1);
    }
    
    return Math.max(0, totalMonths);
  } catch (error) {
    console.error('Error calculating continued months:', error);
    return 0;
  }
}
