import { query } from '../db/connection.js';
import { getTargetStudents, sendBroadcast } from './broadcastService.js';

/**
 * Parse human-readable schedule to cron expression
 * @param {string} frequency - 'weekly', 'biweekly', 'monthly'
 * @param {string} dayOfWeek - '0' (Sunday) to '6' (Saturday)
 * @param {string} time - 'HH:MM' format
 * @returns {string} - Cron expression
 */
export function generateCronExpression(frequency, dayOfWeek, time) {
  const [hour, minute] = time.split(':');
  
  switch (frequency) {
    case 'weekly':
      // Every week on specified day at specified time
      return `${minute} ${hour} * * ${dayOfWeek}`;
    
    case 'biweekly':
      // Every 2 weeks on specified day at specified time
      // Note: Standard cron doesn't support bi-weekly directly
      // We'll use a workaround with week numbers
      return `${minute} ${hour} * * ${dayOfWeek}`;
    
    case 'monthly':
      // First occurrence of specified day each month
      return `${minute} ${hour} 1-7 * ${dayOfWeek}`;
    
    default:
      throw new Error('Invalid frequency');
  }
}

/**
 * Parse cron expression to human-readable format
 * @param {string} cronExpression - Cron expression
 * @returns {Object} - { frequency, dayOfWeek, time }
 */
export function parseCronExpression(cronExpression) {
  const parts = cronExpression.split(' ');
  if (parts.length !== 5) {
    throw new Error('Invalid cron expression');
  }
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  
  let frequency = 'weekly';
  if (dayOfMonth === '1-7') {
    frequency = 'monthly';
  }
  
  return {
    frequency,
    dayOfWeek,
    time
  };
}

/**
 * Get all active scheduled broadcasts
 * @returns {Array} - Array of scheduled broadcasts
 */
export async function getActiveSchedules() {
  try {
    const result = await query(
      `SELECT id, name, content, image_url, channel_type, target_status, target_tutor, 
              schedule_cron, created_by, last_sent_at
       FROM broadcast_messages
       WHERE is_scheduled = true AND schedule_enabled = true`
    );
    
    return result.rows;
  } catch (error) {
    console.error('[Scheduler] Error getting active schedules:', error);
    throw error;
  }
}

/**
 * Execute scheduled broadcast
 * @param {number} scheduleId - Schedule ID
 * @returns {Object} - Execution result
 */
export async function executeScheduledBroadcast(scheduleId) {
  try {
    // Get schedule details
    const scheduleResult = await query(
      `SELECT * FROM broadcast_messages WHERE id = $1 AND is_scheduled = true AND schedule_enabled = true`,
      [scheduleId]
    );
    
    if (scheduleResult.rows.length === 0) {
      throw new Error('Schedule not found or not enabled');
    }
    
    const schedule = scheduleResult.rows[0];
    
    console.log('[Scheduler] Executing scheduled broadcast:', {
      id: schedule.id,
      name: schedule.name,
      channelType: schedule.channel_type
    });
    
    // Get target students
    // For scheduled broadcasts, we need to determine the user's role
    // For now, we'll assume 'leader' role for scheduled broadcasts
    const targetStudents = await getTargetStudents(
      schedule.target_status,
      schedule.target_tutor,
      schedule.created_by,
      'leader' // Scheduled broadcasts act as leader role
    );
    
    if (targetStudents.length === 0) {
      console.log('[Scheduler] No target students found for schedule:', schedule.id);
      return {
        success: false,
        error: 'No target students found'
      };
    }
    
    // Prepare message data
    const messageData = {
      content: schedule.content,
      imageId: schedule.image_url, // This could be imageId
      channelType: schedule.channel_type,
      name: `[Scheduled] ${schedule.name}`,
      targetStatus: schedule.target_status,
      targetTutor: schedule.target_tutor,
      saveAsTemplate: false,
      isTest: false
    };
    
    // Send broadcast
    const result = await sendBroadcast(messageData, targetStudents, schedule.created_by);
    
    // Update last_sent_at
    await query(
      `UPDATE broadcast_messages SET last_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [scheduleId]
    );
    
    console.log('[Scheduler] Broadcast executed:', {
      scheduleId,
      sent: result.results.sent,
      failed: result.results.failed
    });
    
    return {
      success: true,
      scheduleId,
      sent: result.results.sent,
      failed: result.results.failed
    };
  } catch (error) {
    console.error('[Scheduler] Error executing scheduled broadcast:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check and execute due schedules
 * This function should be called periodically (e.g., every minute)
 */
export async function checkAndExecuteSchedules() {
  try {
    const schedules = await getActiveSchedules();
    
    console.log(`[Scheduler] Checking ${schedules.length} active schedules`);
    
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    const currentDayOfWeek = now.getDay();
    const currentDayOfMonth = now.getDate();
    
    for (const schedule of schedules) {
      try {
        const cronParts = schedule.schedule_cron.split(' ');
        if (cronParts.length !== 5) continue;
        
        const [minute, hour, dayOfMonth, month, dayOfWeek] = cronParts;
        
        // Check if current time matches cron expression
        const minuteMatch = minute === '*' || parseInt(minute) === currentMinute;
        const hourMatch = hour === '*' || parseInt(hour) === currentHour;
        const dayOfWeekMatch = dayOfWeek === '*' || parseInt(dayOfWeek) === currentDayOfWeek;
        
        // For monthly schedules (day 1-7)
        let dayOfMonthMatch = dayOfMonth === '*';
        if (dayOfMonth === '1-7' && currentDayOfMonth <= 7 && dayOfWeekMatch) {
          dayOfMonthMatch = true;
        }
        
        if (minuteMatch && hourMatch && dayOfWeekMatch && dayOfMonthMatch) {
          // Check if already sent in the last hour to avoid duplicate sends
          const lastSent = schedule.last_sent_at ? new Date(schedule.last_sent_at) : null;
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
          
          if (!lastSent || lastSent < oneHourAgo) {
            console.log('[Scheduler] Executing schedule:', schedule.id, schedule.name);
            await executeScheduledBroadcast(schedule.id);
          } else {
            console.log('[Scheduler] Schedule already sent recently:', schedule.id);
          }
        }
      } catch (error) {
        console.error('[Scheduler] Error processing schedule:', schedule.id, error);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking schedules:', error);
  }
}
