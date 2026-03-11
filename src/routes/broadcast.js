import { Hono } from 'hono';
import { 
  getTargetStudents, 
  sendBroadcast, 
  getTemplates, 
  saveTemplate, 
  deleteTemplate,
  getBroadcastLogs
} from '../services/broadcastService.js';
import { query } from '../db/connection.js';

const app = new Hono();

/**
 * Middleware: Verify session authentication
 */
async function authMiddleware(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  
  try {
    // Verify session
    const sessionResult = await query(
      `SELECT s.*, u.email, u.role 
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [sessionToken]
    );
    
    if (sessionResult.rows.length === 0) {
      return c.json({ success: false, error: 'Invalid or expired session' }, 401);
    }
    
    const session = sessionResult.rows[0];
    c.set('user', {
      id: session.user_id,
      email: session.email,
      role: session.role
    });
    
    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ success: false, error: 'Authentication failed' }, 401);
  }
}

// Apply auth middleware to all routes
app.use('*', authMiddleware);

/**
 * GET /api/broadcast/preview
 * Get preview of target students
 */
app.post('/preview', async (c) => {
  try {
    const user = c.get('user');
    const { targetStatus, targetTutor } = await c.req.json();
    
    const students = await getTargetStudents(
      targetStatus || 'active',
      targetTutor,
      user.email,
      user.role
    );
    
    return c.json({
      success: true,
      count: students.length,
      students: students.map(s => ({
        student_id: s.student_id,
        name: s.name,
        homeroom_tutor: s.homeroom_tutor
      }))
    });
  } catch (error) {
    console.error('Error getting preview:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/broadcast/send
 * Send broadcast message
 * Body: { content, imageUrl, channelType, targetStatus, targetTutor, name, saveAsTemplate }
 */
app.post('/send', async (c) => {
  try {
    const user = c.get('user');
    const messageData = await c.req.json();
    
    // Validate required fields
    if (!messageData.content) {
      return c.json({
        success: false,
        error: 'Message content is required'
      }, 400);
    }
    
    if (!messageData.channelType) {
      return c.json({
        success: false,
        error: 'Channel type is required'
      }, 400);
    }
    
    // Get target students
    const targetStudents = await getTargetStudents(
      messageData.targetStatus || 'active',
      messageData.targetTutor,
      user.email,
      user.role
    );
    
    if (targetStudents.length === 0) {
      return c.json({
        success: false,
        error: 'No target students found'
      }, 400);
    }
    
    // Send broadcast
    const result = await sendBroadcast(messageData, targetStudents, user.email);
    
    return c.json({
      success: true,
      message: `Broadcast sent to ${result.results.sent}/${result.results.total} students`,
      broadcastId: result.broadcastId,
      results: result.results
    });
  } catch (error) {
    console.error('Error sending broadcast:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/broadcast/templates
 * Get all templates for current user
 */
app.get('/templates', async (c) => {
  try {
    const user = c.get('user');
    
    const templates = await getTemplates(user.email, user.role);
    
    return c.json({
      success: true,
      templates
    });
  } catch (error) {
    console.error('Error getting templates:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /api/broadcast/templates
 * Create or update template
 * Body: { id (optional), name, content, imageUrl, channelType, targetTutor }
 */
app.post('/templates', async (c) => {
  try {
    const user = c.get('user');
    const templateData = await c.req.json();
    
    // Validate required fields
    if (!templateData.name) {
      return c.json({
        success: false,
        error: 'Template name is required'
      }, 400);
    }
    
    if (!templateData.content) {
      return c.json({
        success: false,
        error: 'Template content is required'
      }, 400);
    }
    
    const result = await saveTemplate(templateData, user.email);
    
    return c.json({
      success: true,
      message: templateData.id ? 'Template updated' : 'Template created',
      templateId: result.id
    });
  } catch (error) {
    console.error('Error saving template:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * DELETE /api/broadcast/templates/:id
 * Delete template
 */
app.delete('/templates/:id', async (c) => {
  try {
    const user = c.get('user');
    const templateId = c.req.param('id');
    
    await deleteTemplate(templateId, user.email, user.role);
    
    return c.json({
      success: true,
      message: 'Template deleted'
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/broadcast/logs
 * Get broadcast logs
 * Query: ?broadcastId=xxx&limit=100
 */
app.get('/logs', async (c) => {
  try {
    const broadcastId = c.req.query('broadcastId');
    const limit = parseInt(c.req.query('limit')) || 100;
    
    const logs = await getBroadcastLogs(broadcastId, limit);
    
    return c.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error getting logs:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/broadcast/tutors
 * Get list of tutors for filtering
 */
app.get('/tutors', async (c) => {
  try {
    const user = c.get('user');
    
    // Import query function
    const { query } = await import('../db/connection.js');
    
    let sqlQuery = 'SELECT DISTINCT notion_name, email FROM tutors WHERE notion_name IS NOT NULL ORDER BY notion_name';
    const params = [];
    
    // If crew, only return their own info
    if (user.role === 'crew') {
      sqlQuery = 'SELECT notion_name, email FROM tutors WHERE email = $1';
      params.push(user.email);
    }
    
    const result = await query(sqlQuery, params);
    
    return c.json({
      success: true,
      tutors: result.rows
    });
  } catch (error) {
    console.error('Error getting tutors:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
