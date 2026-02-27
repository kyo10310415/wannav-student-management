import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { notifyHelperRequestCreated, notifyHelperRequestsRescheduled } from '../services/helperNotificationService.js';

const app = new Hono();

// Get all helper requests
app.get('/', async (c) => {
  try {
    const result = await query(`
      SELECT 
        hr.*,
        rt.tutor_name as requesting_tutor_display_name,
        at.tutor_name as accepted_by_tutor_display_name
      FROM helper_requests hr
      LEFT JOIN tutors rt ON hr.requesting_tutor_id = rt.employee_id
      LEFT JOIN tutors at ON hr.accepted_by_tutor_id = at.employee_id
      ORDER BY hr.created_at DESC
    `);
    
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching helper requests:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get single helper request
app.get('/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const result = await query(`
      SELECT 
        hr.*,
        rt.tutor_name as requesting_tutor_display_name,
        at.tutor_name as accepted_by_tutor_display_name
      FROM helper_requests hr
      LEFT JOIN tutors rt ON hr.requesting_tutor_id = rt.employee_id
      LEFT JOIN tutors at ON hr.accepted_by_tutor_id = at.employee_id
      WHERE hr.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'Helper request not found' }, 404);
    }
    
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching helper request:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Create new helper request
app.post('/', async (c) => {
  try {
    const data = await c.req.json();
    
    const result = await query(`
      INSERT INTO helper_requests (
        lesson_date, lesson_time, student_id, student_name, notion_url,
        requesting_tutor_id, requesting_tutor_name, lesson_progress,
        reason, notes, deadline, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
      RETURNING *
    `, [
      data.lesson_date,
      data.lesson_time,
      data.student_id,
      data.student_name,
      data.notion_url,
      data.requesting_tutor_id,
      data.requesting_tutor_name,
      data.lesson_progress,
      data.reason,
      data.notes || null,
      data.deadline
    ]);
    
    // Increment requesting tutor's helper_request_count
    await query(`
      UPDATE tutors 
      SET helper_request_count = COALESCE(helper_request_count, 0) + 1
      WHERE employee_id = $1
    `, [data.requesting_tutor_id]);
    
    // Send Discord notification
    await notifyHelperRequestCreated(result.rows[0]);
    
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating helper request:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Accept helper request
app.post('/:id/accept', async (c) => {
  try {
    const { id } = c.req.param();
    const { tutor_id, tutor_name } = await c.req.json();
    
    // Check if request exists and is not expired
    const checkResult = await query(`
      SELECT * FROM helper_requests 
      WHERE id = $1 AND status = 'pending'
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return c.json({ success: false, error: 'Request not found or already processed' }, 404);
    }
    
    const request = checkResult.rows[0];
    const deadline = new Date(request.deadline);
    const now = new Date();
    
    if (deadline < now) {
      return c.json({ success: false, error: 'この依頼は期限切れのため受諾できません' }, 400);
    }
    
    // Update request status
    const result = await query(`
      UPDATE helper_requests
      SET 
        status = 'accepted',
        accepted_by_tutor_id = $1,
        accepted_by_tutor_name = $2,
        accepted_at = NOW()
      WHERE id = $3 AND status = 'pending'
      RETURNING *
    `, [tutor_id, tutor_name, id]);
    
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'Request not found or already processed' }, 404);
    }
    
    // Increment accepting tutor's helper_accepted_count
    await query(`
      UPDATE tutors 
      SET helper_accepted_count = COALESCE(helper_accepted_count, 0) + 1
      WHERE employee_id = $1
    `, [tutor_id]);
    
    // Note: Discord notification for acceptance removed as per user request
    
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error accepting helper request:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Check and update expired requests (cron endpoint)
app.post('/check-expired', async (c) => {
  try {
    // Find pending requests that are past their deadline
    const expiredResult = await query(`
      SELECT * FROM helper_requests
      WHERE status = 'pending' AND deadline < NOW()
    `);
    
    if (expiredResult.rows.length === 0) {
      return c.json({ success: true, message: 'No expired requests found' });
    }
    
    // Update all expired requests to rescheduled
    await query(`
      UPDATE helper_requests
      SET status = 'rescheduled'
      WHERE status = 'pending' AND deadline < NOW()
    `);
    
    // Increment reschedule_count for each requesting tutor
    for (const request of expiredResult.rows) {
      await query(`
        UPDATE tutors
        SET reschedule_count = COALESCE(reschedule_count, 0) + 1
        WHERE employee_id = $1
      `, [request.requesting_tutor_id]);
    }
    
    // Send Discord notification
    await notifyHelperRequestsRescheduled(expiredResult.rows);
    
    return c.json({ 
      success: true, 
      message: `Updated ${expiredResult.rows.length} expired requests` 
    });
  } catch (error) {
    console.error('Error checking expired requests:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Delete helper request
app.delete('/:id', async (c) => {
  try {
    const { id } = c.req.param();
    
    // Get request details before deletion
    const requestResult = await query(`
      SELECT * FROM helper_requests WHERE id = $1
    `, [id]);
    
    if (requestResult.rows.length === 0) {
      return c.json({ success: false, error: 'Helper request not found' }, 404);
    }
    
    const request = requestResult.rows[0];
    
    // Delete the request
    await query(`
      DELETE FROM helper_requests WHERE id = $1
    `, [id]);
    
    // Decrement requesting tutor's helper_request_count
    await query(`
      UPDATE tutors 
      SET helper_request_count = GREATEST(COALESCE(helper_request_count, 1) - 1, 0)
      WHERE employee_id = $1
    `, [request.requesting_tutor_id]);
    
    // If the request was accepted, decrement accepted tutor's helper_accepted_count
    if (request.status === 'accepted' && request.accepted_by_tutor_id) {
      await query(`
        UPDATE tutors 
        SET helper_accepted_count = GREATEST(COALESCE(helper_accepted_count, 1) - 1, 0)
        WHERE employee_id = $1
      `, [request.accepted_by_tutor_id]);
    }
    
    return c.json({ success: true, message: 'Helper request deleted successfully' });
  } catch (error) {
    console.error('Error deleting helper request:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
