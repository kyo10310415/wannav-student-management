import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchLessonsForTomorrow } from '../services/sheetsService.js';
import { buildLessonReminderBody, parseLessonReminderDate } from '../services/lessonReminderContent.js';

export function reminderTargetDate(now = new Date()) {
  return new Date(now.getTime() + (24 + 9) * 3600000).toISOString().slice(0, 10);
}

export function buildEmailReminderBatch(lessons, students, targetDate) {
  if (lessons.length > 500) throw new Error('BatchLimit');
  const names = new Map(students.map(row => [String(row.student_id).trim().toUpperCase(), row.name]));
  const items = new Map();
  for (const lesson of lessons) {
    const studentId = String(lesson.student_id || '').trim().toUpperCase();
    const parsed = parseLessonReminderDate(lesson);
    if (!studentId || !parsed) continue;
    const {dateKey, timeKey: time} = parsed;
    if (dateKey !== targetDate) continue;
    const id = createHash('sha256').update(`${studentId}|${dateKey}|${time}`).digest('hex');
    if (!items.has(id)) items.set(id, { id, studentId, lessonDate:dateKey,
      subject:'【WannaV】明日のレッスンのご案内', body:buildLessonReminderBody(names.get(studentId) || studentId, lesson) });
  }
  return { targetDate, items:[...items.values()] };
}

export function createEmailReminderRoutes({ db = query, lessons = fetchLessonsForTomorrow,
  enabled = () => process.env.EMAIL_REMINDERS_ENABLED === 'true',
  key = () => process.env.GAS_EMAIL_REMINDER_API_KEY || '', now = () => new Date() } = {}) {
  const app = new Hono();
  app.get('/batch', async c => {
    c.header('Cache-Control','no-store');
    const expected = key();
    if (expected.length < 32) return c.json({success:false,error:'Email integration is not configured'},503);
    const supplied = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(supplied),digest(expected))) return c.json({success:false,error:'Unauthorized'},401);
    if (!enabled()) return c.json({success:false,error:'Email reminders are disabled'},503);
    try {
      const upcoming = await lessons();
      const ids = [...new Set(upcoming.map(l=>String(l.student_id || '').trim().toUpperCase()).filter(Boolean))];
      const students = ids.length ? (await db('SELECT student_id, name FROM students WHERE UPPER(TRIM(student_id)) = ANY($1::text[])',[ids])).rows : [];
      return c.json({success:true,data:buildEmailReminderBatch(upcoming,students,reminderTargetDate(now()))});
    } catch {
      console.error('[EmailReminders] Batch preparation failed');
      return c.json({success:false,error:'Email batch preparation failed'},502);
    }
  });
  return app;
}

export default createEmailReminderRoutes();
