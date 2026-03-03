import axios from 'axios';
import { query } from '../db/connection.js';
import { fetchAllWanamiUsageCounts } from './sheetsService.js';

/**
 * Send daily statistics report to Discord
 */
export async function sendDailyStatsReport() {
  try {
    const webhookUrl = process.env.DISCORD_STATS_WEBHOOK_URL || 'https://discord.com/api/webhooks/1454123104698761260/V4dCIKzhu3OCc5FWLro0ttzj3dCsin5B4-kuWu1yxLUn_cIN68fiV4Iqjqmiox6jPR1d';
    const roleId = process.env.DISCORD_STATS_ROLE_ID || '1294923221107478571';
    
    console.log('[Stats Report] Generating daily statistics report...');
    
    // 1. Fetch all active tutors
    const tutorsResult = await query(`
      SELECT employee_id, tutor_name, notion_name, team, status, job_type
      FROM tutors
      WHERE status = 'アクティブ' 
      AND job_type LIKE '%Tutor%'
      ORDER BY team, tutor_name
    `);
    
    const tutors = tutorsResult.rows;
    console.log(`[Stats Report] Found ${tutors.length} active tutors`);
    
    // 2. Fetch all active students
    const studentsResult = await query(`
      SELECT student_id, name, homeroom_tutor, status, contract_plan
      FROM students
      WHERE status = 'アクティブ'
      AND contract_plan NOT IN ('永久会員', '在籍プラン')
    `);
    
    const students = studentsResult.rows;
    console.log(`[Stats Report] Found ${students.length} active students`);
    
    // 3. Fetch satisfaction data from internal API endpoint
    let satisfactionData = {};
    try {
      console.log('[Stats Report] Fetching satisfaction data from internal API...');
      const satisfactionResponse = await axios.get('http://localhost:3000/api/tutors/satisfaction/all');
      if (satisfactionResponse.data && satisfactionResponse.data.success && satisfactionResponse.data.data) {
        satisfactionData = satisfactionResponse.data.data;
        console.log(`[Stats Report] Satisfaction data loaded for ${Object.keys(satisfactionData).length} tutors`);
      } else {
        console.warn('[Stats Report] Satisfaction data structure unexpected:', satisfactionResponse.data);
      }
    } catch (error) {
      console.error('[Stats Report] Error fetching satisfaction data:', error.message);
    }
    
    // 4. Fetch Wanami usage counts
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const wanamiUsageCounts = await fetchAllWanamiUsageCounts(year, month);
    console.log(`[Stats Report] Found Wanami usage data for ${Object.keys(wanamiUsageCounts).length} students`);
    
    // 5. Calculate current month key
    const currentYearMonth = `${year}/${month}`;
    
    // 6. Calculate statistics by tutor
    const tutorStats = tutors.map(tutor => {
      // Get tutor's students
      const tutorStudents = students.filter(s => s.homeroom_tutor === tutor.notion_name);
      const activeStudentCount = tutorStudents.length;
      
      // Get satisfaction data
      const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
      const currentMonthData = tutorSatisfactionData[currentYearMonth];
      
      let satisfactionValue = 0;
      let satisfactionCount = 0;
      let collectionRateValue = 0;
      let satisfactionScoreValue = 0;
      
      if (currentMonthData && activeStudentCount > 0) {
        satisfactionValue = currentMonthData.average * 10; // 0-10 → 0-100
        satisfactionCount = currentMonthData.count;
        collectionRateValue = (satisfactionCount / activeStudentCount * 100);
        satisfactionScoreValue = satisfactionValue * collectionRateValue / 100;
      }
      
      // Calculate Wanami usage for tutor's students
      let wanamiTotal = 0;
      tutorStudents.forEach(student => {
        wanamiTotal += (wanamiUsageCounts[student.student_id] || 0);
      });
      
      return {
        tutorName: tutor.tutor_name,
        team: tutor.team || '未所属',
        activeStudentCount,
        satisfactionValue,
        satisfactionCount,
        collectionRateValue,
        satisfactionScoreValue,
        wanamiTotal
      };
    });
    
    console.log(`[Stats Report] Calculated stats for ${tutorStats.length} tutors`);
    const tutorsWithSatisfaction = tutorStats.filter(t => t.satisfactionScoreValue > 0).length;
    console.log(`[Stats Report] ${tutorsWithSatisfaction} tutors have satisfaction scores`);
    
    // 7. Calculate team statistics
    const teams = [...new Set(tutors.map(t => t.team || '未所属'))].sort();
    const teamStats = teams.map(team => {
      const teamTutors = tutorStats.filter(t => t.team === team);
      
      let teamSatisfactionScore = 0;
      let teamWanamiTotal = 0;
      let validCount = 0;
      
      teamTutors.forEach(tutor => {
        if (tutor.satisfactionScoreValue > 0) {
          teamSatisfactionScore += tutor.satisfactionScoreValue;
          validCount++;
        }
        teamWanamiTotal += tutor.wanamiTotal;
      });
      
      const avgSatisfactionScore = validCount > 0 ? (teamSatisfactionScore / validCount).toFixed(2) : '-';
      
      console.log(`[Stats Report] Team ${team}: ${validCount}/${teamTutors.length} tutors with scores, avg=${avgSatisfactionScore}`);
      
      return {
        team,
        tutorCount: teamTutors.length,
        avgSatisfactionScore,
        wanamiTotal: teamWanamiTotal
      };
    });
    
    // 8. Calculate overall statistics
    let overallSatisfactionScore = 0;
    let overallWanamiTotal = 0;
    let overallValidCount = 0;
    
    tutorStats.forEach(tutor => {
      if (tutor.satisfactionScoreValue > 0) {
        overallSatisfactionScore += tutor.satisfactionScoreValue;
        overallValidCount++;
      }
      overallWanamiTotal += tutor.wanamiTotal;
    });
    
    const overallAvgSatisfactionScore = overallValidCount > 0 ? (overallSatisfactionScore / overallValidCount).toFixed(2) : '-';
    
    // 9. Build Discord message
    const date = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    
    let message = `<@&${roleId}>\n\n`;
    message += `📊 **WannaV 中央管理システム - 日次統計レポート**\n`;
    message += `📅 ${date}\n\n`;
    
    // Overall statistics
    message += `**【全体統計】**\n`;
    message += `📈 満足度スコア平均: **${overallAvgSatisfactionScore}**\n`;
    message += `💬 わなみさん使用回数合計: **${overallWanamiTotal}回**\n\n`;
    
    // Team statistics
    message += `**【チーム別統計】**\n`;
    teamStats.forEach(team => {
      message += `\n**${team.team}**\n`;
      message += `├ 満足度スコア平均: ${team.avgSatisfactionScore}\n`;
      message += `└ わなみさん使用回数: ${team.wanamiTotal}回\n`;
    });
    
    message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🔗 詳細は管理システムをご確認ください\n`;
    message += `https://wannav-student-management.onrender.com`;
    
    // 10. Send to Discord
    await axios.post(webhookUrl, {
      content: message,
      username: 'WannaV 統計Bot',
      avatar_url: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    });
    
    console.log('[Stats Report] Daily statistics report sent successfully');
    return { success: true, message: 'Stats report sent' };
    
  } catch (error) {
    console.error('[Stats Report] Error sending daily statistics report:', error);
    throw error;
  }
}
