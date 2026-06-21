import { Hono } from 'hono';
import { fetchSchedulesFromSheet, fetchIndividualWebhooks, fetchTutorWebhooks } from '../services/sheetsService.js';
import { query } from '../db/connection.js';
import { notifyAbsenceRequest, notifyAbsenceApproval } from '../services/discordService.js';

const app = new Hono();

/**
 * Get all tutor schedules from Google Sheets
 */
app.get('/', async (c) => {
  try {
    // Fetch schedules from Google Sheets
    let schedules = [];
    try {
      schedules = await fetchSchedulesFromSheet();
    } catch (error) {
      console.warn('⚠️ fetchSchedulesFromSheet failed (Google API error) — returning empty list:', error.message);
      return c.json({ success: true, data: [], cache_error: true });
    }
    
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
    
    // Check if there's already an absence request for this event and tutor
    const checkQuery = `
      SELECT id, absence_type FROM absence_requests
      WHERE event_id = $1 AND tutor_email = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const existingRequest = await query(checkQuery, [event_id, tutor_email]);
    
    let absenceRequestId;
    
    if (existingRequest.rows.length > 0) {
      // Update existing request instead of creating a new one (reset to pending status)
      const updateQuery = `
        UPDATE absence_requests
        SET absence_type = $1, reason = $2, year = $3, month = $4,
            schedule_date = $5, schedule_time = $6, schedule_title = $7,
            matched_keyword = $8, created_at = NOW(), status = 'pending'
        WHERE id = $9
        RETURNING id
      `;
      
      const updateResult = await query(updateQuery, [
        absence_type,
        reason,
        year,
        month,
        schedule_date,
        schedule_time,
        schedule_title,
        matched_keyword,
        existingRequest.rows[0].id
      ]);
      
      absenceRequestId = updateResult.rows[0].id;
      
      // Update tutor counters (decrement old type, increment new type if different)
      const oldType = existingRequest.rows[0].absence_type;
      if (oldType !== absence_type) {
        const oldCounter = oldType === 'cancel' ? 'cancel_count' : 'schedule_reschedule_count';
        const newCounter = absence_type === 'cancel' ? 'cancel_count' : 'schedule_reschedule_count';
        
        await query(
          `UPDATE tutors SET ${oldCounter} = GREATEST(0, ${oldCounter} - 1) WHERE email = $1`,
          [tutor_email]
        );
        
        await query(
          `UPDATE tutors SET ${newCounter} = ${newCounter} + 1 WHERE email = $1`,
          [tutor_email]
        );
      }
    } else {
      // Insert new absence request with pending status
      const insertQuery = `
        INSERT INTO absence_requests 
        (event_id, tutor_email, tutor_name, absence_type, reason, year, month, 
         schedule_date, schedule_time, schedule_title, matched_keyword, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
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
      
      absenceRequestId = result.rows[0].id;
      
      // Update tutor counter
      const counterColumn = absence_type === 'cancel' ? 'cancel_count' : 'schedule_reschedule_count';
      await query(
        `UPDATE tutors SET ${counterColumn} = ${counterColumn} + 1 WHERE email = $1`,
        [tutor_email]
      );
    }
    
    // Send Discord notification to leader
    if (leader_email) {
      try {
        // Fetch webhook URLs and Discord user IDs from Google Sheets (個別取得シート)
        const SCHEDULES_SPREADSHEET_ID = '1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo';
        const webhookMap = await fetchIndividualWebhooks(SCHEDULES_SPREADSHEET_ID);
        
        // Find leader's webhook data by matching email (case-insensitive)
        const leaderData = webhookMap[leader_email.toLowerCase()];
        
        if (leaderData && leaderData.webhook) {
          // Get base URL for schedule link
          const baseUrl = process.env.APP_URL || 'https://wannav-student-management.onrender.com';
          const scheduleUrl = `${baseUrl}/?page=schedules`;
          
          // Send notification with Discord user mention and schedule link
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
            },
            scheduleUrl
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
        id: absenceRequestId,
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
 * Delete/cancel absence request
 */
app.delete('/absence/:eventId/:tutorEmail', async (c) => {
  try {
    const eventId = c.req.param('eventId');
    const tutorEmail = c.req.param('tutorEmail');
    
    if (!eventId || !tutorEmail) {
      return c.json({
        success: false,
        error: 'イベントIDとメールアドレスが必要です'
      }, 400);
    }
    
    // Get the absence request details before deleting
    const getQuery = `
      SELECT absence_type FROM absence_requests
      WHERE event_id = $1 AND tutor_email = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const existingRequest = await query(getQuery, [eventId, tutorEmail]);
    
    if (existingRequest.rows.length === 0) {
      return c.json({
        success: false,
        error: '不参加申請が見つかりません'
      }, 404);
    }
    
    const absenceType = existingRequest.rows[0].absence_type;
    
    // Delete the absence request
    const deleteQuery = `
      DELETE FROM absence_requests
      WHERE event_id = $1 AND tutor_email = $2
    `;
    
    await query(deleteQuery, [eventId, tutorEmail]);
    
    // Update tutor counter (decrement)
    const counterColumn = absenceType === 'cancel' ? 'cancel_count' : 'schedule_reschedule_count';
    await query(
      `UPDATE tutors SET ${counterColumn} = GREATEST(0, ${counterColumn} - 1) WHERE email = $1`,
      [tutorEmail]
    );
    
    return c.json({
      success: true,
      message: '不参加申請を取り下げました'
    });
    
  } catch (error) {
    console.error('Error deleting absence request:', error);
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
    // Google API が失敗した場合はスケジュール数を 0 として DB の欠席集計のみで返す
    let schedules = [];
    try {
      schedules = await fetchSchedulesFromSheet();
    } catch (error) {
      console.warn('⚠️ fetchSchedulesFromSheet failed in absence-stats (Google API error) — using DB data only:', error.message);
      // schedules を空配列のまま続行（scheduled_count=0、attendance_rate=計算不可）
    }
    
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

/**
 * Get absence requests for current month
 * Returns all absence requests to show who has submitted absence for each event
 */
app.get('/absence-requests', async (c) => {
  try {
    const year = c.req.query('year') || new Date().getFullYear();
    const month = c.req.query('month') || new Date().getMonth() + 1;
    
    // Get all APPROVED absence requests for the specified month
    const requestsQuery = `
      SELECT 
        event_id,
        tutor_email,
        tutor_name,
        absence_type,
        reason,
        created_at
      FROM absence_requests
      WHERE year = $1 AND month = $2 AND status = 'approved'
      ORDER BY created_at DESC
    `;
    
    const requestsResult = await query(requestsQuery, [year, month]);
    
    // Group by event_id and remove duplicates (keep only latest per tutor per event)
    const requestsByEvent = {};
    requestsResult.rows.forEach(row => {
      if (!requestsByEvent[row.event_id]) {
        requestsByEvent[row.event_id] = {};
      }
      
      // Keep only the latest request per tutor (rows are already sorted by created_at DESC)
      if (!requestsByEvent[row.event_id][row.tutor_email]) {
        requestsByEvent[row.event_id][row.tutor_email] = {
          tutor_email: row.tutor_email,
          tutor_name: row.tutor_name,
          absence_type: row.absence_type,
          reason: row.reason,
          created_at: row.created_at
        };
      }
    });
    
    // Convert to array format
    const requestsByEventArray = {};
    Object.keys(requestsByEvent).forEach(eventId => {
      requestsByEventArray[eventId] = Object.values(requestsByEvent[eventId]);
    });
    
    return c.json({
      success: true,
      data: {
        year: parseInt(year),
        month: parseInt(month),
        requests: requestsByEventArray
      }
    });
    
  } catch (error) {
    console.error('Error fetching absence requests:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Get pending absence requests (for approval tab)
 */
app.get('/absence-requests/pending', async (c) => {
  try {
    const year = c.req.query('year') || new Date().getFullYear();
    const month = c.req.query('month') || new Date().getMonth() + 1;
    
    // Get all PENDING absence requests for the specified month
    const requestsQuery = `
      SELECT 
        id,
        event_id,
        tutor_email,
        tutor_name,
        absence_type,
        reason,
        schedule_title,
        schedule_date,
        schedule_time,
        matched_keyword,
        created_at
      FROM absence_requests
      WHERE year = $1 AND month = $2 AND status = 'pending'
      ORDER BY created_at DESC
    `;
    
    const requestsResult = await query(requestsQuery, [year, month]);
    
    // Group by event_id
    const requestsByEvent = {};
    requestsResult.rows.forEach(row => {
      if (!requestsByEvent[row.event_id]) {
        requestsByEvent[row.event_id] = {
          event_id: row.event_id,
          schedule_title: row.schedule_title,
          schedule_date: row.schedule_date,
          schedule_time: row.schedule_time,
          matched_keyword: row.matched_keyword,
          requests: []
        };
      }
      
      requestsByEvent[row.event_id].requests.push({
        id: row.id,
        tutor_email: row.tutor_email,
        tutor_name: row.tutor_name,
        absence_type: row.absence_type,
        reason: row.reason,
        created_at: row.created_at
      });
    });
    
    return c.json({
      success: true,
      data: {
        year: parseInt(year),
        month: parseInt(month),
        pendingRequests: Object.values(requestsByEvent)
      }
    });
    
  } catch (error) {
    console.error('Error fetching pending absence requests:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Approve an absence request
 */
app.post('/absence/:requestId/approve', async (c) => {
  try {
    const requestId = c.req.param('requestId');
    const body = await c.req.json();
    const { leader_email, leader_name } = body;
    
    // Validation
    if (!leader_email || !leader_name) {
      return c.json({
        success: false,
        error: 'リーダー情報が不足しています'
      }, 400);
    }
    
    // Get request details before updating
    const getRequestQuery = `
      SELECT * FROM absence_requests WHERE id = $1
    `;
    const requestResult = await query(getRequestQuery, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return c.json({
        success: false,
        error: '申請が見つかりません'
      }, 404);
    }
    
    const request = requestResult.rows[0];
    
    // Check if already approved
    if (request.status === 'approved') {
      return c.json({
        success: false,
        error: 'すでに受理されています'
      }, 400);
    }
    
    // Update status to approved
    const updateQuery = `
      UPDATE absence_requests
      SET status = 'approved', leader_email = $1, approved_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    
    await query(updateQuery, [leader_email, requestId]);
    
    // Send approval notification to tutor
    try {
      const { fetchTutorWebhooks } = await import('../services/sheetsService.js');
      const { notifyAbsenceApproval } = await import('../services/discordService.js');
      
      console.log(`[Discord] Attempting to send approval notification to tutor: ${request.tutor_name}`);
      
      // Fetch tutor webhooks from WTCチャットURL sheet
      const tutorWebhookMap = await fetchTutorWebhooks();
      console.log(`[Discord] Available tutor names in webhook map:`, Object.keys(tutorWebhookMap));
      console.log(`[Discord] Looking for tutor name: "${request.tutor_name}"`);
      
      // Find tutor's webhook data by matching name (exact match first)
      let tutorData = tutorWebhookMap[request.tutor_name];
      
      // If exact match not found, try partial match (fallback)
      if (!tutorData) {
        const tutorNameLower = request.tutor_name.toLowerCase().replace(/\s/g, '');
        const matchedKey = Object.keys(tutorWebhookMap).find(key => {
          const keyLower = key.toLowerCase().replace(/\s/g, '');
          return keyLower.includes(tutorNameLower) || tutorNameLower.includes(keyLower);
        });
        
        if (matchedKey) {
          tutorData = tutorWebhookMap[matchedKey];
          console.log(`[Discord] Found partial match: "${request.tutor_name}" → "${matchedKey}"`);
        }
      }
      
      if (tutorData && tutorData.webhook) {
        console.log(`[Discord] Found webhook for ${request.tutor_name}, webhook URL: ${tutorData.webhook.substring(0, 50)}...`);
        console.log(`[Discord] Discord User ID: ${tutorData.discordUserId || 'Not set'}`);
        
        const approvalNotificationResult = await notifyAbsenceApproval(
          tutorData.webhook,
          tutorData.discordUserId,
          {
            tutor_name: request.tutor_name,
            absence_type: request.absence_type,
            schedule_title: request.schedule_title,
            schedule_date: request.schedule_date,
            schedule_time: request.schedule_time,
            matched_keyword: request.matched_keyword,
            leader_name
          }
        );
        
        if (approvalNotificationResult.success) {
          console.log(`[Discord] ✅ Approval notification sent successfully to tutor ${request.tutor_name}`);
        } else {
          console.error(`[Discord] ❌ Failed to send approval notification to ${request.tutor_name}:`, approvalNotificationResult.error);
        }
      } else {
        console.warn(`[Discord] ⚠️ No webhook URL found for tutor "${request.tutor_name}"`);
        console.warn(`[Discord] Available tutors:`, Object.keys(tutorWebhookMap).join(', '));
      }
    } catch (notifyError) {
      console.error('[Discord] Error sending approval notification:', notifyError);
      // Don't fail the whole request if notification fails
    }
    
    return c.json({
      success: true,
      message: '申請を受理しました'
    });
    
  } catch (error) {
    console.error('Error approving absence request:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
