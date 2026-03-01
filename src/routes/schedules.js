import { Hono } from 'hono';
import { fetchSchedulesFromSheet } from '../services/sheetsService.js';
import { query } from '../db/connection.js';

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
      absence_type, 
      reason, 
      schedule_date, 
      schedule_time, 
      schedule_title, 
      matched_keyword 
    } = body;
    
    // Validation
    if (!event_id || !absence_type || !reason) {
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
    
    // Get current user email from session (placeholder - implement auth later)
    // For now, use a default email
    const tutorEmail = 'default@example.com'; // TODO: Get from auth session
    const tutorName = 'Unknown Tutor'; // TODO: Get from tutors table
    
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
      tutorEmail,
      tutorName,
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
      SET ${counterColumn} = ${counterColumn} + 1
      WHERE email = $1
    `;
    await query(updateQuery, [tutorEmail]);
    
    return c.json({
      success: true,
      data: {
        id: result.rows[0].id,
        absence_type,
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

export default app;
