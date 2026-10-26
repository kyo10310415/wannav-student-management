import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { GatewayIntentBits, Partials, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { buildLessonReminderBody } from '../src/services/lessonReminderContent.js';

const marker = 'SYNTHETIC_DISCORD_PRIVATE_DATA';
const channelId = '222222222222222222';
const otherChannel = '333333333333333333';
const channelUrl = `https://discord.com/channels/111111111111111111/${channelId}`;
const studentId = marker + '-one';
const lesson = { student_id: studentId, lesson_date: '2026/10/28 12:00', tutor_name: marker,
  meet_link: 'https://meet.google.com/aaa-bbbb-ccc' };
let sequence = 0;
async function fixture({ loginFailure = false, sendFailure = false, failSecond = false, sheetsFailure = false,
  tomorrowFailure = false, webhookFailure = false } = {}) {
  const logs = [], sent = [], posts = [], logins = [], queries = [];
  let ready;
  const row = (id, channel) => { const value = Array(12).fill(''); value[0] = id; value[5] = '444444444444444444'; value[11] = channel; return value; };
  const rows = [row(studentId, channelUrl), row(marker + '-two', channelUrl.replace(channelId, otherChannel))];
  class Client {
    constructor() { this.user = { tag: marker }; this.channels = { fetch: async id => ({ isTextBased: () => true,
      send: async payload => { sent.push({ id, payload }); if (sendFailure || (failSecond && id === otherChannel)) throw new Error(marker); return { id: 'fixture-message-id' }; } }) }; }
    once(name, callback) { ready = callback; }
    async login(token) { logins.push(token); if (loginFailure) throw new Error(marker); ready(); }
  }
  const dependencies = { discord: { Client, GatewayIntentBits, Partials, AttachmentBuilder, EmbedBuilder },
    process: { env: { DISCORD_BOT_TOKEN: marker } }, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    buildLessonReminderBody,
    sheets: { getSheets: () => ({ spreadsheets: { values: { get: async () => { if (sheetsFailure) throw new Error(marker); return { data: { values: rows } }; } } } }) },
    db: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ name: marker }] }; } },
    fetchLessonsForTomorrow: async () => { if (tomorrowFailure) throw new Error(marker); return [lesson, { ...lesson, student_id: marker + '-two' }]; },
    axios: { post: async (url, payload) => { posts.push({ url, payload }); if (webhookFailure) throw Object.assign(new Error(marker), { config: { url, data: payload } }); return { status: 200 }; } },
  };
  let source = await readFile(new URL('../src/services/discordService.js', import.meta.url), 'utf8');
  source = source.replace("import { Client, GatewayIntentBits, Partials } from 'discord.js';", 'const { Client, GatewayIntentBits, Partials } = deps.discord;')
    .replace("import { fetchLessonsForTomorrow } from './sheetsService.js';", 'const fetchLessonsForTomorrow = deps.fetchLessonsForTomorrow;')
    .replace("import { buildLessonReminderBody } from './lessonReminderContent.js';", 'const buildLessonReminderBody = deps.buildLessonReminderBody;')
    .replaceAll("await import('./sheetsService.js')", 'deps.sheets').replaceAll("await import('../db/connection.js')", 'deps.db')
    .replaceAll("(await import('axios')).default", 'deps.axios').replaceAll("await import('discord.js')", 'deps.discord');
  const key = 'discordPrivacyFixture' + sequence++;
  globalThis[key] = dependencies;
  let mod;
  try { mod = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const process = deps.process; const console = deps.console;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { mod, logs, sent, posts, logins, queries };
}
function assertPrivate(f) {
  assert.equal(f.logs.join('\n').includes(marker), false);
  assert.equal(f.logs.join('\n').includes(channelId), false);
  assert.equal(f.logs.join('\n').includes('https://'), false);
}

test('Discord login failures are masked while the not-ready guard remains', async () => {
  const f = await fixture({ loginFailure: true });
  assert.deepEqual(f.logins, [marker]);
  await assert.rejects(f.mod.sendDiscordMessage(channelUrl, marker), /not ready/);
  assert.equal(f.sent.length, 0);
  assertPrivate(f);
});

