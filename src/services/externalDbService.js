import { queryExternal } from '../db/externalConnection.js';
import { differenceInMonths, parseISO } from 'date-fns';

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
 * 開始月を1ヶ月目としてカウント（既存システムと同じロジック）
 * @param {string} startDate - レッスン開始日 (YYYY-MM-DD形式)
 * @returns {number} 継続月数
 */
export function calculateContinuedMonths(startDate) {
  if (!startDate) return 0;
  
  try {
    // "YYYY-MM-DD" または "YYYY/MM/DD" 形式を統一
    const formattedDate = startDate.replace(/\//g, '-');
    const start = parseISO(formattedDate);
    const now = new Date();
    
    // differenceInMonths は完全に経過した月数を返すため、+1 する
    // （開始月を1ヶ月目としてカウント）
    const months = differenceInMonths(now, start) + 1;
    
    return Math.max(0, months);
  } catch (error) {
    console.error('Error calculating continued months:', error);
    return 0;
  }
}
