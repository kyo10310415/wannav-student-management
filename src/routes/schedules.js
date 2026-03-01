import { Hono } from 'hono';
import { fetchSchedulesFromSheet, fetchIndividualWebhooks } from '../services/sheetsService.js';
import { query } from '../db/connection.js';
import { notifyAbsenceRequest } from '../services/discordService.js';

const app = new Hono();

/**
 * Get all tutor schedules from Google Sheets
 */
app.get('/', async (c) => {
  try {
    // Fetch schedules from Google Sheets
    const schedules = await fetchSchedulesFromSheet();
    
    // Fetch tutors from database for email mapping
    const tutorsResult = await query('SELECT email, tutor_name FROM tutors');
    const tutors = tutorsResult.rows;
    
    // Create email to tutor name mapping (case-insensitive)
    const emailToTutorMap = {};
    tutors.forEach(tutor => {
      if (tutor.email) {
        emailToTutorMap[tutor.email.toLowerCase()] = tutor.tutor_name;
      }
    });
    
    // Enrich schedules with tutor names
    const enrichedSchedules = schedules.map(schedule => {
      // Map leader email to tutor name
      const leaderEmail = schedule.account ? schedule.account.toLowerCase() : null;
      const leaderName = leaderEmail ? (emailToTutorMap[leaderEmail] || schedule.account) : '-';
      
      // Map attendee emails to tutor names
      let attendeeNames = [];
      if (schedule.attendees) {
        const attendeeEmails = schedule.attendees.split(',').map(email => email.trim().toLowerCase());
        attendeeNames = attendeeEmails.map(email => 
          emailToTutorMap[email] || email
        );
      }
      
      return {
        ...schedule,
        leader_name: leaderName,
        attendee_names: attendeeNames
      };
    });
    
    return c.json({
      success: true,
      data: enrichedSchedules
    });
    
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Submit absence request
 */
app.post('/absence', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      event_id,
      tutor_email,
      tutor_name,
      absence_type, 
      reason, 
      schedule_date, 
      schedule_time, 
      schedule_title, 
      matched_keyword,
      leader_email  // リーダーのメールアドレス
    } = body;
    
    // Validation
    if (!event_id || !tutor_email || !tutor_name || !absence_type || !reason) {
      return c.json({
        success: false,
        error: '必須項目が不足しています'
      }, 400);
    }
    
    if (!['cancel', 'reschedule'].includes(absence_type)) {
      return c.json({
        success: false,
        error: '不正な種別です'
      }, 400);
    }
    
    // Extract year and month from schedule_date
    let year = new Date().getFullYear();
    let month = new Date().getMonth() + 1;
    
    if (schedule_date) {
      const dateParts = schedule_date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (dateParts) {
        year = parseInt(dateParts[1]);
        month = parseInt(dateParts[2]);
      }
    }
    
    // Insert absence request
    const insertQuery = `
      INSERT INTO absence_requests 
      (event_id, tutor_email, tutor_name, absence_type, reason, year, month, 
       schedule_date, schedule_time, schedule_title, matched_keyword)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;
    
    const result = await query(insertQuery, [
      event_id,
      tutor_email,
      tutor_name,
      absence_type,
      reason,
      year,
      month,
      schedule_date,
      schedule_time,
      schedule_title,
      matched_keyword
    ]);
    
    // Update tutor counters
    const counterColumn = absence_type === 'cancel' ? 'cancel_count' : 'schedule_reschedule_count';
    const updateQuery = `
      UPDATE tutors 
      SET ${counterColumn} = COALESCE(${counterColumn}, 0) + 1
      WHERE email = $1
    `;
    await query(updateQuery, [tutor_email]);
    
    // Send Discord notification to leader
    if (leader_email) {
      try {
        // Fetch webhook URLs and Discord user IDs from Google Sheets (個別取得シート)
        const SCHEDULES_SPREADSHEET_ID = '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo';
        const webhookMap = await fetchIndividualWebhooks(SCHEDULES_SPREADSHEET_ID);
        
        // Find leader's webhook data by matching email (case-insensitive)
        const leaderData = webhookMap[leader_email.toLowerCase()];
        
        if (leaderData && leaderData.webhook) {
          // Send notification with Discord user mention
          const notificationResult = await notifyAbsenceRequest(
            leaderData.webhook,
            leaderData.discordUserId,
            {
              schedule_title,
              schedule_date,
              schedule_time,
              matched_keyword,
              tutor_name,
              tutor_email,
              absence_type,
              reason
            }
          );
          
          if (notificationResult.success) {
            console.log(`[Discord] Absence notification sent to leader ${leader_email}`);
          } else {
            console.error(`[Discord] Failed to send notification to ${leader_email}:`, notificationResult.error);
          }
        } else {
          console.warn(`[Discord] No webhook URL found for leader ${leader_email}`);
        }
      } catch (notifyError) {
        console.error('[Discord] Error sending absence notification:', notifyError);
        // Don't fail the whole request if notification fails
      }
    }
    
    return c.json({
      success: true,
      data: {
        id: result.rows[0].id,
        absence_type,
        tutor_name,
        message: '不参加申請を受け付けました'
      }
    });
    
  } catch (error) {
    console.error('Error creating absence request:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Get absence statistics by month
 */
app.get('/absence-stats', async (c) => {
  try {
    const year = c.req.query('year') || new Date().getFullYear();
    const month = c.req.query('month') || new Date().getMonth() + 1;
    
    // Get absence requests for the specified month
    const requestsQuery = `
      SELECT 
        tutor_email,
        tutor_name,
        absence_type,
        COUNT(*) as count
      FROM absence_requests
      WHERE year = $1 AND month = $2
      GROUP BY tutor_email, tutor_name, absence_type
      ORDER BY tutor_name, absence_type
    `;
    
    const requestsResult = await query(requestsQuery, [year, month]);
    
    // Organize data by tutor
    const statsByTutor = {};
    requestsResult.rows.forEach(row => {
      if (!statsByTutor[row.tutor_email]) {
        statsByTutor[row.tutor_email] = {
          tutor_email: row.tutor_email,
          tutor_name: row.tutor_name,
          cancel_count: 0,
          reschedule_count: 0,
          total_count: 0,
          scheduled_count: 0,
          attendance_rate: 0
        };
      }
      
      if (row.absence_type === 'cancel') {
        statsByTutor[row.tutor_email].cancel_count = parseInt(row.count);
      } else if (row.absence_type === 'reschedule') {
        statsByTutor[row.tutor_email].reschedule_count = parseInt(row.count);
      }
      
      statsByTutor[row.tutor_email].total_count += parseInt(row.count);
    });
    
    // Fetch schedules from Google Sheets to calculate scheduled count
    const schedules = await fetchSchedulesFromSheet();
    
    // Get tutors for email to tutor name mapping
    const tutorsResult = await query('SELECT email, tutor_name FROM tutors');
    const tutors = tutorsResult.rows;
    const emailToTutorMap = {};
    tutors.forEach(tutor => {
      if (tutor.email) {
        emailToTutorMap[tutor.email.toLowerCase()] = tutor.tutor_name;
      }
    });
    
    // Count scheduled events for each tutor in the specified month
    const scheduledCountByTutor = {};
    schedules.forEach(schedule => {
      const scheduleDate = new Date(schedule.start_time);
      const scheduleYear = scheduleDate.getFullYear();
      const scheduleMonth = scheduleDate.getMonth() + 1;
      
      if (scheduleYear === parseInt(year) && scheduleMonth === parseInt(month)) {
        // Count for leader
        const leaderEmail = schedule.account ? schedule.account.toLowerCase() : null;
        if (leaderEmail) {
          scheduledCountByTutor[leaderEmail] = (scheduledCountByTutor[leaderEmail] || 0) + 1;
        }
        
        // Count for attendees
        if (schedule.attendees) {
          const attendeeEmails = schedule.attendees.split(',').map(email => email.trim().toLowerCase());
          attendeeEmails.forEach(email => {
            if (email) {
              scheduledCountByTutor[email] = (scheduledCountByTutor[email] || 0) + 1;
            }
          });
        }
      }
    });
    
    // Add scheduled count and calculate attendance rate
    Object.keys(statsByTutor).forEach(email => {
      const scheduledCount = scheduledCountByTutor[email] || 0;
      statsByTutor[email].scheduled_count = scheduledCount;
      
      // Calculate attendance rate
      // Attendance rate = (scheduled - cancel - reschedule) / scheduled * 100
      // If scheduled is 0, attendance rate is 100% (no schedules = perfect attendance)
      if (scheduledCount > 0) {
        const attendedCount = scheduledCount - statsByTutor[email].cancel_count - statsByTutor[email].reschedule_count;
        statsByTutor[email].attendance_rate = Math.max(0, (attendedCount / scheduledCount * 100));
      } else {
        statsByTutor[email].attendance_rate = 100;
      }
    });
    
    // Add tutors with schedules but no absence requests
    Object.keys(scheduledCountByTutor).forEach(email => {
      if (!statsByTutor[email]) {
        const tutorName = emailToTutorMap[email] || email;
        statsByTutor[email] = {
          tutor_email: email,
          tutor_name: tutorName,
          cancel_count: 0,
          reschedule_count: 0,
          total_count: 0,
          scheduled_count: scheduledCountByTutor[email],
          attendance_rate: 100
        };
      }
    });
    
    // Convert to array and sort by attendance_rate (ascending) then total_count (descending)
    const stats = Object.values(statsByTutor)
      .sort((a, b) => {
        if (a.attendance_rate !== b.attendance_rate) {
          return a.attendance_rate - b.attendance_rate; // Lower attendance rate first
        }
        return b.total_count - a.total_count; // Higher absence count first
      });
    
    return c.json({
      success: true,
      data: {
        year: parseInt(year),
        month: parseInt(month),
        stats: stats
      }
    });
    
  } catch (error) {
    console.error('Error fetching absence stats:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
