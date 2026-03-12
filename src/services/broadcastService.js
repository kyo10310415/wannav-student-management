import axios from 'axios';
import { query } from '../db/connection.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { client as discordClient } from './discordService.js';

/**
 * Get target students for broadcast
 * @param {string} targetStatus - Student status filter (e.g., 'active')
 * @param {string} targetTutor - Tutor filter (null = all tutors)
 * @param {string} userEmail - Current user email
 * @param {string} userRole - Current user role (crew/leader/admin)
 * @returns {Array} - Array of target students
 */
export async function getTargetStudents(targetStatus, targetTutor, userEmail, userRole) {
  try {
    console.log('[Broadcast] getTargetStudents called with:', {
      targetStatus,
      targetTutor,
      userEmail,
      userRole
    });
    
    let sqlQuery = `
      SELECT s.student_id, s.name, s.status, s.homeroom_tutor, s.contract_plan
      FROM students s
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
    `;
    
    const params = [];
    let whereConditions = [];
    
    // Handle special "レッスン中" status (active students excluding permanent members and enrollment plan)
    if (targetStatus === 'レッスン中') {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push('アクティブ');
      whereConditions.push(`(s.contract_plan IS NULL OR (s.contract_plan != $${params.length + 1} AND s.contract_plan != $${params.length + 2}))`);
      params.push('永久会員');
      params.push('在籍プラン');
      console.log('[Broadcast] レッスン中 mode: アクティブ excluding 永久会員 and 在籍プラン');
    } else {
      whereConditions.push(`s.status = $${params.length + 1}`);
      params.push(targetStatus);
    }
    
    // Add WHERE clause
    if (whereConditions.length > 0) {
      sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    // Role-based filtering
    if (userRole === 'crew') {
      // Crew can only send to their own students
      sqlQuery += ` AND t.email = $${params.length + 1}`;
      params.push(userEmail);
      console.log('[Broadcast] Crew mode: filtering by email', userEmail);
    } else if (targetTutor && targetTutor !== 'all') {
      // Leader/Admin can filter by tutor
      sqlQuery += ` AND s.homeroom_tutor = $${params.length + 1}`;
      params.push(targetTutor);
      console.log('[Broadcast] Leader/Admin mode: filtering by tutor', targetTutor);
    } else {
      console.log('[Broadcast] Leader/Admin mode: no tutor filter (all students)');
    }
    
    sqlQuery += ' ORDER BY s.student_id';
    
    console.log('[Broadcast] Executing SQL:', sqlQuery);
    console.log('[Broadcast] With params:', params);
    
    const result = await query(sqlQuery, params);
    
    console.log(`[Broadcast] Found ${result.rows.length} target students`);
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting target students:', error);
    throw error;
  }
}

/**
 * Send broadcast message via webhook
 * @param {string} webhookUrl - Discord webhook URL
 * @param {string} discordId - Discord user ID for mention
 * @param {string} content - Message content
 * @param {string} imageId - Image ID (for database-stored images)
 */
async function sendViaWebhook(webhookUrl, discordId, content, imageId) {
  try {
    console.log('[Broadcast] sendViaWebhook called with:', {
      webhookUrl: webhookUrl ? webhookUrl.substring(0, 50) + '...' : 'none',
      discordId: discordId || 'none',
      contentLength: content ? content.length : 0,
      hasImage: !!imageId,
      imageId: imageId || 'none'
    });
    
    const embed = {
      description: content,
      color: 0x5865F2, // Discord blue
      timestamp: new Date().toISOString()
    };
    
    // Build payload
    const payload = {
      embeds: [embed]
    };
    
    // Add mention if Discord ID exists
    if (discordId) {
      payload.content = `<@${discordId}>`;
    }
    
    // If image exists, get it from database and attach as file
    if (imageId) {
      console.log('[Broadcast] Fetching image from database:', imageId);
      
      try {
        // Get image from database
        const imageResult = await query(
          'SELECT filename, content_type, image_data FROM broadcast_images WHERE image_id = $1',
          [imageId]
        );
        
        if (imageResult.rows.length > 0) {
          const imageData = imageResult.rows[0];
          
          console.log('[Broadcast] Attaching image from database:', {
            imageId,
            size: imageData.image_data.length,
            type: imageData.content_type,
            filename: imageData.filename
          });
          
          // Use FormData to send image as attachment
          const FormData = (await import('form-data')).default;
          const formData = new FormData();
          
          // Attach the image file
          formData.append('files[0]', imageData.image_data, {
            filename: imageData.filename,
            contentType: imageData.content_type
          });
          
          // Attach the payload as JSON
          formData.append('payload_json', JSON.stringify(payload));
          
          console.log('[Broadcast] Sending webhook with file attachment');
          
          const response = await axios.post(webhookUrl, formData, {
            headers: {
              ...formData.getHeaders()
            }
          });
          
          console.log('[Broadcast] Webhook response status:', response.status);
          
          return { success: true };
        } else {
          console.warn('[Broadcast] Image not found in database:', imageId);
          // Continue without image
        }
      } catch (imageError) {
        console.error('[Broadcast] Error fetching image:', imageError);
        // Continue without image
      }
    }
    
    // No image or image fetch failed, send as normal
    console.log('[Broadcast] Sending webhook without image');
    console.log('[Broadcast] Payload:', JSON.stringify(payload, null, 2));
    
    const response = await axios.post(webhookUrl, payload);
    console.log('[Broadcast] Webhook response status:', response.status);
    
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Webhook send error:', error.message);
    throw error;
  }
}

/**
 * Send broadcast message via Discord bot
 * @param {string} chatUrl - Discord chat URL
 * @param {string} discordId - Discord user ID for mention
 * @param {string} content - Message content
 * @param {string} imageUrl - Image URL (optional)
 */
async function sendViaBot(chatUrl, discordId, content, imageUrl) {
  try {
    // Extract channel ID from URL
    const channelIdMatch = chatUrl.match(/channels\/\d+\/(\d+)/);
    if (!channelIdMatch) {
      throw new Error('Invalid chat URL format');
    }
    
    const channelId = channelIdMatch[1];
    
    // Fetch channel
    const channel = await discordClient.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error('Channel not found');
    }
    
    // Build message
    let messageContent = '';
    if (discordId) {
      messageContent += `<@${discordId}>\n`;
    }
    messageContent += content;
    
    const messageOptions = {
      content: messageContent
    };
    
    // Add image if exists
    if (imageUrl) {
      messageOptions.files = [imageUrl];
    }
    
    await channel.send(messageOptions);
    
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Bot send error:', error.message);
    throw error;
  }
}

