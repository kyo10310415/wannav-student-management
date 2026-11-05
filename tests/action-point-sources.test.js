import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createXActivityReader } from '../src/services/xActivityService.js';
import { validateChatEvaluation } from '../src/services/actionPointRules.js';
let sequence = 0;
async function sourceFixture({ env = {}, axiosGet = async () => { throw new Error('No network permitted'); }, ai = {} } = {}) {
  const source = (await readFile(new URL('../src/services/actionPointSources.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const queries = [], pools = [], requests = [];
  class Pool {
    constructor(config) { pools.push(config); }
    on() {}
    async query(sql) { queries.push(sql); return { rows: [{ student_id: 'S1', last_watched_at: null }] }; }
  }
  class OpenAI { constructor() { this.chat = { completions: { create: async input => { requests.push(input); return { choices: [{ message: { content: JSON.stringify(ai) } }] }; } } }; } }
  const key = `actionSourceFixture${sequence++}`;
  const readXActivity = createXActivityReader({ token: () => env.X_BEARER_TOKEN, get: axiosGet, db: async sql => ({ rows: sql.startsWith('INSERT') ? [{}] : [] }) });
  globalThis[key] = { readXActivity, pg: { Pool }, OpenAI, axios: { get: axiosGet }, getDatabaseConfig: () => ({}), validateChatEvaluation, process: { env } };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(`const { readXActivity, pg, OpenAI, axios, getDatabaseConfig, validateChatEvaluation, process } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`);
    return { module, queries, pools, requests };
  } finally { delete globalThis[key]; }
}
test('learning DB is optional, bounded, read-only, and uses the canonical student number rather than a changeable login', async () => {
  const missing = await sourceFixture(); assert.equal(await missing.module.readLearningActivity(), null); assert.equal(missing.pools.length, 0);
  const f = await sourceFixture({ env: { LEARNING_DATABASE_URL: 'synthetic-private-connection' } });
  assert.deepEqual(await f.module.readLearningActivity(), [{ student_id: 'S1', last_watched_at: null }]);
  assert.equal(f.pools[0].max, 1); assert.equal(f.pools[0].options, '-c default_transaction_read_only=on');
  assert.match(f.queries[0], /ns.student_number/); assert.match(f.queries[0], /COUNT\(DISTINCT u.id\) = 1/);
  assert.doesNotMatch(f.queries[0], /password|email|username|UPDATE|DELETE|INSERT/i);
});
test('Discord source bounds the time window and strips bots; incomplete history fails closed', async () => {
  const f = await sourceFixture(); let options;
  const make = (id, time, author, bot = false) => ({ id, createdAt: new Date(time), createdTimestamp: new Date(time).getTime(), author: { id: author, bot }, attachments: new Map(), content: 'text', url: `https://discord.com/channels/1/2/${id}` });
  const batch = new Map([['1', make('1', '2026-11-10', 'student')], ['2', make('2', '2026-11-11', 'bot', true)], ['3', make('3', '2026-10-01', 'student')]]);
  const client = { isReady: () => true, channels: { fetch: async () => ({ messages: { fetch: async input => { options = input; return batch; } } }) } };
  const messages = await f.module.readActionConversation({ chatUrl: 'https://discord.com/channels/1/2', discordId: '123' }, new Date('2026-11-01'), new Date('2026-11-12'), client);
  assert.deepEqual(messages.map(m => m.id), ['1']); assert.equal(options.cache, false);
  await assert.rejects(f.module.readActionConversation({ chatUrl: 'https://example.test', discordId: '123' }, new Date(), new Date(), client));
});
test('AI receives the whole bounded conversation and validated evidence; missing key and oversized input do not call it', async () => {
  const result = { chat_quality: { sufficient: true, incidents: [] }, dependency: { sufficient: false, incidents: [] } };
  const f = await sourceFixture({ env: { OPENAI_API_KEY: 'synthetic-only' }, ai: result });
  const messages = [{ id: '1', authorId: '123', content: 'start' }, { id: '2', authorId: '123', content: 'end' }];
  assert.equal((await f.module.evaluateActionConversation(messages, '123')).chat_quality.point, 0);
  assert.ok(f.requests[0].messages[1].content.includes('end'));
  await assert.rejects(f.module.evaluateActionConversation([{ content: 'x'.repeat(100001) }], '123'));
  assert.equal(f.requests.length, 1);
  const missing = await sourceFixture(); await assert.rejects(missing.module.evaluateActionConversation(messages, '123')); assert.equal(missing.requests.length, 0);
});
test('SNS distinguishes a successful zero from quota/permission failures', async () => {
  const p = { fourteen: new Date('2026-10-29'), thirty: new Date('2026-10-13') };
  const student = { x_account_id: 'student', youtube_channel_id: 'UC' + 'a'.repeat(22) };
  const f = await sourceFixture({ env: { X_BEARER_TOKEN: 'synthetic-only', YOUTUBE_API_KEY: 'synthetic-only' }, axiosGet: async url => {
    if (url.includes('/by/username/')) return { data: { data: { id: '123' } } };
    if (url.includes('/tweets')) return { data: { data: [] } };
    if (url.endsWith('/channels')) return { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] } };
    return { data: { items: [{ contentDetails: { videoPublishedAt: '2026-11-10' } }] } };
  } });
  assert.deepEqual(await f.module.readSocialActivity(student, p, new Date('2026-11-12')), { x: true, xCheckedAt: new Date('2026-11-12'), xLastPostAt: null, youtube: false });
  const failed = await sourceFixture({ env: { X_BEARER_TOKEN: 'synthetic-only', YOUTUBE_API_KEY: 'synthetic-only' } });
  assert.deepEqual(await failed.module.readSocialActivity(student, p, new Date('2026-11-12')), {});
});
test('background evaluation responds before work completes and deduplicates simultaneous starts', async () => {
  const source = await readFile(new URL('../src/services/actionPointService.js', import.meta.url), 'utf8');
  let finish, calls = 0;
  const task = new Promise(resolve => { finish = resolve; });
  const key = `actionJobFixture${sequence++}`;
  globalThis[key] = { service: { updateAll: () => { calls++; return task; } } };
  let module;
  try {
    const body = `let running; let job={running:false,result:null}; const {service}=globalThis[${JSON.stringify(key)}]; const actionMonth=()=> '2026-11';\n${source.slice(source.indexOf('export function updateAllRedLists('))}`;
    module = await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`);
  } finally { delete globalThis[key]; }
  assert.deepEqual(await module.updateAllRedLists(null, { background: true }), { running: true });
  assert.deepEqual(await module.updateAllRedLists(null, { background: true }), { running: true });
  assert.equal(calls, 1); assert.equal(module.getActionPointJobStatus().running, true);
  finish({ updated: 2, errors: 0 }); await task; await new Promise(resolve => setImmediate(resolve));
  assert.equal(module.getActionPointJobStatus().running, false);
  assert.deepEqual(module.getActionPointJobStatus().result, { updated: 2, errors: 0 });
  await assert.rejects(module.updateAllRedLists('2026-10'), /current month/);
});
