import axios from 'axios';
import { query, getClient } from '../db/connection.js';
import { client } from './discordService.js';
import { fetchStudentBroadcastInfo } from './sheetsService.js';
import { classifyReplyMessage, buildReplyAlert, fetchReplyRecoveryMessages } from './discordReplyRules.js';

const MANAGEMENT_CHANNEL = '1557730694166351912';
const MANAGEMENT_ROLE = '1294923221107478571';
const monitoringStartedAt = Date.now();
let channels = new Map();
let staffIds = new Set();
let refreshedAt = 0;
let queue = Promise.resolve();
let checking = false;

function enqueue(work) {
  queue = queue.then(work).catch(error => {
    // Do not log webhook URLs or message contents.
    console.error('[DiscordReplyMonitor] Operation failed:', error.code || error.name);
  });
  return queue;
}

async function refreshDirectory() {
  if (Date.now() - refreshedAt < 60 * 60 * 1000) return;
  const [info, students, users] = await Promise.all([
    fetchStudentBroadcastInfo(),
    query('SELECT student_id, name, homeroom_tutor FROM students'),
    query(`SELECT u.discord_user_id, u.discord_webhook_url, t.notion_name, t.tutor_name
      FROM users u LEFT JOIN tutors t ON LOWER(u.email) = LOWER(t.email)
      WHERE COALESCE(u.job_title, '') <> '契約解除'`)
  ]);
  const studentsById = new Map(students.rows.map(row => [row.student_id.trim().toUpperCase(), row]));
  const tutors = new Map();
  const nextStaff = new Set();
  for (const user of users.rows) {
    if (user.discord_user_id) nextStaff.add(String(user.discord_user_id).trim());
    for (const name of [user.notion_name, user.tutor_name]) {
      if (name) tutors.set(name.trim(), user);
    }
  }
  const nextChannels = new Map();
  for (const item of info) {
    const match = String(item.chatUrl || '').match(/discord\.com\/channels\/(\d+)\/(\d+)/);
    const student = studentsById.get(item.studentId.trim().toUpperCase());
    if (!match || !student || !/^\d+$/.test(String(item.discordId || '').trim())) continue;
    nextChannels.set(match[2], {
      ...student, guild_id: match[1], studentDiscordId: String(item.discordId).trim(),
      tutor: tutors.get(String(student.homeroom_tutor || '').trim())
    });
  }
  // First enable starts now, not with all historical unanswered messages.
  const baseline = ((BigInt(monitoringStartedAt) - 1420070400000n) << 22n).toString();
  if (nextChannels.size) {
    await query(`INSERT INTO discord_reply_channels(channel_id, last_message_id)
      SELECT UNNEST($1::text[]), $2 ON CONFLICT DO NOTHING`, [[...nextChannels.keys()], baseline]);
  }
  channels = nextChannels;
  staffIds = nextStaff;
  refreshedAt = Date.now();
}

async function processMessage(message) {
  const student = channels.get(message.channelId);
  if (!student) return;
  const kind = classifyReplyMessage(message, student.studentDiscordId, staffIds);
  if (kind === 'staff') {
    await query(`UPDATE discord_reply_channels SET last_staff_message_id =
      GREATEST(last_staff_message_id::numeric, $2::numeric)::text WHERE channel_id = $1`,
    [message.channelId, message.id]);
    await query(`UPDATE discord_reply_pending SET resolved_at = NOW()
      WHERE channel_id = $1 AND message_id::numeric < $2::numeric AND resolved_at IS NULL`,
    [message.channelId, message.id]);
  } else if (kind === 'student') {
    await query(`INSERT INTO discord_reply_pending
      (message_id, channel_id, guild_id, student_id, posted_at, resolved_at)
      SELECT $1, $2, $3, $4, $5,
        CASE WHEN last_staff_message_id::numeric > $1::numeric OR $6::boolean THEN NOW() ELSE NULL END
      FROM discord_reply_channels WHERE channel_id = $2 AND last_message_id::numeric < $1::numeric
      ON CONFLICT DO NOTHING`,
    [message.id, message.channelId, message.guildId, student.student_id,
      new Date(message.createdTimestamp), message.reactions.cache.some(reaction => reaction.count > 0)]);
  }
  await query(`UPDATE discord_reply_channels SET last_message_id =
    GREATEST(last_message_id::numeric, $2::numeric)::text WHERE channel_id = $1`,
  [message.channelId, message.id]);
}

