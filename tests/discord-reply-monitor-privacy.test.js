import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import vm from 'node:vm';
const marker = 'SYNTHETIC_REPLY_MONITOR_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { code: marker, name: marker, config: { credentials: marker } });
async function fixture(overrides = {}) {
  const logs = [], queries = [], handlers = new Map(), locks = [], posts = [], management = [];
  let released = 0;
  const row = { message_id: '100', channel_id: marker, student_id: marker, guild_id: marker, posted_at: new Date(0) };
  const context = { process: { env: {} },
    query: async (sql, params) => { queries.push({ sql, params });
      if (sql.includes('AS notification_user_id')) return { rows: [{ notification_user_id: 1, homeroom_tutor: marker, discord_reply_alerts_enabled: true, discord_user_id: '300', discord_webhook_url: marker }] };
      if (sql.includes('SELECT * FROM discord_reply_pending')) return { rows: [row] };
      return { rows: [] };
    }, getClient: async () => ({ query: async sql => { locks.push(sql); return { rows: [{ locked: true }] }; }, release: () => released++ }),
    client: { isReady: () => true, on: (name, fn) => handlers.set(name, fn), channels: { fetch: async id => id === marker
      ? { messages: { fetch: async () => ({ reactions: { cache: { some: () => false } } }) } }
      : { send: async payload => { management.push(payload); } } } },
    fetchStudentBroadcastInfo: async () => { throw new Error('Forbidden fixture Sheets fetch'); },
    axios: { post: async (...args) => { posts.push(args); } },
    classifyReplyMessage: () => 'other', buildReplyAlert: value => 'SYNTHETIC_ALERT ' + value.student_name,
    fetchReplyRecoveryMessages: async () => [], replyChatbotIds: () => [], isReplyChatbotQuestion: async () => false,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])), ...overrides };
  const originalQuery = context.query;
  context.query = async (...args) => { if (overrides.query) queries.push({ sql: args[0], params: args[1] }); return originalQuery(...args); };
  const source = (await readFile(new URL('../src/services/discordReplyMonitor.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ');
  vm.createContext(context); vm.runInContext(source, context);
  vm.runInContext(`channels.set(${JSON.stringify(marker)}, {student_id:${JSON.stringify(marker)}, studentDiscordId:'200', name:${JSON.stringify(marker)}}); refreshedAt=Date.now();`, context);
  return { context, logs, queries, handlers, locks, posts, management, row, released: () => released,
    remember: () => vm.runInContext(`rememberRecoveryFailure(${JSON.stringify(marker)}, '99');`, context),
    recoveryCount: () => vm.runInContext('failedRecoveries.size', context) };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('queued and per-channel recovery errors conceal arbitrary code, name and channel identifiers', async () => {
  const f = await fixture({ query: async sql => ({ rows: sql.includes('SELECT channel_id') ? [{ channel_id: marker, last_message_id: '99' }] : [] }),
    client: { isReady: () => true, channels: { fetch: async () => { throw rawError(); } } } });
  await f.context.enqueue(async () => { throw rawError(); });
  await f.context.recoverAllChannels(); assert.equal(f.recoveryCount(), 1);
  await f.context.checkDiscordReplyAlerts(); assert.equal(f.recoveryCount(), 1);
  assert.equal(f.released(), 1); assert.equal(f.locks.length, 2); safe(f);
});

test('successful retries remove the saved recovery cursor without logging the channel', async () => {
  const f = await fixture({ query: async () => ({ rows: [] }) }); f.remember();
  await f.context.checkDiscordReplyAlerts(); assert.equal(f.recoveryCount(), 0);
  assert.equal(f.logs.some(log => log.includes('Recovery succeeded')), true); safe(f);
});

test('missing tutor webhook preserves skip behavior and never logs the student identifier', async () => {
  const row = { message_id: '100', channel_id: marker, student_id: marker, management_notified_at: new Date(0) };
  const f = await fixture({ query: async sql => ({ rows: sql.includes('AS notification_user_id')
    ? [{ notification_user_id: 1, homeroom_tutor: marker, discord_reply_alerts_enabled: true, discord_user_id: '300', discord_webhook_url: null }]
    : sql.includes('SELECT * FROM discord_reply_pending') ? [row] : [] }) });
  await f.context.checkDiscordReplyAlerts();
  assert.equal(f.posts.length, 0); assert.equal(f.management.length, 0);
  assert.equal(f.logs.some(log => log.includes('Tutor notification settings missing')), true); safe(f);
});

test('normal twelve-hour alerts preserve management and Tutor payloads, status writes and lock release', async () => {
  const f = await fixture(); await f.context.checkDiscordReplyAlerts();
  const selection = f.queries.find(q => q.sql.includes("INTERVAL '12 hours'")); assert.ok(selection); assert.match(selection.sql, /LIMIT 100/);
  assert.equal(f.management.length, 1); assert.equal(f.management[0].allowedMentions.parse.length, 0); assert.equal(f.management[0].allowedMentions.roles.length, 1);
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0][0], marker); assert.equal(f.posts[0][1].content, `<@300>\nSYNTHETIC_ALERT ${marker}`);
  assert.equal(f.posts[0][2].timeout, 15000); assert.deepEqual(Array.from(f.posts[0][1].allowed_mentions.users), ['300']);
  assert.equal(f.queries.some(q => q.sql.includes('SET management_notified_at')), true);
  assert.equal(f.queries.some(q => q.sql.includes('SET tutor_notified_at')), true);
  assert.equal(f.released(), 1); assert.equal(f.locks.length, 2); safe(f);
});

test('notification failures stay private and still unlock the worker without marking Tutor delivered', async () => {
  const f = await fixture({ axios: { post: async () => { throw rawError(); } } });
  await f.context.checkDiscordReplyAlerts();
  assert.equal(f.queries.some(q => q.sql.includes('SET management_notified_at')), true);
  assert.equal(f.queries.some(q => q.sql.includes('SET tutor_notified_at')), false);
  assert.equal(f.released(), 1); safe(f);
});

test('event registration and sequential reaction/delete handlers preserve resolution SQL without timers', async () => {
  const handlers = new Map();
  const f = await fixture({ client: { isReady: () => false, on: (name, fn) => handlers.set(name, fn) } });
  f.context.startDiscordReplyMonitor();
  assert.deepEqual([...handlers.keys()], ['messageCreate', 'messageReactionAdd', 'messageDelete', 'shardReady']);
  await handlers.get('messageReactionAdd')({ message: { id: '100' } });
  await handlers.get('messageDelete')({ id: '101' });
  assert.deepEqual(f.queries.map(q => Array.from(q.params)), [['100'], ['101']]);
  assert.equal(f.locks.length, 0); safe(f);
});