/**
 * Send broadcast to multiple students
 * @param {Object} messageData - Message data
 * @param {Array} targetStudents - Array of target students
 * @param {string} userEmail - Current user email
 * @returns {Object} - Send results
 */
export async function sendBroadcast(messageData, targetStudents, userEmail) {
  const { content, imageId, channelType, name, saveAsTemplate, isTest } = messageData;
  
  let broadcastId = null;
  
  try {
    // Save message to database if template or for logging
    const insertResult = await query(
      `INSERT INTO broadcast_messages 
        (name, content, image_url, channel_type, target_status, target_tutor, created_by, is_template, last_sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING id`,
      [
        name || `Broadcast ${new Date().toISOString()}`,
        content,
        imageId || null,  // Store imageId instead of imageUrl
        channelType,
        'active',
        messageData.targetTutor || null,
        userEmail,
        saveAsTemplate || false
      ]
    );
    
    broadcastId = insertResult.rows[0].id;
    
    // Handle test mode
    if (isTest) {
      console.log('[Broadcast] Test mode: Sending to test webhook');
      
      const testWebhookUrl = 'https://discord.com/api/webhooks/1282616705817903146/M4KSUtmoHYSDqySMBgtgjU0wZywkUkVtfh3KOOA-BNzgXMnwVnEphKwuleMXhFn60MYd';
      const testDiscordId = '766666980086120470';
      
      try {
        await sendViaWebhook(testWebhookUrl, testDiscordId, content, imageId, imageStorage);
        
        // Log test send
        await logBroadcastSend(
          broadcastId, 
          { student_id: 'TEST', name: 'Test User' }, 
          channelType, 
          testWebhookUrl, 
          'sent', 
          null
        );
        
        return {
          success: true,
          broadcastId,
          results: {
            total: 1,
            sent: 1,
            failed: 0,
            errors: []
          }
        };
      } catch (error) {
        console.error('[Broadcast] Test send error:', error);
        
        await logBroadcastSend(
          broadcastId, 
          { student_id: 'TEST', name: 'Test User' }, 
          channelType, 
          testWebhookUrl, 
          'failed', 
          error.message
        );
        
        return {
          success: false,
          broadcastId,
          results: {
            total: 1,
            sent: 0,
            failed: 1,
            errors: [{ studentId: 'TEST', error: error.message }]
          }
        };
      }
    }
    
    // Fetch student broadcast info from Google Sheets
    const studentBroadcastInfo = await fetchStudentBroadcastInfo();
    const broadcastInfoMap = new Map(
      studentBroadcastInfo.map(s => [s.studentId, s])
    );
    
    // Send to each student
    const results = {
      total: targetStudents.length,
      sent: 0,
      failed: 0,
      errors: []
    };
    
    for (const student of targetStudents) {
      const broadcastInfo = broadcastInfoMap.get(student.student_id);
      
      if (!broadcastInfo) {
        console.log(`[Broadcast] No broadcast info for student ${student.student_id}`);
        results.failed++;
        await logBroadcastSend(broadcastId, student, channelType, null, 'failed', 'No broadcast info found');
        continue;
      }
      
      try {
        let webhookUrl = null;
        
        // Determine webhook/chat URL based on channel type
        if (channelType === 'notice') {
          webhookUrl = broadcastInfo.noticeWebhook;
        } else if (channelType === 'tips') {
          webhookUrl = broadcastInfo.tipsWebhook;
        } else if (channelType === 'chat') {
          webhookUrl = broadcastInfo.chatUrl;
        }
        
        if (!webhookUrl) {
          console.log(`[Broadcast] No ${channelType} URL for student ${student.student_id}`);
          results.failed++;
          await logBroadcastSend(broadcastId, student, channelType, null, 'failed', `No ${channelType} URL`);
          continue;
        }
        
        // Send via webhook or bot
        if (channelType === 'chat') {
          await sendViaBot(webhookUrl, broadcastInfo.discordId, content, imageUrl);
        } else {
          await sendViaWebhook(webhookUrl, broadcastInfo.discordId, content, imageUrl);
        }
        
        results.sent++;
        await logBroadcastSend(broadcastId, student, channelType, webhookUrl, 'sent', null);
        
        // Rate limiting: wait 200ms between sends (5 per second)
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`[Broadcast] Error sending to ${student.student_id}:`, error.message);
        results.failed++;
        results.errors.push({
          studentId: student.student_id,
          error: error.message
        });
        await logBroadcastSend(broadcastId, student, channelType, null, 'failed', error.message);
      }
    }
    
    console.log(`[Broadcast] Completed: ${results.sent}/${results.total} sent, ${results.failed} failed`);
    
    return {
      success: true,
      broadcastId,
      results
    };
    
  } catch (error) {
    console.error('[Broadcast] Error in sendBroadcast:', error);
    throw error;
  }
}

