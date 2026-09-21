import { randomUUID } from 'node:crypto';
import { query } from '../db/connection.js';
import { client as discordClient } from './discordService.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { isFunnelEligibleStudent, normalizeFunnelStudentId } from './funnelService.js';

const runningJobs = new Set();
const DISCORD_EPOCH = 1420070400000n;

function monthBounds(year, month) {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return {
    yearMonth: `${year}-${String(month).padStart(2, '0')}`,
    startDate,
    nextMonthStart,
    startAt: new Date(`${startDate}T00:00:00+09:00`),
    endAt: new Date(`${nextMonthStart}T00:00:00+09:00`)
  };
}

function extractChannelId(channelUrl) {
  return String(channelUrl || '').match(/^https:\/\/(?:www\.)?discord\.com\/channels\/\d+\/(\d+)(?:\/.*)?$/)?.[1] || null;
}

function normalizeBookingUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function messageContainsBookingUrl(content, bookingUrl) {
  const expected = normalizeBookingUrl(bookingUrl);
  if (!expected) return false;
  return String(content || '').toLowerCase().includes(expected);
}

export function resolveTutorBookingLink(student) {
  const isPro = /pro/i.test(String(student?.contract_plan || ''));
  const lessonType = isPro ? 'PROプランレッスン' : '通常レッスン';
  const tutorName = String(student?.booking_tutor_name || student?.homeroom_tutor || '').trim();

  if (!String(student?.homeroom_tutor || '').trim()) {
    return { url: '', error: '担当Tutorが未設定です' };
  }
  if (!student?.booking_user_id) {
    return { url: '', error: `担当Tutor（${tutorName}）がユーザー管理に登録されていません` };
  }

  const url = String(
    isPro ? student.funnel_pro_booking_url : student.funnel_regular_booking_url
  ).trim();
  return {
    url,
    error: url ? null : `担当Tutor（${tutorName}）の${lessonType}予約URLが未設定です`
  };
}

export function classifyFunnelDiscordMessages({
  messages,
  studentDiscordId,
  bookingUrl,
  bookingStartAt,
  bookingEndAt,
  noShowEvents = [],
  now = new Date()
}) {
  const sortedMessages = [...(messages || [])]
    .filter(message => message?.createdAt instanceof Date)
    .sort((a, b) => a.createdAt - b.createdAt);
  const studentId = String(studentDiscordId || '');

  const bookingMessage = sortedMessages.find(message =>
    message.createdAt >= bookingStartAt &&
    message.createdAt < bookingEndAt &&
    String(message.author?.id || '') !== studentId &&
    messageContainsBookingUrl(message.content, bookingUrl)
  );

  const noShows = noShowEvents.map(event => {
    const eventAt = new Date(event.event_at);
    const deadline = new Date(eventAt.getTime() + (7 * 24 * 60 * 60 * 1000));
    const inWindow = sortedMessages.filter(message =>
      message.createdAt > eventAt && message.createdAt <= deadline && String(message.content || '').trim()
    );
    const studentMessage = inWindow.find(message =>
      !message.author?.bot && String(message.author?.id || '') === studentId
    );
    const tutorMessage = inWindow.find(message =>
      !message.author?.bot && String(message.author?.id || '') !== studentId
    );
    return {
      ...event,
      followupComplete: now >= deadline,
      studentContacted: Boolean(studentMessage),
      studentMessageId: studentMessage?.id || null,
      studentMessageAt: studentMessage?.createdAt || null,
      tutorReminderSent: Boolean(tutorMessage),
      tutorMessageId: tutorMessage?.id || null,
      tutorMessageAt: tutorMessage?.createdAt || null
    };
  });

  return {
    bookingLinkSent: Boolean(bookingMessage),
    bookingMessageId: bookingMessage?.id || null,
    bookingMessageAt: bookingMessage?.createdAt || null,
    noShows
  };
}

async function fetchChannelMessages(channelUrl, startAt, endAt) {
  if (!discordClient.isReady()) throw new Error('Discord Botが接続されていません');
  const channelId = extractChannelId(channelUrl);
  if (!channelId) throw new Error('DiscordチャンネルURLが不正です');
  const channel = await discordClient.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.messages) {
    throw new Error('Discordチャンネルの履歴を取得できません');
  }

  const messages = [];
  const endTimestamp = BigInt(Math.max(endAt.getTime(), Number(DISCORD_EPOCH)));
  let before = ((endTimestamp - DISCORD_EPOCH) << 22n).toString();
  for (let page = 0; page < 100; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    const pageMessages = [...batch.values()];
    for (const message of pageMessages) {
      if (message.createdAt >= startAt && message.createdAt < endAt) messages.push(message);
    }
    const oldest = pageMessages.reduce((current, message) =>
      !current || message.createdAt < current.createdAt ? message : current, null
    );
    if (!oldest || oldest.createdAt < startAt || batch.size < 100) break;
    before = oldest.id;
  }
  return messages;
}

