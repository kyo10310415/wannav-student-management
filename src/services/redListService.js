import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from './cacheService.js';

/**
 * Calculate red list score for a student for a given month
 * @param {string} studentId - Student ID
 * @param {string} yearMonth - Target month in YYYY-MM format
 * @returns {Object} Score breakdown and total
 */
export async function calculateRedListScore(studentId, yearMonth) {
  const scores = {
    satisfaction: 0,      // 0-4 points
    absence: 0,           // 0-3 points
    survey: 0,            // 0-1 points
    reschedule: 0,        // 0-1 points
    reservation: 0,       // 0-1 points
    total: 0,
    rank: 'none'
  };

  // 1. レッスン満足度チェック (4点)
  try {
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    if (cacheSpreadsheetId) {
      const satisfactionData = await fetchSatisfactionFromCache(cacheSpreadsheetId);
      
      // Filter by studentId and yearMonth (convert YYYY-MM to YYYY/M format for comparison)
      const [year, month] = yearMonth.split('-').map(Number);
      const targetYearMonth1 = `${year}/${month}`;
      const targetYearMonth2 = `${year}/${String(month).padStart(2, '0')}`;
      
      const studentSatisfactionRecords = satisfactionData.filter(record => {
        const normalizedId = (record.student_id || '').toString().trim().toUpperCase();
        const normalizedTargetId = (studentId || '').toString().trim().toUpperCase();
        const matchesStudent = normalizedId === normalizedTargetId;
        const matchesMonth = record.year_month === targetYearMonth1 || record.year_month === targetYearMonth2;
        return matchesStudent && matchesMonth;
      });
      
      if (studentSatisfactionRecords.length > 0) {
        // Calculate average satisfaction score
        const scores_arr = studentSatisfactionRecords
          .map(r => parseFloat(r.satisfaction_score))
          .filter(s => !isNaN(s));
        
        if (scores_arr.length > 0) {
          const avgScore = scores_arr.reduce((a, b) => a + b, 0) / scores_arr.length;
          
          // If average satisfaction is 7 or below (out of 10), add 4 points
          if (avgScore <= 7) {
            scores.satisfaction = 4;
          }
        }
      }
    }
  } catch (error) {
    console.error(`[Red List] Error checking satisfaction for ${studentId}:`, error);
  }

  // 2. レッスン欠席チェック (3点)
  try {
    const absenceResult = await query(
      `SELECT COUNT(*) as absence_count
       FROM lesson_reports
       WHERE student_id = $1
         AND TO_CHAR(lesson_date, 'YYYY-MM') = $2
         AND lesson_result = '無断キャンセル'`,
      [studentId, yearMonth]
    );
    
    if (absenceResult.rows[0].absence_count > 0) {
      scores.absence = 3;
    }
  } catch (error) {
    console.error(`[Red List] Error checking absence for ${studentId}:`, error);
  }

  // 3. アンケート未回答チェック (1点) - 前月
  try {
    const [year, month] = yearMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1); // month - 2 because month is 1-indexed
    const prevYearMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    
    // Check if student responded to survey last month
    const surveyResult = await query(
      `SELECT COUNT(*) as response_count
       FROM survey_responses
       WHERE student_id = $1
         AND year_month = $2`,
      [studentId, prevYearMonth]
    );
    
    if (surveyResult.rows[0].response_count === 0) {
      scores.survey = 1;
    }
  } catch (error) {
    console.error(`[Red List] Error checking survey for ${studentId}:`, error);
  }

  // 4. リスケチェック (1点)
  try {
    const rescheduleResult = await query(
      `SELECT COUNT(*) as reschedule_count
       FROM lesson_reports
       WHERE student_id = $1
         AND TO_CHAR(lesson_date, 'YYYY-MM') = $2
         AND lesson_result = '生徒様都合でリスケ'`,
      [studentId, yearMonth]
    );
    
    if (rescheduleResult.rows[0].reschedule_count > 0) {
      scores.reschedule = 1;
    }
  } catch (error) {
    console.error(`[Red List] Error checking reschedule for ${studentId}:`, error);
  }

  // 5. 予約不足チェック (1点) - 毎月10日時点で2回以上予約が入っているかチェック
  try {
    const [year, month] = yearMonth.split('-').map(Number);
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 0-indexed
    const currentDay = today.getDate();
    
    console.log(`[Red List] Reservation check for ${studentId}:`, {
      targetMonth: yearMonth,
      today: `${currentYear}-${currentMonth}-${currentDay}`,
      currentYear,
      currentMonth,
      currentDay
    });
    
    // Only check reservation count if:
    // 1. We're checking for a past month, OR
    // 2. We're checking current month AND today is 10th or later
    const isPastMonth = year < currentYear || (year === currentYear && month < currentMonth);
    const isCurrentMonthAfter10th = year === currentYear && month === currentMonth && currentDay >= 10;
    
    console.log(`[Red List] ${studentId} - isPastMonth: ${isPastMonth}, isCurrentMonthAfter10th: ${isCurrentMonthAfter10th}`);
    
    if (isPastMonth || isCurrentMonthAfter10th) {
      const checkDate = `${year}-${String(month).padStart(2, '0')}-10`;
      
      const reservationResult = await query(
        `SELECT COUNT(*) as reservation_count
         FROM lessons
         WHERE student_id = $1
           AND TO_CHAR(lesson_date, 'YYYY-MM') = $2
           AND lesson_date <= $3`,
        [studentId, yearMonth, checkDate]
      );
      
      const reservationCount = parseInt(reservationResult.rows[0].reservation_count);
      console.log(`[Red List] ${studentId} - Reservations by ${checkDate}: ${reservationCount}`);
      
      if (reservationCount < 2) {
        scores.reservation = 1;
        console.log(`[Red List] ${studentId} - Reservation insufficient (${reservationCount} < 2), adding 1 point`);
      } else {
        console.log(`[Red List] ${studentId} - Reservation sufficient (${reservationCount} >= 2), no penalty`);
      }
    } else {
      console.log(`[Red List] ${studentId} - Skipping reservation check (before 10th of current month)`);
    }
    // If today is before 10th of the current month, don't check (reservation = 0)
  } catch (error) {
    console.error(`[Red List] Error checking reservations for ${studentId}:`, error);
  }

  // Calculate total and rank
  scores.total = scores.satisfaction + scores.absence + scores.survey + scores.reschedule + scores.reservation;
  
  if (scores.total >= 7) {
    scores.rank = 'high';
  } else if (scores.total >= 4) {
    scores.rank = 'middle';
  } else if (scores.total >= 3) {
    scores.rank = 'low';
  } else {
    scores.rank = 'none';
  }

  return scores;
}

