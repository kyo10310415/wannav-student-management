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
 * Body: { content, imageUrl, channelType, targetStatus, targetTutor, name, saveAsTemplate, isTest }
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
    
    // Handle test mode - skip student lookup
    if (messageData.isTest) {
      console.log('[Broadcast] Test mode: Skipping student lookup');
      console.log('[Broadcast] Test mode message data:', {
        hasContent: !!messageData.content,
        hasImageUrl: !!messageData.imageUrl,
        imageUrl: messageData.imageUrl || 'none',
        channelType: messageData.channelType
      });
      
      // Send broadcast in test mode (empty student array)
      const result = await sendBroadcast(messageData, [], user.email);
      
      return c.json({
        success: true,
        message: 'Test broadcast sent',
        broadcastId: result.broadcastId,
        results: result.results
      });
    }
    
    // Get target students for normal mode
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
 * Get list of tutors for filtering (only users registered in users table)
 */
app.get('/tutors', async (c) => {
  try {
    const user = c.get('user');
    
    // Import query function
    const { query } = await import('../db/connection.js');
    
    // Get tutors that are registered as users (have email in users table)
    let sqlQuery = `
      SELECT DISTINCT t.notion_name, t.email 
      FROM tutors t
      INNER JOIN users u ON LOWER(t.email) = LOWER(u.email)
      WHERE t.notion_name IS NOT NULL 
      ORDER BY t.notion_name
    `;
    const params = [];
    
    // If crew, only return their own info
    if (user.role === 'crew') {
      sqlQuery = `
        SELECT t.notion_name, t.email 
        FROM tutors t
        INNER JOIN users u ON LOWER(t.email) = LOWER(u.email)
        WHERE LOWER(t.email) = LOWER($1)
      `;
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

/**
 * POST /api/broadcast/upload-image
 * Upload image to Discord CDN via webhook
 */
app.post('/upload-image', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const file = body['image'];
    
    if (!file || !file.size) {
      return c.json({
        success: false,
        error: 'No image file provided'
      }, 400);
    }
    
    // Check file size (max 8MB)
    if (file.size > 8 * 1024 * 1024) {
      return c.json({
        success: false,
        error: 'Image file too large (max 8MB)'
      }, 400);
    }
    
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({
        success: false,
        error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP'
      }, 400);
    }
    
    // Import axios and FormData
    const axios = (await import('axios')).default;
    const FormData = (await import('form-data')).default;
    
    // Use test webhook to upload image
    const testWebhookUrl = 'https://discord.com/api/webhooks/1282616705817903146/M4KSUtmoHYSDqySMBgtgjU0wZywkUkVtfh3KOOA-BNzgXMnwVnEphKwuleMXhFn60MYd';
    
    // Create FormData and append file
    const formData = new FormData();
    
    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    formData.append('file', buffer, {
      filename: file.name,
      contentType: file.type
    });
    
    console.log('[Broadcast] Uploading image to Discord webhook');
    
    // Send to Discord webhook with wait=true to get message data
    const response = await axios.post(testWebhookUrl + '?wait=true', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    console.log('[Broadcast] Discord response received:', {
      hasAttachments: !!response.data.attachments,
      attachmentsCount: response.data.attachments?.length,
      messageId: response.data.id
    });
    
    // Extract image URL from Discord response
    const imageUrl = response.data.attachments?.[0]?.url;
    const messageId = response.data.id;
    
    console.log('[Broadcast] Image URL extracted:', imageUrl);
    
    if (!imageUrl) {
      console.error('[Broadcast] No image URL in response:', response.data);
      throw new Error('Failed to get image URL from Discord');
    }
    
    // Delete the upload message immediately to avoid duplicate images
    // Extract webhook ID and token from URL
    const webhookMatch = testWebhookUrl.match(/webhooks\/(\d+)\/([^\/]+)/);
    if (webhookMatch && messageId) {
      const webhookId = webhookMatch[1];
      const webhookToken = webhookMatch[2];
      
      try {
        await axios.delete(
          `https://discord.com/api/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`
        );
        console.log('[Broadcast] Deleted upload preview message');
      } catch (deleteError) {
        console.warn('[Broadcast] Failed to delete upload message:', deleteError.message);
        // Don't fail the upload if deletion fails
      }
    }
    
    console.log('[Broadcast] Returning image URL to client:', imageUrl);
    
    return c.json({
      success: true,
      imageUrl: imageUrl
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
