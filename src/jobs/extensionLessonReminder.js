import axios from 'axios';
import { query } from '../db/connection.js';
import { fetchMonthlyExtensionTargets } from '../services/extensionTargetsService.js';

export const REMINDER_SCHEMA = `CREATE TABLE IF NOT EXISTS extension_lesson_reminders (
  student_id TEXT NOT NULL, lesson_date DATE NOT NULL, target_kind TEXT NOT NULL,
  round INTEGER NOT NULL, tutor_user_id INTEGER NOT NULL, status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(student_id, lesson_date, target_kind, round))`;

export function reminderPayload(s, kind, round) {
  let notion = '未設定';
  try {
    const url = new URL(s.notion_url);
    if (url.protocol === 'https:' && ['notion.so', 'www.notion.so', 'app.notion.com', 'www.notion.com'].includes(url.hostname)
      && !url.username && !url.password && url.href.length <= 1024) notion = url.href;
  } catch { /* Missing URLs do not suppress reminders. */ }
  if (notion === '未設定' && /^[a-f0-9-]{32,36}$/i.test(s.notion_page_id || '')) notion = `https://www.notion.so/${s.notion_page_id.replaceAll('-', '')}`;
  const label = kind === 'examination' ? '延長審査' : 'ヒアリング';
  return { content: `<@${s.discord_user_id}> 本日のレッスン対象者をご確認ください。`,
    allowed_mentions: { parse: [], users: [s.discord_user_id] },
    embeds: [{ title: `今月の${label}対象（${round}回目）`, fields: [
      { name: '生徒名', value: String(s.name || '未登録').slice(0, 255) },
      { name: '学籍番号', value: s.student_id }, { name: 'Notionリンク', value: notion },
      { name: '対象', value: label, inline: true }, { name: '回数', value: `${round}回目`, inline: true },
    ] }] };
}

export function createExtensionLessonReminder({ db = query, targets = fetchMonthlyExtensionTargets,
  post = (...args) => axios.post(...args), now = () => new Date() } = {}) {
  let schema, running = false;
  return async function run() {
    if (running) return;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now()).map(p => [p.type, p.value]));
    if (Number(p.hour) < 10) return;
    const date = `${p.year}-${p.month}-${p.day}`;
    running = true;
    try {
      if (!schema) schema = Promise.resolve().then(() => db(REMINDER_SCHEMA)).catch(() => { schema = null; throw new Error('Reminder schema unavailable'); });
      await schema;
      const rows = (await db(`SELECT DISTINCT s.student_id,s.name,s.notion_url,s.notion_page_id,
        u.id AS tutor_user_id,u.discord_user_id,u.discord_webhook_url
        FROM students s JOIN lessons l ON l.student_id=s.student_id
        JOIN tutors t ON NULLIF(TRIM(s.homeroom_tutor),'') IS NOT NULL
          AND (TRIM(t.notion_name)=TRIM(s.homeroom_tutor) OR TRIM(t.tutor_name)=TRIM(s.homeroom_tutor))
        JOIN users u ON LOWER(u.email)=LOWER(t.email)
        WHERE l.lesson_date::date=$1::date AND COALESCE(u.job_title,'') <> '契約解除'`, [date])).rows;
      if (!rows.length) return;
      const response = await targets();
      if (response.month !== date.slice(0, 7)) throw new Error('Target month mismatch');
      const targetsById = new Map(response.data.map(r => [r.studentId, r]));
      const assignments = new Map();
      for (const row of rows) assignments.set(row.student_id, [...(assignments.get(row.student_id) || []), row]);
      for (const matches of assignments.values()) {
        // Ambiguous assignments must never route a message to the wrong Tutor.
        if (matches.length !== 1) continue;
        const s = matches[0], target = targetsById.get(s.student_id);
        if (!target || !/^\d{17,20}$/.test(s.discord_user_id || '')) continue;
        try {
          const url = new URL(s.discord_webhook_url);
          if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname)
            || url.username || url.password || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) continue;
        } catch { continue; }
        for (const kind of ['examination', 'hearing']) for (const round of new Set(target[kind] || [])) {
          if (!Number.isInteger(round) || round < 1 || round > 10) continue;
          const key = [s.student_id, date, kind, round];
          const claim = await db(`INSERT INTO extension_lesson_reminders
            (student_id,lesson_date,target_kind,round,tutor_user_id,status) VALUES ($1,$2::date,$3,$4,$5,'sending')
            ON CONFLICT (student_id,lesson_date,target_kind,round) DO UPDATE SET
              status='sending',tutor_user_id=EXCLUDED.tutor_user_id,updated_at=NOW()
            WHERE extension_lesson_reminders.status='failed' RETURNING student_id`, [...key, s.tutor_user_id]);
          if (!claim.rows.length) continue;
          let accepted = false;
          try {
            await post(s.discord_webhook_url, reminderPayload(s, kind, round), { timeout: 15000, maxRedirects: 0 });
            accepted = true;
            await db(`UPDATE extension_lesson_reminders SET status='sent',updated_at=NOW()
              WHERE student_id=$1 AND lesson_date=$2::date AND target_kind=$3 AND round=$4`, key);
          } catch (error) {
            // Ambiguous delivery (timeout/crash/post-send DB failure) is not retried automatically.
            const status = !accepted && Number(error.response?.status) >= 400 ? 'failed' : 'unknown';
            await db(`UPDATE extension_lesson_reminders SET status=$5::text,updated_at=NOW()
              WHERE student_id=$1 AND lesson_date=$2::date AND target_kind=$3 AND round=$4`, [...key, status]);
            console.warn('[ExtensionLessonReminder] Delivery not confirmed');
          }
        }
      }
    } catch { console.error('[ExtensionLessonReminder] Job failed'); }
    finally { running = false; }
  };
}

export const sendExtensionLessonReminders = createExtensionLessonReminder();
