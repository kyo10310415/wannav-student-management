import { query } from '../db/connection.js';

/**
 * 生徒ごとのレッスン進捗と欠席回数を計算
 * @returns {Promise<Object>} student_idをキーとした統計情報
 */
export async function calculateStudentLessonStats() {
  try {
    const result = await query(`
      SELECT 
        student_id,
        -- 実施済みレッスンの最大番号（PROプラン除く）
        MAX(
          CASE 
            WHEN lesson_result = '実施済み' 
              AND lesson_number != 'PROプラン' 
            THEN CAST(lesson_number AS INTEGER)
            ELSE 0
          END
        ) as max_lesson_number,
        -- PROプランの有無チェック
        MAX(
          CASE 
            WHEN lesson_result = '実施済み' 
              AND lesson_number = 'PROプラン'
            THEN 1
            ELSE 0
          END
        ) as has_pro_plan,
        -- 欠席回数（無断キャンセルのみ）
        SUM(
          CASE 
            WHEN lesson_result = '無断キャンセル'
            THEN 1
            ELSE 0
          END
        ) as absence_count,
        -- 実施済みレッスン数
        SUM(
          CASE 
            WHEN lesson_result = '実施済み'
            THEN 1
            ELSE 0
          END
        ) as completed_count,
        -- 総レッスン報告数
        COUNT(*) as total_reports
      FROM lesson_reports
      GROUP BY student_id
    `);

    // student_idをキーとしたマップに変換
    const statsMap = {};
    result.rows.forEach(row => {
      const hasPro = parseInt(row.has_pro_plan) > 0;
      const maxLesson = parseInt(row.max_lesson_number) || 0;
      
      // Proプランの場合は「Proプラン」、それ以外は最大レッスン番号
      let lessonProgress = null;
      if (hasPro) {
        lessonProgress = 'Proプラン';
      } else if (maxLesson > 0) {
        lessonProgress = String(maxLesson);
      }
      
      statsMap[row.student_id] = {
        lesson_progress: lessonProgress,
        absence_count: parseInt(row.absence_count) || 0,
        completed_count: parseInt(row.completed_count) || 0,
        total_reports: parseInt(row.total_reports) || 0
      };
    });

    return statsMap;
  } catch (error) {
    console.error('❌ レッスン統計計算エラー:', error);
    throw error;
  }
}

/**
 * 特定の生徒のレッスン統計を取得
 * @param {string} studentId - 学籍番号
 * @returns {Promise<Object>} レッスン統計情報
 */
export async function getStudentLessonStats(studentId) {
  try {
    const result = await query(`
      SELECT 
        student_id,
        MAX(
          CASE 
            WHEN lesson_result = '実施済み' 
              AND lesson_number != 'PROプラン' 
            THEN CAST(lesson_number AS INTEGER)
            ELSE 0
          END
        ) as max_lesson_number,
        MAX(
          CASE 
            WHEN lesson_result = '実施済み' 
              AND lesson_number = 'PROプラン'
            THEN 1
            ELSE 0
          END
        ) as has_pro_plan,
        SUM(
          CASE 
            WHEN lesson_result = '無断キャンセル'
            THEN 1
            ELSE 0
          END
        ) as absence_count,
        SUM(
          CASE 
            WHEN lesson_result = '実施済み'
            THEN 1
            ELSE 0
          END
        ) as completed_count,
        COUNT(*) as total_reports
      FROM lesson_reports
      WHERE student_id = $1
      GROUP BY student_id
    `, [studentId]);

    if (result.rows.length === 0) {
      return {
        lesson_progress: null,
        absence_count: 0,
        completed_count: 0,
        total_reports: 0
      };
    }

    const row = result.rows[0];
    const hasPro = parseInt(row.has_pro_plan) > 0;
    const maxLesson = parseInt(row.max_lesson_number) || 0;
    
    // PROプランの場合は「PROプラン」、それ以外は最大レッスン番号
    let lessonProgress = null;
    if (hasPro) {
      lessonProgress = 'PROプラン';
    } else if (maxLesson > 0) {
      lessonProgress = String(maxLesson);
    }
    
    return {
      lesson_progress: lessonProgress,
      absence_count: parseInt(row.absence_count) || 0,
      completed_count: parseInt(row.completed_count) || 0,
      total_reports: parseInt(row.total_reports) || 0
    };
  } catch (error) {
    console.error(`❌ 生徒レッスン統計取得エラー (${studentId}):`, error);
    throw error;
  }
}

/**
 * レッスン実施状況を日付範囲で取得
 * @param {string} startDate - 開始日 (YYYY-MM-DD)
 * @param {string} endDate - 終了日 (YYYY-MM-DD)
 * @returns {Promise<Array>} レッスン報告の配列
 */
export async function getLessonReportsByDateRange(startDate, endDate) {
  try {
    const result = await query(`
      SELECT 
        lr.*,
        s.name as student_name,
        s.homeroom_tutor
      FROM lesson_reports lr
      LEFT JOIN students s ON lr.student_id = s.student_id
      WHERE lr.lesson_date >= $1 AND lr.lesson_date <= $2
      ORDER BY lr.lesson_date DESC, lr.student_id ASC
    `, [startDate, endDate]);

    return result.rows;
  } catch (error) {
    console.error('❌ レッスン報告取得エラー:', error);
    throw error;
  }
}

/**
 * 特定日のレッスン実施状況サマリーを取得
 * @param {string} date - 日付 (YYYY-MM-DD)
 * @returns {Promise<Object>} レッスン実施状況サマリー
 */
export async function getDailyLessonSummary(date) {
  try {
    const result = await query(`
      SELECT 
        lesson_result,
        COUNT(*) as count
      FROM lesson_reports
      WHERE lesson_date = $1
      GROUP BY lesson_result
    `, [date]);

    const summary = {
      total: 0,
      completed: 0,
      student_reschedule: 0,
      tutor_reschedule: 0,
      no_show: 0
    };

    result.rows.forEach(row => {
      summary.total += parseInt(row.count);
      switch (row.lesson_result) {
        case '実施済み':
          summary.completed += parseInt(row.count);
          break;
        case '生徒様都合でリスケ':
          summary.student_reschedule += parseInt(row.count);
          break;
        case 'Tutor都合でリスケ':
          summary.tutor_reschedule += parseInt(row.count);
          break;
        case '無断キャンセル':
          summary.no_show += parseInt(row.count);
          break;
      }
    });

    return summary;
  } catch (error) {
    console.error('❌ 日次レッスンサマリー取得エラー:', error);
    throw error;
  }
}