async function upsertBookingCheck(jobId, yearMonth, studentId, result, errorMessage = null) {
  await query(
    `INSERT INTO funnel_booking_link_checks
       (year_month, student_id, scan_job_id, link_sent, message_id, sent_at, scan_status, error_message, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (scan_job_id, student_id) DO UPDATE SET
       link_sent = EXCLUDED.link_sent,
       message_id = EXCLUDED.message_id,
       sent_at = EXCLUDED.sent_at,
       scan_status = EXCLUDED.scan_status,
       error_message = EXCLUDED.error_message,
       scanned_at = NOW()`,
    [
      yearMonth,
      studentId,
      jobId,
      result?.bookingLinkSent || false,
      result?.bookingMessageId || null,
      result?.bookingMessageAt || null,
      errorMessage ? 'error' : 'success',
      errorMessage
    ]
  );
}

async function upsertNoShowCheck(jobId, yearMonth, event, result, errorMessage = null) {
  await query(
    `INSERT INTO funnel_no_show_followups
       (lesson_report_id, year_month, student_id, scan_job_id, lesson_date, followup_complete,
        student_contacted, student_message_id, student_message_at,
        tutor_reminder_sent, tutor_message_id, tutor_message_at,
        scan_status, error_message, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
     ON CONFLICT (scan_job_id, lesson_report_id) DO UPDATE SET
       year_month = EXCLUDED.year_month,
       followup_complete = EXCLUDED.followup_complete,
       student_contacted = EXCLUDED.student_contacted,
       student_message_id = EXCLUDED.student_message_id,
       student_message_at = EXCLUDED.student_message_at,
       tutor_reminder_sent = EXCLUDED.tutor_reminder_sent,
       tutor_message_id = EXCLUDED.tutor_message_id,
       tutor_message_at = EXCLUDED.tutor_message_at,
       scan_status = EXCLUDED.scan_status,
       error_message = EXCLUDED.error_message,
       scanned_at = NOW()`,
    [
      event.id,
      yearMonth,
      event.student_id,
      jobId,
      event.lesson_date,
      result?.followupComplete || false,
      result?.studentContacted || false,
      result?.studentMessageId || null,
      result?.studentMessageAt || null,
      result?.tutorReminderSent || false,
      result?.tutorMessageId || null,
      result?.tutorMessageAt || null,
      errorMessage ? 'error' : 'success',
      errorMessage
    ]
  );
}

