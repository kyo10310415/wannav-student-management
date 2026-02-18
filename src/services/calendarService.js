import { google } from 'googleapis';
import { query } from '../db/connection.js';

let calendar;

/**
 * Initialize Google Calendar API
 */
function getCalendar() {
  if (!calendar) {
    let credentials;
    
    try {
      // Try to parse credentials from environment variable
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // If it's base64 encoded
        if (process.env.GOOGLE_CREDENTIALS_JSON.startsWith('eyJ')) {
          const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8');
          credentials = JSON.parse(decoded);
        } else {
          credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        }
      } else {
        throw new Error('GOOGLE_CREDENTIALS_JSON not found in environment variables');
      }
    } catch (error) {
      console.error('Error parsing Google credentials:', error);
      throw error;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    calendar = google.calendar({ version: 'v3', auth });
  }

  return calendar;
}

/**
 * Get calendar IDs from Notion tutor emails
 * Fetches all tutors from database and uses their email addresses as calendar IDs
 */
async function getCalendarIdsFromTutors() {
  try {
    const result = await query('SELECT email FROM tutors WHERE email IS NOT NULL AND email != \'\'');
    const emails = result.rows.map(row => row.email).filter(Boolean);
    
    if (emails.length === 0) {
      console.warn('No tutor emails found in database. Make sure tutors are synced from Notion.');
      throw new Error('No tutor calendar IDs available. Please sync tutors from Notion first.');
    }
    
    console.log(`Found ${emails.length} tutor calendar(s): ${emails.join(', ')}`);
    return emails;
  } catch (error) {
    console.error('Error fetching tutor emails:', error);
    throw error;
  }
}

/**
 * Get calendar IDs from environment or from tutor emails
 * Priority: GOOGLE_CALENDAR_IDS > GOOGLE_CALENDAR_ID > Tutor emails from database
 */
async function getCalendarIds() {
  // Check for multiple calendar IDs in environment first
  if (process.env.GOOGLE_CALENDAR_IDS) {
    const ids = process.env.GOOGLE_CALENDAR_IDS.split(',').map(id => id.trim());
    console.log(`Using calendar IDs from environment: ${ids.join(', ')}`);
    return ids;
  }
  
  // Fallback to single calendar ID
  if (process.env.GOOGLE_CALENDAR_ID) {
    console.log(`Using single calendar ID from environment: ${process.env.GOOGLE_CALENDAR_ID}`);
    return [process.env.GOOGLE_CALENDAR_ID];
  }
  
  // Use tutor emails from database as calendar IDs
  console.log('No calendar IDs in environment, fetching from tutor emails...');
  return await getCalendarIdsFromTutors();
}

/**
 * Fetch calendar events for a specific month from a single calendar
 * @param {string} calendarId - Calendar ID
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 */
async function fetchEventsFromCalendar(calendarId, year, month) {
  const calendar = getCalendar();
  
  // Calculate time range for the month
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const response = await calendar.events.list({
    calendarId: calendarId,
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500,
  });

  return response.data.items || [];
}

/**
 * Fetch calendar events for a specific month from all configured calendars
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 */
export async function fetchLessonsForMonth(year, month) {
  try {
    const calendarIds = await getCalendarIds();
    console.log(`Fetching lessons from ${calendarIds.length} calendar(s) for ${year}/${month}`);
    
    // Fetch events from all calendars in parallel
    const allEventsArrays = await Promise.all(
      calendarIds.map(async (calendarId) => {
        try {
          const events = await fetchEventsFromCalendar(calendarId, year, month);
          console.log(`Calendar ${calendarId}: fetched ${events.length} events`);
          return events;
        } catch (error) {
          console.error(`Error fetching events from calendar ${calendarId}:`, error.message);
          return []; // Return empty array if calendar fails
        }
      })
    );
    
    // Flatten the arrays and remove duplicates by event ID
    const allEvents = allEventsArrays.flat();
    console.log(`Total events fetched: ${allEvents.length}`);
    
    const uniqueEvents = new Map();
    
    allEvents.forEach(event => {
      if (!uniqueEvents.has(event.id)) {
        uniqueEvents.set(event.id, event);
      }
    });

    console.log(`Unique events: ${uniqueEvents.size}`);

    // Convert to lesson format
    let eventsWithStudentId = 0;
    let eventsWithoutStudentId = 0;
    
    const lessons = Array.from(uniqueEvents.values()).map(event => {
      // Extract student ID from description
      const studentId = extractStudentId(event.description || '');
      
      if (studentId) {
        eventsWithStudentId++;
      } else {
        eventsWithoutStudentId++;
        // Log first 5 events without student ID
        if (eventsWithoutStudentId <= 5) {
          console.log(`Event without student ID: "${event.summary}", description: "${(event.description || '').substring(0, 100)}..."`);
        }
      }
      
      return {
        calendar_event_id: event.id,
        student_id: studentId,
        tutor_name: extractTutorName(event.summary || ''),
        lesson_date: event.start.dateTime || event.start.date,
        title: event.summary,
        description: event.description,
        meet_link: event.hangoutLink || extractMeetLink(event.description || '')
      };
    }).filter(lesson => lesson.student_id); // Only include events with student ID
    
    console.log(`Events with student ID: ${eventsWithStudentId}, without: ${eventsWithoutStudentId}`);
    console.log(`Found ${lessons.length} lessons with student IDs`);
    return lessons;
  } catch (error) {
    console.error('Error fetching lessons from Google Calendar:', error);
    throw error;
  }
}

