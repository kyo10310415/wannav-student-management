import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_RED_API_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { detail: marker, config: { password: marker } });
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' }, body: JSON.stringify(body) });
const auth = { headers: { Authorization: 'Bearer fixture' } };
let sequence = 0;
async function fixture({ fail = false, rows = [], query, sendFail = false, missingRecord = false } = {}) {
  const logs = [], queries = [], sends = [], updates = [];
  const provider = async value => { if (fail) throw rawError(); return value; };
  const deps = { Hono,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM sessions')) return { rows: [{ id: 7, email: marker, role: 'admin' }] };
      if (fail) throw rawError();
      return query ? query(sql, params) : { rows };
    },
    calculateRedListScore: async () => provider({ total_score: 3 }),
    updateRedList: async (...args) => { updates.push(args); return provider({ total_score: 3 }); },
    updateAllRedLists: async (...args) => { updates.push(args); return provider({ updated: 2, errors: 1 }); },
    getRedList: async () => provider(missingRecord ? null : { student_id: marker }), getAllRedLists: async () => provider([{ student_id: marker }]),
    getStudentDiscordInfo: async () => provider({ chatUrl: marker, discordId: marker }),
    sendDiscordMessage: async (...args) => { sends.push(args); return sendFail ? { success: false, error: marker } : { success: true, id: 'fixture-message' }; },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/redList.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'redRoutesPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { Hono, query, calculateRedListScore, updateRedList, updateAllRedLists, getRedList, getAllRedLists, getStudentDiscordInfo, sendDiscordMessage, console } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries, sends, updates };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all nineteen red-list API error boundaries hide upstream data', async () => {
  const f = await fixture({ fail: true });
  const targets = [['/'], ['/update', json({ yearMonth: '2026-10' })], ['/update/fixture', json({})], ['/history?yearMonth=2026-10'],
    ['/messages', auth], ['/messages', json({ title: marker, content: marker })], ['/messages/42', json({ title: marker, content: marker }, 'PUT')],
    ['/messages/42', { ...auth, method: 'DELETE' }], ['/messages/42/image', auth], ['/senders', auth],
    ['/senders', json({ name: marker, booking_url: marker })], ['/senders/42', json({ name: marker, booking_url: marker }, 'PUT')],
    ['/senders/42', { ...auth, method: 'DELETE' }], ['/discord/send', json({ studentId: marker, yearMonth: '2026-10', messageContent: marker })],
    ['/discord/test-send', json({ messageId: 42 })], ['/discord/logs', auth], ['/fixture/ex-rank', json({ yearMonth: '2026-10', ex_rank: true, ex_reason: marker }, 'PATCH')],
    ['/fixture/status', json({ yearMonth: '2026-10', assigned_to: marker }, 'PATCH')], ['/fixture']];
  for (const [path, options] of targets) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Red list operation failed' });
  }
  safe(f);
});

test('red-list reads, bulk and individual updates retain their successful contracts', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/')).json(), { success: true, data: [{ student_id: marker }], count: 1 });
  assert.equal((await (await f.app.request('/update', json({ yearMonth: '2026-10' }))).json()).data.updated, 2);
  assert.equal((await (await f.app.request('/update/fixture', json({ yearMonth: '2026-10' }))).json()).data.total_score, 3);
  assert.deepEqual(f.updates, [['2026-10'], ['fixture', '2026-10']]);
  assert.equal((await (await f.app.request('/fixture')).json()).data.student_id, marker);
  safe(f);
});

test('message and sender CRUD retain caller identity, content parameters and success payloads', async () => {
  const row = { id: 42, title: marker, content: marker, name: marker };
  const f = await fixture({ rows: [row] });
  for (const [path, options] of [['/messages', auth], ['/messages', json({ title: marker, content: marker })], ['/messages/42', json({ title: marker, content: marker }, 'PUT')],
    ['/senders', auth], ['/senders', json({ name: marker, booking_url: marker })], ['/senders/42', json({ name: marker, booking_url: marker }, 'PUT')]]) {
    assert.equal((await f.app.request(path, options)).status, 200);
  }
  const insert = f.queries.find(({ sql }) => sql.includes('INSERT INTO red_list_messages'));
  assert.equal(insert.params[0], marker);
  assert.equal(insert.params[1], marker);
  assert.equal(insert.params.at(-1), marker);
  for (const path of ['/messages/42', '/senders/42']) assert.equal((await f.app.request(path, { ...auth, method: 'DELETE' })).status, 200);
  safe(f);
});

test('EX and status updates preserve reason clearing, parameter binding and history fallback', async () => {
  let current = 0;
  const f = await fixture({ query: async sql => {
    if (sql.includes('UPDATE red_list\n') || sql.includes('UPDATE red_list\r\n')) return { rows: ++current === 1 ? [{ ex_rank: false }] : [] };
    return { rows: [{ assigned_to: marker }] };
  } });
  const ex = await f.app.request('/fixture/ex-rank', json({ yearMonth: '2026-10', ex_rank: false, ex_reason: marker }, 'PATCH'));
  assert.equal(ex.status, 200);
  assert.deepEqual(f.queries[0].params, [false, null, 'fixture', '2026-10']);
  const status = await f.app.request('/fixture/status', json({ yearMonth: '2026-09', assigned_to: marker }, 'PATCH'));
  assert.equal(status.status, 200);
  assert.ok(f.queries.some(({ sql }) => sql.includes('UPDATE red_list_history')));
  safe(f);
});

test('notification payload and saved assignment remain unchanged; failed send details stay private', async () => {
  for (const sendFail of [false, true]) {
    const f = await fixture({ sendFail });
    const response = await f.app.request('/discord/send', json({ studentId: marker, studentName: marker, yearMonth: '2026-10', messageContent: '〇〇 fixture' }));
    assert.equal(response.status, sendFail ? 500 : 200);
    assert.equal(f.sends[0][0], marker);
    assert.ok(f.sends[0][1].includes(`<@${marker}>`));
    if (sendFail) {
      assert.equal((await response.text()).includes(marker), false);
      assert.equal(f.queries.some(({ sql }) => sql.includes('INSERT INTO red_list_discord_logs')), false);
    } else {
      assert.ok(f.queries.some(({ sql, params }) => sql.includes('INSERT INTO red_list_discord_logs') && params.at(-1) === marker));
      assert.ok(f.queries.some(({ sql }) => sql.includes('SET assigned_to')));
    }
    safe(f);
  }
});

test('protected routes and existing validation/not-found statuses remain intact', async () => {
  const f = await fixture();
  assert.equal((await f.app.request('/messages')).status, 401);
  assert.equal((await f.app.request('/messages', json({}))).status, 400);
  assert.equal((await f.app.request('/senders', json({}))).status, 400);
  assert.equal((await f.app.request('/fixture/ex-rank', json({ yearMonth: '2026-10', ex_rank: 'yes' }, 'PATCH'))).status, 400);
  assert.equal((await f.app.request('/messages/42', json({ title: marker, content: marker }, 'PUT'))).status, 404);
  safe(f);
});