test('contact lookup and reminder payload remain intact without contact logs', async () => {
  const f = await fixture();
  const info = await f.mod.getStudentDiscordInfo(studentId);
  assert.equal(info.chatUrl, channelUrl);
  assert.equal(await f.mod.sendReminder(studentId, lesson), true);
  assert.equal(f.sent[0].id, channelId);
  assert.equal(f.sent[0].payload, buildLessonReminderBody(marker, lesson, { discord: true, discordId: info.discordId }));
  assert.deepEqual(f.queries[0].params, [studentId]);
  assertPrivate(f);
  const failed = await fixture({ sheetsFailure: true });
  assert.equal((await failed.mod.getStudentDiscordInfo(studentId)).chatUrl, null);
  assertPrivate(failed);
});

test('daily reminders preserve per-student results and mask individual provider errors', async () => {
  const f = await fixture({ failSecond: true });
  const result = await f.mod.sendDailyReminders();
  assert.equal(result.length, 2);
  assert.equal(result[0].success, true);
  assert.equal(result[1].success, false);
  assert.equal(result[1].studentId, marker + '-two');
  assert.equal(result[1].error, 'Discord operation failed');
  assertPrivate(f);
});

test('webhook payloads and recipients survive while failure details are masked', async () => {
  const data = { tutor_name: marker, absence_type: '欠席', reason: marker, schedule_title: marker,
    schedule_date: '2026-10-28', schedule_time: '12:00', matched_keyword: marker, leader_name: marker };
  for (const failing of [false, true]) {
    const f = await fixture({ webhookFailure: failing });
    for (const [name, args] of [['notifyAbsenceRequest', ['https://example.test/private-webhook', null, data]],
      ['notifyAbsenceApproval', ['https://example.test/private-webhook', null, data]],
      ['sendTestWebhook', ['https://example.test/private-webhook', null, marker]]]) {
      const result = await f.mod[name](...args);
      assert.equal(result.success, !failing);
      if (failing) assert.equal(result.error, 'Discord operation failed');
    }
    assert.equal(f.posts.length, 3);
    assert.ok(f.posts.every(post => post.url === 'https://example.test/private-webhook' && post.payload.embeds));
    assertPrivate(f);
  }
});

test('channel messages and stamp notifications preserve successful IDs and mask failures', async () => {
  for (const failing of [false, true]) {
    const f = await fixture({ sendFailure: failing });
    const message = { content: marker, allowedMentions: { parse: [] } };
    const first = await f.mod.sendDiscordMessage(channelUrl, message);
    const stamp = await f.mod.sendStampRallyNotification(channelUrl, marker, 'https://example.test/roulette');
    assert.equal(first.success, !failing);
    assert.equal(stamp.success, !failing);
    assert.equal(f.sent[0].payload, message);
    if (!failing) assert.deepEqual(first, { success: true, id: 'fixture-message-id', channelId });
    else { assert.equal(first.error, 'Discord operation failed'); assert.equal(stamp.error, 'Discord operation failed'); }
    assertPrivate(f);
  }
});

test('VQ content, attachments and image conversion are retained without URL logs', async () => {
  const f = await fixture();
  const image = Buffer.from('fixture-image');
  const result = await f.mod.sendDiscordVQDiagnosis(channelUrl, { content: marker },
    { radarChart: image, trendChart: image, typeImage: 'https://drive.google.com/file/d/fixture-image-id/view' });
  assert.equal(result.success, true);
  assert.equal(f.sent[0].payload.content, marker);
  assert.equal(f.sent[0].payload.files.length, 2);
  assert.equal(f.sent[0].payload.embeds.length, 3);
  assert.equal(f.sent[0].payload.embeds[2].toJSON().image.url, 'https://drive.google.com/uc?export=view&id=fixture-image-id');
  assertPrivate(f);
});

test('daily lookup failures propagate a fixed error without the upstream cause', async () => {
  const f = await fixture({ tomorrowFailure: true });
  await assert.rejects(f.mod.sendDailyReminders(), error => error.message === 'Discord operation failed' && !error.cause);
  assert.equal(f.sent.length, 0);
  assertPrivate(f);
});
