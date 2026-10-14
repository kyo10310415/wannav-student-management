import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { classifyReplyMessage, buildReplyAlert, fetchReplyRecoveryMessages } from '../src/services/discordReplyRules.js';

function monitor(overrides = {}) {
  const calls = [], handlers = new Map();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    classifyReplyMessage, buildReplyAlert, fetchReplyRecoveryMessages,
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
    getClient: async () => ({ query: async () => ({ rows: [{ locked: true }] }), release() {} }),
    client: { isReady: () => false, on: (event, fn) => handlers.set(event, fn), channels: { fetch: async () => ({ messages: { fetch: async () => new Map() } }) } },
    fetchStudentBroadcastInfo: async () => [],
    axios: { post: async () => { throw new Error('Unexpected external send'); } },
    ...overrides
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../src/services/discordReplyMonitor.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function '), context);
  vm.runInContext("channels.set('channel',{studentDiscordId:'student',student_id:'ST1'});staffIds.add('staff');refreshedAt=Date.now();", context);
  return { context, calls, handlers };
}

const message = (id, author = 'student') => ({ id, channelId: 'channel', guildId: 'guild', author: { id: author }, createdTimestamp: Date.now(), reactions: { cache: { some: () => false } } });

test('student insert uses one explicit text parameter type and numeric conversion only after text', async () => {
  const f = monitor();
  await f.context.processMessage(message('1559033920157384783'));
  const insert = f.calls.find(c => c.sql.includes('INSERT INTO discord_reply_pending'));
  assert.match(insert.sql, /SELECT \$1::text, \$2::text, \$3::text, \$4::text, \$5::timestamptz/);
  assert.equal((insert.sql.match(/\$1::text::numeric/g) || []).length, 2);
  assert.doesNotMatch(insert.sql, /\$1::numeric/);
  assert.equal(insert.params[0], '1559033920157384783');
  assert.ok(f.calls.at(-1).sql.includes('SET last_message_id'));
});

test('DB insert failure retains recovery position and does not advance the cursor', async () => {
  let advanced = false;
  const f = monitor({ query: async sql => {
    if (sql.includes('INSERT INTO discord_reply_pending')) throw Object.assign(new Error('DB failure'), { code: '42P08' });
    if (sql.includes('SET last_message_id')) advanced = true;
    return { rows: [] };
  } });
  await assert.rejects(f.context.processMessage(message('100')), e => e.code === '42P08');
  assert.equal(advanced, false);
  assert.equal(vm.runInContext("failedRecoveries.get('channel')", f.context), '99');
});

test('periodic checks retry at most ten failed channels and rotate an inaccessible channel', async () => {
  const fetched = [];
  const f = monitor({ client: { isReady: () => true, channels: { fetch: async id => {
    fetched.push(id);
    if (id === 'failed-0') throw Object.assign(new Error('Denied'), { code: 50001 });
    return { messages: { fetch: async () => new Map() } };
  } } } });
  vm.runInContext("for(let i=0;i<12;i++){channels.set('failed-'+i,{});failedRecoveries.set('failed-'+i,'50');}", f.context);
  await f.context.checkDiscordReplyAlerts();
  assert.equal(fetched.length, 10);
  assert.equal(vm.runInContext('failedRecoveries.size', f.context), 3);
  await f.context.checkDiscordReplyAlerts();
  assert.ok(fetched.includes('failed-11'));
  assert.equal(vm.runInContext('failedRecoveries.size', f.context), 1);
});

test('new events recover older failed messages before advancing to the new message', async () => {
  const writes = [];
  const f = monitor({
    query: async (sql, params) => { if (sql.includes('INSERT INTO discord_reply_pending')) writes.push(params[0]); return { rows: [] }; },
    client: { isReady: () => false, on: () => {}, channels: { fetch: async () => ({ messages: { fetch: async () => new Map([['100',message('100')],['101',message('101')]]) } }) } }
  });
  // Register handlers separately without starting a live Discord connection.
  f.context.client.on = (event, fn) => f.handlers.set(event, fn);
  f.context.startDiscordReplyMonitor();
  vm.runInContext("failedRecoveries.set('channel','99');", f.context);
  await f.handlers.get('messageCreate')(message('101'));
  assert.equal(writes[0], '100');
  assert.equal(vm.runInContext('failedRecoveries.size', f.context), 0);
});
