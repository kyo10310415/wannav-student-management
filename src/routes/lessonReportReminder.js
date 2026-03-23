import { Hono } from 'hono';
import { query } from '../db/connection.js';
import sendLessonReportReminder from '../jobs/lessonReportReminder.js';

const app = new Hono();

/**
 * POST /api/lesson-report-reminder/trigger
 * Manually trigger lesson report reminder job (for testing)
 */
app.post('/trigger', async (c) => {
  try {
    console.log('[API] Manual trigger: Lesson report reminder');
    
    // Run the job
    await sendLessonReportReminder();
    
    return c.json({
      success: true,
      message: 'Lesson report reminder job executed successfully'
    });
    
  } catch (error) {
    console.error('[API] Error triggering lesson report reminder:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/lesson-report-reminder/check-mapping
 * Check tutor and leader Discord mapping
 */
app.get('/check-mapping', async (c) => {
  try {
    console.log('[API] Checking tutor and leader Discord mapping...');
    
    // Get all tutors with their Discord settings
    const tutorsResult = await query(`
      SELECT 
        t.tutor_name,
        t.notion_name,
        t.email,
        t.team,
        t.status,
        u.discord_webhook_url IS NOT NULL as has_webhook,
        u.discord_user_id,
        u.role as user_role
      FROM tutors t
      LEFT JOIN users u ON LOWER(t.email) = LOWER(u.email)
      WHERE t.status = 'アクティブ'
        AND t.job_type ILIKE '%tutor%'
      ORDER BY t.team, t.tutor_name
    `);
    
    // Get all leaders with Discord settings
    const leadersResult = await query(`
      SELECT 
        u.email,
        u.role,
        u.discord_webhook_url IS NOT NULL as has_webhook,
        u.discord_user_id,
        t.tutor_name,
        t.team
      FROM users u
      LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE u.role IN ('admin', 'leader')
        AND u.discord_webhook_url IS NOT NULL
      ORDER BY t.team, u.role, u.email
    `);
    
    // Count lessons by tutor for yesterday
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const yesterday = new Date(jstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${year}-${month}-${day}`;
    
    const lessonsResult = await query(`
      SELECT 
        s.homeroom_tutor,
        t.tutor_name,
        t.email as tutor_email,
        t.team,
        COUNT(*) as lesson_count
      FROM lessons l
      JOIN students s ON l.student_id = s.student_id
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
      WHERE l.lesson_date = $1
      GROUP BY s.homeroom_tutor, t.tutor_name, t.email, t.team
      ORDER BY lesson_count DESC
    `, [yesterdayStr]);
    
    // Group leaders by team
    const leadersByTeam = {};
    leadersResult.rows.forEach(leader => {
      if (leader.team) {
        if (!leadersByTeam[leader.team]) {
          leadersByTeam[leader.team] = [];
        }
        leadersByTeam[leader.team].push({
          email: leader.email,
          role: leader.role,
          tutor_name: leader.tutor_name,
          has_webhook: leader.has_webhook,
          discord_user_id: leader.discord_user_id
        });
      }
    });
    
    // Build response with mapping info
    const tutorMapping = tutorsResult.rows.map(tutor => {
      const teamLeaders = leadersByTeam[tutor.team] || [];
      
      return {
        tutor_name: tutor.tutor_name,
        notion_name: tutor.notion_name,
        email: tutor.email,
        team: tutor.team,
        status: tutor.status,
        has_discord_webhook: tutor.has_webhook,
        discord_user_id: tutor.discord_user_id,
        user_role: tutor.user_role || 'No user account',
        team_leaders: teamLeaders,
        will_receive_notifications: tutor.has_webhook
      };
    });
    
    // Summary statistics
    const summary = {
      total_active_tutors: tutorsResult.rows.length,
      tutors_with_discord: tutorsResult.rows.filter(t => t.has_webhook).length,
      tutors_without_discord: tutorsResult.rows.filter(t => !t.has_webhook).length,
      total_leaders: leadersResult.rows.length,
      teams_with_leaders: Object.keys(leadersByTeam).length,
      yesterday_date: yesterdayStr,
      yesterday_lessons: lessonsResult.rows
    };
    
    return c.json({
      success: true,
      data: {
        summary,
        tutor_mapping: tutorMapping,
        leaders_by_team: leadersByTeam
      }
    });
    
  } catch (error) {
    console.error('[API] Error checking mapping:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