// Recover missed posts after downtime, newest pages first, then process chronologically.
async function recoverChannel(channelId, cursor) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.messages) throw new Error('ChannelUnavailable');
  const messages = await fetchReplyRecoveryMessages(options => channel.messages.fetch(options), cursor);
  for (const message of messages) await processMessage(message);
}

async function recoverAllChannels() {
  await refreshDirectory();
  const result = await query('SELECT channel_id, last_message_id FROM discord_reply_channels');
  for (const row of result.rows) {
    if (!channels.has(row.channel_id)) continue;
    try { await recoverChannel(row.channel_id, row.last_message_id); }
    catch (error) { console.error('[DiscordReplyMonitor] Recovery failed:', row.channel_id, error.code || error.name); }
  }
}

export function startDiscordReplyMonitor() {
  client.on('messageCreate', message => enqueue(async () => {
    await refreshDirectory();
    await processMessage(message);
  }));
  client.on('messageReactionAdd', reaction => enqueue(async () => {
    await query(`UPDATE discord_reply_pending SET resolved_at = NOW()
      WHERE message_id = $1 AND resolved_at IS NULL`, [reaction.message.id]);
  }));
  client.on('messageDelete', message => enqueue(() => query(
    'UPDATE discord_reply_pending SET resolved_at = NOW() WHERE message_id = $1', [message.id])));
  client.on('shardReady', () => enqueue(recoverAllChannels));
  if (client.isReady()) enqueue(recoverAllChannels);
  console.log('[DiscordReplyMonitor] Enabled: 12 hours, check every 5 minutes');
}

export async function checkDiscordReplyAlerts() {
  if (checking || !client.isReady()) return;
  checking = true;
  let lockClient;
  let locked = false;
  try {
    lockClient = await getClient();
    locked = (await lockClient.query('SELECT pg_try_advisory_lock(1294923221) AS locked')).rows[0].locked;
    if (!locked) return;
    await enqueue(refreshDirectory);
    await queue;
    const result = await query(`SELECT * FROM discord_reply_pending
      WHERE resolved_at IS NULL AND posted_at <= NOW() - INTERVAL '12 hours'
      AND (tutor_notified_at IS NULL OR management_notified_at IS NULL) ORDER BY posted_at LIMIT 100`);
    for (const row of result.rows) {
      const student = channels.get(row.channel_id);
      if (!student) continue;
      try {
        // Verify history/reactions immediately before alerting; failed reads never imply no reply.
        await enqueue(async () => {
          await recoverChannel(row.channel_id, row.message_id);
          const channel = await client.channels.fetch(row.channel_id);
          const message = await channel.messages.fetch({ message: row.message_id, cache: false });
          if (message.reactions.cache.some(reaction => reaction.count > 0)) {
            await query('UPDATE discord_reply_pending SET resolved_at = NOW() WHERE message_id = $1', [row.message_id]);
          }
          const current = (await query('SELECT * FROM discord_reply_pending WHERE message_id = $1', [row.message_id])).rows[0];
          if (!current || current.resolved_at) return;
          const content = buildReplyAlert({ ...row, student_name: student.name, tutor_name: student.homeroom_tutor });
          if (!current.management_notified_at) {
            const destination = await client.channels.fetch(MANAGEMENT_CHANNEL);
            await destination.send({ content: `<@&${MANAGEMENT_ROLE}>\n${content}`,
              allowedMentions: { parse: [], roles: [MANAGEMENT_ROLE] } });
            await query('UPDATE discord_reply_pending SET management_notified_at = NOW() WHERE message_id = $1', [row.message_id]);
          }
          if (!current.tutor_notified_at) {
            const tutor = student.tutor;
            if (!tutor?.discord_webhook_url || !/^\d+$/.test(tutor.discord_user_id || '')) {
              console.warn('[DiscordReplyMonitor] Tutor notification settings missing:', row.student_id);
              return;
            }
            await axios.post(tutor.discord_webhook_url, {
              content: `<@${tutor.discord_user_id}>\n${content}`,
              allowed_mentions: { parse: [], users: [tutor.discord_user_id] }
            }, { timeout: 15000 });
            await query('UPDATE discord_reply_pending SET tutor_notified_at = NOW() WHERE message_id = $1', [row.message_id]);
          }
        });
      } catch (error) { console.error('[DiscordReplyMonitor] Alert failed:', error.code || error.name); }
    }
  } finally {
    try {
      if (locked) await lockClient.query('SELECT pg_advisory_unlock(1294923221)');
    } finally {
      lockClient?.release();
      checking = false;
    }
  }
}