async function runFunnelDiscordScan(jobId, year, month) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  const bounds = monthBounds(year, month);
  try {
    await query(
      `UPDATE funnel_discord_scan_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );

    const [studentsResult, reservationsResult, noShowsResult, discordInfo] = await Promise.all([
      query(`
        SELECT
          s.student_id,
          s.status,
          s.contract_plan,
          s.lesson_start_date,
          s.homeroom_tutor,
          t.tutor_name AS booking_tutor_name,
          u.id AS booking_user_id,
          u.funnel_regular_booking_url,
          u.funnel_pro_booking_url
        FROM students s
        LEFT JOIN LATERAL (
          SELECT tutor_name, email
          FROM tutors
          WHERE notion_name = s.homeroom_tutor
          ORDER BY id
          LIMIT 1
        ) t ON TRUE
        LEFT JOIN users u ON LOWER(u.email) = LOWER(t.email)
      `),
      query(
        `SELECT student_id, COUNT(*)::int AS reservation_count
           FROM lessons
          WHERE lesson_date >= $1::date AND lesson_date < $2::date
          GROUP BY student_id`,
        [bounds.startDate, bounds.nextMonthStart]
      ),
      query(
        `SELECT lr.id, lr.student_id, lr.lesson_date::text AS lesson_date,
                COALESCE(
                  (SELECT MIN(l.lesson_date) AT TIME ZONE 'Asia/Tokyo'
                     FROM lessons l
                    WHERE l.student_id = lr.student_id
                      AND l.lesson_date::date = lr.lesson_date),
                  (lr.lesson_date::timestamp + INTERVAL '23 hours 59 minutes') AT TIME ZONE 'Asia/Tokyo'
                ) AS event_at
           FROM lesson_reports lr
          WHERE lr.lesson_date >= $1::date AND lr.lesson_date < $2::date
            AND lr.lesson_result = '無断キャンセル'`,
        [bounds.startDate, bounds.nextMonthStart]
      ),
      fetchStudentBroadcastInfo()
    ]);

    const reservationCounts = new Map(reservationsResult.rows.map(row => [
      normalizeFunnelStudentId(row.student_id), Number(row.reservation_count) || 0
    ]));
    const eligibleStudents = studentsResult.rows.filter(student => isFunnelEligibleStudent(student, year, month));
    const eligibleStudentIds = new Set(
      eligibleStudents.map(student => normalizeFunnelStudentId(student.student_id))
    );
    const unreservedStudents = eligibleStudents.filter(student =>
      (reservationCounts.get(normalizeFunnelStudentId(student.student_id)) || 0) === 0
    );
    const noShowsByStudent = new Map();
    for (const event of noShowsResult.rows) {
      const studentId = normalizeFunnelStudentId(event.student_id);
      if (!eligibleStudentIds.has(studentId)) continue;
      const events = noShowsByStudent.get(studentId) || [];
      events.push(event);
      noShowsByStudent.set(studentId, events);
    }
    const unreservedByStudent = new Map(unreservedStudents.map(student => [
      normalizeFunnelStudentId(student.student_id), student
    ]));
    const candidateIds = new Set([...unreservedByStudent.keys(), ...noShowsByStudent.keys()]);
    const discordInfoMap = new Map(discordInfo.map(info => [normalizeFunnelStudentId(info.studentId), info]));

    await query(
      `UPDATE funnel_discord_scan_jobs SET total_count = $2 WHERE id = $1`,
      [jobId, candidateIds.size]
    );

    let processedCount = 0;
    let errorCount = 0;
    for (const studentId of candidateIds) {
      const unreservedStudent = unreservedByStudent.get(studentId);
      const noShowEvents = noShowsByStudent.get(studentId) || [];
      const info = discordInfoMap.get(studentId);
      const bookingLink = unreservedStudent ? resolveTutorBookingLink(unreservedStudent) : null;
      const bookingUrl = bookingLink?.url || null;
      const latestNoShowDeadline = noShowEvents.reduce((latest, event) => {
        const deadline = new Date(new Date(event.event_at).getTime() + (7 * 24 * 60 * 60 * 1000));
        return deadline > latest ? deadline : latest;
      }, bounds.endAt);

      try {
        if (!info?.chatUrl) throw new Error('DiscordチャンネルURLが未設定です');
        if (!info?.discordId) throw new Error('生徒のDiscordユーザーIDが未設定です');
        const messages = await fetchChannelMessages(info.chatUrl, bounds.startAt, latestNoShowDeadline);
        const result = classifyFunnelDiscordMessages({
          messages,
          studentDiscordId: info.discordId,
          bookingUrl,
          bookingStartAt: bounds.startAt,
          bookingEndAt: bounds.endAt,
          noShowEvents
        });
        if (unreservedStudent) {
          const bookingError = bookingLink.error;
          await upsertBookingCheck(
            jobId,
            bounds.yearMonth,
            unreservedStudent.student_id,
            bookingError ? null : result,
            bookingError
          );
          if (bookingError) errorCount++;
        }
        for (const eventResult of result.noShows) {
          await upsertNoShowCheck(jobId, bounds.yearMonth, eventResult, eventResult);
        }
      } catch (error) {
        errorCount++;
        const errorMessage = error.message || 'Discord履歴の取得に失敗しました';
        if (unreservedStudent) await upsertBookingCheck(jobId, bounds.yearMonth, unreservedStudent.student_id, null, errorMessage);
        for (const event of noShowEvents) await upsertNoShowCheck(jobId, bounds.yearMonth, event, null, errorMessage);
        console.error(`[Funnel Discord] ${studentId}:`, errorMessage);
      }
      processedCount++;
      await query(
        `UPDATE funnel_discord_scan_jobs
            SET processed_count = $2, error_count = $3
          WHERE id = $1`,
        [jobId, processedCount, errorCount]
      );
    }

    await query(
      `UPDATE funnel_discord_scan_jobs
          SET status = 'completed', processed_count = total_count,
              error_count = $2, completed_at = NOW()
        WHERE id = $1`,
      [jobId, errorCount]
    );
  } catch (error) {
    await query(
      `UPDATE funnel_discord_scan_jobs
          SET status = 'failed', error_message = $2, completed_at = NOW()
        WHERE id = $1`,
      [jobId, error.message]
    ).catch(() => {});
    console.error('[Funnel Discord] Scan failed:', error);
  } finally {
    runningJobs.delete(jobId);
  }
}

export async function startFunnelDiscordScan({ year, month, createdBy }) {
  const bounds = monthBounds(year, month);
  await query(
    `UPDATE funnel_discord_scan_jobs
        SET status = 'failed', error_message = '処理が中断されました。再実行してください', completed_at = NOW()
      WHERE year_month = $1
        AND status IN ('pending', 'running')
        AND created_at < NOW() - INTERVAL '30 minutes'`,
    [bounds.yearMonth]
  );
  const active = await query(
    `SELECT * FROM funnel_discord_scan_jobs
      WHERE year_month = $1 AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [bounds.yearMonth]
  );
  if (active.rows[0]) return active.rows[0];

  const jobId = `funnel_${bounds.yearMonth}_${randomUUID()}`;
  const result = await query(
    `INSERT INTO funnel_discord_scan_jobs (id, year_month, created_by)
     VALUES ($1, $2, $3) RETURNING *`,
    [jobId, bounds.yearMonth, createdBy || 'unknown']
  );
  setImmediate(() => runFunnelDiscordScan(jobId, year, month));
  return result.rows[0];
}

export async function getFunnelDiscordScanJob(jobId) {
  const result = await query(`SELECT * FROM funnel_discord_scan_jobs WHERE id = $1`, [jobId]);
  return result.rows[0] || null;
}
