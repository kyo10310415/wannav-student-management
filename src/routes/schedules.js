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

export default app;