/**
 * Extract student ID from event description
 * Based on the image, student ID appears in the description field
 */
function extractStudentId(description) {
  // Look for pattern like "学籍番号" or "OLTS240488-AR" format
  const patterns = [
    /学籍番号[：:\s]*([A-Z0-9-]+)/i,
    /OLTS\d{6}-[A-Z]{2}/i,
    /予約者[：:\s]*.*\n.*\n.*学籍番号[：:\s]*([A-Z0-9-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

/**
 * Extract tutor name from event title
 */
function extractTutorName(title) {
  // Extract text after "レッスン予約" if present
  const match = title.match(/WannaVレッスン予約\s*[（(]([^)）]+)[)）]/);
  return match ? match[1] : null;
}

/**
 * Extract Google Meet link from description
 */
function extractMeetLink(description) {
  const match = description.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
  return match ? match[0] : null;
}

/**
 * Get lessons for previous, current, and next month
 */
export async function fetchLessonsForThreeMonths() {
  const now = new Date();
  const results = {};

  // Previous month
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  results.previousMonth = await fetchLessonsForMonth(
    prevMonth.getFullYear(),
    prevMonth.getMonth() + 1
  );

  // Current month
  results.currentMonth = await fetchLessonsForMonth(
    now.getFullYear(),
    now.getMonth() + 1
  );

  // Next month
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  results.nextMonth = await fetchLessonsForMonth(
    nextMonth.getFullYear(),
    nextMonth.getMonth() + 1
  );

  return results;
}

/**
 * Get lessons for tomorrow (for reminder service)
 */
export async function fetchLessonsForTomorrow() {
  try {
    const calendar = getCalendar();
    const calendarIds = await getCalendarIds();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    console.log(`Fetching tomorrow's lessons from ${calendarIds.length} calendar(s)`);

    // Fetch events from all calendars in parallel
    const allEventsArrays = await Promise.all(
      calendarIds.map(async (calendarId) => {
        try {
          const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: tomorrow.toISOString(),
            timeMax: dayAfter.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });
          return response.data.items || [];
        } catch (error) {
          console.error(`Error fetching events from calendar ${calendarId}:`, error.message);
          return []; // Return empty array if calendar fails
        }
      })
    );

    // Flatten the arrays and remove duplicates
    const allEvents = allEventsArrays.flat();
    const uniqueEvents = new Map();
    
    allEvents.forEach(event => {
      if (!uniqueEvents.has(event.id)) {
        uniqueEvents.set(event.id, event);
      }
    });

    const lessons = Array.from(uniqueEvents.values()).map(event => {
      const studentId = extractStudentId(event.description || '');
      
      return {
        calendar_event_id: event.id,
        student_id: studentId,
        tutor_name: extractTutorName(event.summary || ''),
        lesson_date: event.start.dateTime || event.start.date,
        title: event.summary,
        description: event.description,
        meet_link: event.hangoutLink || extractMeetLink(event.description || '')
      };
    }).filter(lesson => lesson.student_id);

    console.log(`Found ${lessons.length} lessons for tomorrow`);
    return lessons;
  } catch (error) {
    console.error('Error fetching tomorrow\'s lessons:', error);
    throw error;
  }
}
