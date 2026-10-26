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
        const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        
        // Check if it's valid JSON (starts with { or [)
        if (credString.startsWith('{') || credString.startsWith('[')) {
          // Direct JSON string
          credentials = JSON.parse(credString);
        } else {
          // Assume it's base64 encoded - decode it
          try {
            const decoded = Buffer.from(credString, 'base64').toString('utf-8');
            credentials = JSON.parse(decoded);
          } catch (decodeError) {
            console.error('Calendar credential decoding failed');
            // Try parsing as-is as fallback
            credentials = JSON.parse(credString);
          }
        }
      } else {
        throw new Error('GOOGLE_CREDENTIALS_JSON not found in environment variables');
      }
    } catch (error) {
      console.error('Calendar credential parsing failed');
      throw new Error('Google Calendar credentials could not be loaded');
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
    
    console.log(`Found ${emails.length} tutor calendar(s)`);
    return emails;
  } catch (error) {
    console.error('Tutor calendar lookup failed');
    throw new Error('Tutor calendars could not be loaded');
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
    console.log(`[Calendar] Using calendar IDs from GOOGLE_CALENDAR_IDS: ${ids.length} calendar(s)`);
    return ids;
  }
  
  // Fallback to single calendar ID
  if (process.env.GOOGLE_CALENDAR_ID) {
    console.log('[Calendar] Using one configured calendar');
    return [process.env.GOOGLE_CALENDAR_ID];
  }
  
  // Use tutor emails from database as calendar IDs
  console.log('[Calendar] No calendar IDs in environment, fetching from tutor emails...');
  const ids = await getCalendarIdsFromTutors();
  console.log(`[Calendar] Fetched ${ids.length} tutor email(s) as calendar IDs`);
  return ids;
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
    console.log(`Fetching monthly lessons from ${calendarIds.length} calendar(s)`);
    
    // Fetch events from all calendars in parallel and track calendar ID
    const allEventsArrays = await Promise.all(
      calendarIds.map(async (calendarId) => {
        try {
          const events = await fetchEventsFromCalendar(calendarId, year, month);
          console.log(`Calendar events fetched: ${events.length}`);
          // Add calendar_id to each event for tracking
          return events.map(event => ({
            ...event,
            source_calendar_id: calendarId
          }));
        } catch (error) {
          console.error('Calendar event fetch failed');
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
      }
      
      return {
        calendar_event_id: event.id,
        student_id: studentId,
        tutor_name: extractTutorName(event.summary || ''),
        tutor_calendar_id: event.source_calendar_id, // Track which calendar this came from
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
    console.error('Monthly calendar lesson fetch failed');
    throw new Error('Monthly calendar lessons could not be loaded');
  }
}

/**
 * Extract student ID from event description
 * Based on the image, student ID appears in the description field
 */
function extractStudentId(description) {
  if (!description) return null;
  
  // Look for pattern like "学籍番号" or "OLTS240488-AR" format
  const patterns = [
    /学籍番号[：:\s]*([A-Z0-9-]+)/i,
    /OLTS\d{6}-[A-Z]{2}/i,
    /予約者[：:\s]*.*\n.*\n.*学籍番号[：:\s]*([A-Z0-9-]+)/i,
    // Additional flexible patterns
    /\bOLTS[A-Z0-9-]+\b/i,  // Any OLTS pattern
    /学生ID[：:\s]*([A-Z0-9-]+)/i,
    /生徒ID[：:\s]*([A-Z0-9-]+)/i,
    /ID[：:\s]*OLTS[A-Z0-9-]+/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      // Return the captured group if exists, otherwise the full match
      const extracted = match[1] || match[0];
      // Clean up any whitespace
      return extracted.trim();
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

    // Use JST timezone for "tomorrow"
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // JST is UTC+9
    const jstNow = new Date(now.getTime() + jstOffset);
    
    const tomorrow = new Date(jstNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    console.log(`[Calendar] Fetching tomorrow's lessons from ${calendarIds.length} calendar(s)`);

    // Fetch events from all calendars in parallel
    const allEventsArrays = await Promise.all(
      calendarIds.map(async (calendarId, index) => {
        try {
          console.log(`[Calendar] Fetching calendar ${index + 1}/${calendarIds.length}`);
          const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: tomorrow.toISOString(),
            timeMax: dayAfter.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });
          const events = response.data.items || [];
          console.log(`[Calendar] Found ${events.length} events in calendar ${index + 1}`);
          return events;
        } catch (error) {
          console.error('[Calendar] Tomorrow event fetch failed');
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

    // Log total events before filtering
    const totalEvents = uniqueEvents.size;
    console.log(`[Calendar] Total unique events found: ${totalEvents}`);
    
    const allLessons = Array.from(uniqueEvents.values()).map(event => {
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
    });
    
    // Filter by student ID
    const lessons = allLessons.filter(lesson => lesson.student_id);

    console.log(`[Calendar] ✅ Found ${lessons.length} lessons for tomorrow (with student ID)`);
    return lessons;
  } catch (error) {
    console.error('Tomorrow calendar lesson fetch failed');
    throw new Error('Tomorrow calendar lessons could not be loaded');
  }
}