/**
 * Update red list for a student
 * @param {string} studentId - Student ID
 * @param {string} yearMonth - Target month in YYYY-MM format (optional, defaults to current month)
 */
export async function updateRedList(studentId, yearMonth = null) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const scores = await calculateRedListScore(studentId, yearMonth);

  await query(
    `INSERT INTO red_list 
     (student_id, year_month, satisfaction_score, absence_score, survey_score, reschedule_score, reservation_score, total_score, rank, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (student_id, year_month)
     DO UPDATE SET
       satisfaction_score = $3,
       absence_score = $4,
       survey_score = $5,
       reschedule_score = $6,
       reservation_score = $7,
       total_score = $8,
       rank = $9,
       updated_at = CURRENT_TIMESTAMP`,
    [
      studentId,
      yearMonth,
      scores.satisfaction,
      scores.absence,
      scores.survey,
      scores.reschedule,
      scores.reservation,
      scores.total,
      scores.rank
    ]
  );

  return scores;
}

/**
 * Update red list for all active students
 * @param {string} yearMonth - Target month in YYYY-MM format (optional, defaults to current month)
 */
export async function updateAllRedLists(yearMonth = null) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  console.log(`[Red List] Updating red list for all students (${yearMonth})...`);

  const studentsResult = await query(
    `SELECT student_id FROM students WHERE status = 'アクティブ'`
  );

  let updated = 0;
  let errors = 0;

  for (const student of studentsResult.rows) {
    try {
      await updateRedList(student.student_id, yearMonth);
      updated++;
    } catch (error) {
      console.error(`[Red List] Error updating ${student.student_id}:`, error);
      errors++;
    }
  }

  console.log(`[Red List] Update complete: ${updated} updated, ${errors} errors`);

  return { updated, errors };
}

/**
 * Get red list data for a student
 * @param {string} studentId - Student ID
 * @param {string} yearMonth - Target month in YYYY-MM format (optional, defaults to current month)
 */
export async function getRedList(studentId, yearMonth = null) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const result = await query(
    `SELECT * FROM red_list WHERE student_id = $1 AND year_month = $2`,
    [studentId, yearMonth]
  );

  return result.rows[0] || null;
}

/**
 * Get all red list data for current month
 * @param {string} yearMonth - Target month in YYYY-MM format (optional, defaults to current month)
 */
export async function getAllRedLists(yearMonth = null) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const result = await query(
    `SELECT 
      rl.*,
      s.name as student_name,
      s.homeroom_tutor
     FROM red_list rl
     LEFT JOIN students s ON rl.student_id = s.student_id
     WHERE rl.year_month = $1
     ORDER BY rl.total_score DESC, rl.student_id`,
    [yearMonth]
  );

  return result.rows;
}