/**
 * Log broadcast send to database
 */
async function logBroadcastSend(broadcastId, student, channelType, webhookUrl, status, errorMessage) {
  try {
    await query(
      `INSERT INTO broadcast_logs 
        (broadcast_message_id, student_id, student_name, channel_type, webhook_url, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        broadcastId,
        student.student_id,
        student.name,
        channelType,
        webhookUrl,
        status,
        errorMessage
      ]
    );
  } catch (error) {
    console.error('[Broadcast] Error logging send:', error);
  }
}

/**
 * Get broadcast templates
 */
export async function getTemplates(userEmail, userRole) {
  try {
    let sqlQuery = `
      SELECT id, name, content, image_url, channel_type, target_tutor, created_at, last_sent_at
      FROM broadcast_messages
      WHERE is_template = true
    `;
    
    const params = [];
    
    // Crew can only see their own templates
    if (userRole === 'crew') {
      sqlQuery += ' AND created_by = $1';
      params.push(userEmail);
    }
    
    sqlQuery += ' ORDER BY created_at DESC';
    
    const result = await query(sqlQuery, params);
    
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting templates:', error);
    throw error;
  }
}

/**
 * Save or update template
 */
export async function saveTemplate(templateData, userEmail) {
  try {
    const { id, name, content, imageUrl, channelType, targetTutor } = templateData;
    
    if (id) {
      // Update existing template
      await query(
        `UPDATE broadcast_messages
        SET name = $1, content = $2, image_url = $3, channel_type = $4, target_tutor = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND created_by = $7`,
        [name, content, imageUrl, channelType, targetTutor, id, userEmail]
      );
      
      return { success: true, id };
    } else {
      // Create new template
      const result = await query(
        `INSERT INTO broadcast_messages
          (name, content, image_url, channel_type, target_tutor, created_by, is_template)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id`,
        [name, content, imageUrl, channelType, targetTutor, userEmail]
      );
      
      return { success: true, id: result.rows[0].id };
    }
  } catch (error) {
    console.error('[Broadcast] Error saving template:', error);
    throw error;
  }
}

/**
 * Delete template
 */
export async function deleteTemplate(templateId, userEmail, userRole) {
  try {
    let sqlQuery = 'DELETE FROM broadcast_messages WHERE id = $1 AND is_template = true';
    const params = [templateId];
    
    // Crew can only delete their own templates
    if (userRole === 'crew') {
      sqlQuery += ' AND created_by = $2';
      params.push(userEmail);
    }
    
    await query(sqlQuery, params);
    
    return { success: true };
  } catch (error) {
    console.error('[Broadcast] Error deleting template:', error);
    throw error;
  }
}

/**
 * Get broadcast logs
 */
export async function getBroadcastLogs(broadcastId = null, limit = 100) {
  try {
    let sqlQuery = `
      SELECT 
        bl.id,
        bl.broadcast_message_id,
        bm.name as message_name,
        bl.student_id,
        bl.student_name,
        bl.channel_type,
        bl.status,
        bl.error_message,
        bl.sent_at
      FROM broadcast_logs bl
      LEFT JOIN broadcast_messages bm ON bl.broadcast_message_id = bm.id
    `;
    
    const params = [];
    
    if (broadcastId) {
      sqlQuery += ' WHERE bl.broadcast_message_id = $1';
      params.push(broadcastId);
    }
    
    sqlQuery += ' ORDER BY bl.sent_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    
    const result = await query(sqlQuery, params);
    
    return result.rows;
  } catch (error) {
    console.error('[Broadcast] Error getting logs:', error);
    throw error;
  }
}
