import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_DAILY_REPORT_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, headers: { Authorization: marker } }, detail: marker });
let sequence = 0;
async function fixture(query, post = async () => ({})) {
  const logs = [], queries = [], notifications = [];
  const deps = { Hono, query: async (...args) => { queries.push(args); return query(...args); },
    axios: { post: async (...args) => { notifications.push(args); return post(...args); } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/dailyReports.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'dailyReportPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const { Hono, query, axios, console } = globalThis[${JSON.stringify(key)}];\n`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(prefix + source + '\nexport { sendCommentDiscordNotification };').toString('base64')}`);
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('authenticatedUser', { id: 7 }); await next(); });
    app.route('/', module.default);
    return { app, notify: module.sendCommentDiscordNotification, logs, queries, notifications };
  } finally { delete globalThis[key]; }
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('daily report pagination rejects invalid or excessive values before all queries',async()=>{
  const f=await fixture(async()=>{throw Error('Unexpected query')});
  for(const query of ['limit=','limit=0','limit=-1','limit=1001','limit=1.5','limit=20junk','limit=1e2','offset=','offset=-1','offset=1.2','offset=1x','offset=9007199254740992']){
    assert.equal((await f.app.request('/tutor/7?'+query)).status,400,query);
  }
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);
  const g=await fixture(async sql=>({rows:sql.includes('COUNT(*)')?[{total:'0'}]:[]}));
  for(const [query,limit,offset] of [['',20,0],['?limit=1000&offset=0',1000,0],['?limit=5&offset=10',5,10]]){
    const r=await g.app.request('/tutor/7'+query);assert.equal(r.status,200);const body=await r.json();assert.equal(body.limit,limit);assert.equal(body.offset,offset);assert.deepEqual(g.queries.at(-2)[1],['7',limit,offset]);
  }
});

test('daily writes reject malformed JSON, non-object bodies and non-string content without SQL or notifications', async () => {
  const f = await fixture(async () => { throw Error('Unexpected query'); });
  for (const path of ['/', '/1/comments', '/reminder-setting']) {
    const method = path === '/reminder-setting' ? 'PUT' : 'POST';
    for (const body of ['{', 'null', '[]', '1', '"text"']) {
      assert.equal((await f.app.request(path, {method, headers:{'Content-Type':'application/json'}, body})).status, 400);
    }
  }
  for (const content of [1, {}, [], true]) {
    assert.equal((await f.app.request('/', json({tutor_id:7,report_date:'2026-10-29',content}))).status,400);
    assert.equal((await f.app.request('/1/comments', json({content}))).status,400);
  }
  for (const enabled of ['false',0,null])assert.equal((await f.app.request('/reminder-setting',json({enabled},'PUT'))).status,400);
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);safe(f);
});

test('all nine route exception responses conceal upstream messages and metadata', async () => {
  const f = await fixture(async () => { throw rawError(); });
  for (const [path, options] of [['/tutors'], ['/reminder-setting'], ['/reminder-setting', json({ enabled: true }, 'PUT')],
    ['/tutor/' + marker], ['/', json({ tutor_id: marker, report_date: marker, content: marker })],
    ['/' + marker, { method: 'DELETE' }], ['/' + marker + '/comments', json({ content: marker })],
    ['/comments/' + marker, { method: 'DELETE' }], ['/check/' + marker + '/2026-10-01']]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Daily report operation failed' });
  }
  safe(f); assert.equal(f.notifications.length, 0);
});

test('report pagination and comment association retain data and query parameters', async () => {
  const report = { id: 42, tutor_id: marker, tutor_name: marker, content: marker };
  const comment = { id: 99, report_id: 42, content: marker, commenter_name: marker };
  let count = 0;
  const f = await fixture(async () => ({ rows: [[report], [{ total: '1' }], [comment]][count++] }));
  const response = await f.app.request('/tutor/' + marker + '?limit=3&offset=2');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: [{ ...report, comments: [comment] }], total: 1, limit: 3, offset: 2 });
  assert.deepEqual(f.queries.map(q => q[1]), [[marker, 3, 2], [marker], [[42]]]); safe(f);
});

test('report create, report and comment deletes, and validation preserve CRUD contracts', async () => {
  const row = { id: 42, content: marker };
  const f = await fixture(async () => ({ rows: [row] }));
  const response = await f.app.request('/', json({ tutor_id: marker, report_date: '2026-10-01', content: '  ' + marker + '  ' }));
  assert.deepEqual(await response.json(), { success: true, data: row });
  assert.deepEqual(f.queries[0][1], [marker, '2026-10-01', marker]);
  for (const path of ['/42', '/comments/99']) assert.deepEqual(await (await f.app.request(path, { method: 'DELETE' })).json(), { success: true });
  assert.deepEqual(f.queries.slice(1).map(q => q[1]), [['42'], ['99']]);
  const before = f.queries.length;
  for (const [path, body] of [['/', { content: ' ' }], ['/42/comments', { content: ' ' }]]) {
    const invalid = await f.app.request(path, json(body));
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, '必須項目が不足しています');
  }
  assert.equal(f.queries.length, before); safe(f);
});

test('settings defaults, updates, tutor list and submission checks retain successful data', async () => {
  const f = await fixture(async sql => ({ rows: sql.includes('FROM tutors t') ? [{ tutor_name: marker }] : [] }));
  assert.deepEqual(await (await f.app.request('/tutors')).json(), { success: true, data: [{ tutor_name: marker }] });
  assert.deepEqual(await (await f.app.request('/reminder-setting')).json(), { success: true, enabled: true });
  assert.deepEqual(await (await f.app.request('/reminder-setting', json({ enabled: false }, 'PUT'))).json(), { success: true, enabled: false });
  assert.deepEqual(f.queries[2][1], ['false']);
  assert.deepEqual(await (await f.app.request('/check/' + marker + '/2026-10-01')).json(), { success: true, submitted: false });
  assert.deepEqual(f.queries[3][1], [marker, '2026-10-01']); safe(f);
});

test('comment response uses authenticated user and stays successful after notification failure', async () => {
  for (const failQuery of [false, true]) {
    let count = 0;
    const row = { id: 11, report_id: 42, content: marker };
    const f = await fixture(async () => {
      count++;
      if (count === 1) return { rows: [row] };
      if (count === 2) return { rows: [{ commenter_name: marker, role: 'leader' }] };
      if (failQuery) throw rawError();
      return { rows: [{ tutor_name: marker, tutor_user_id: 8, discord_webhook_url: marker, report_date: '2026-10-01' }] };
    }, async () => { throw rawError(); });
    const response = await f.app.request('/42/comments', json({ user_id: 999, content: ' ' + marker + ' ' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { ...row, commenter_name: marker, commenter_role: 'leader' } });
    await new Promise(setImmediate);
    assert.deepEqual(f.queries[0][1], ['42', 7, marker]);
    assert.deepEqual(f.queries[1][1], [7]);
    assert.equal(f.notifications.length, failQuery ? 0 : 1); safe(f);
  }
});

test('comment notification preserves recipient, mention, text truncation and self/no-webhook skip', async () => {
  const report = { tutor_name: marker, tutor_user_id: 8, discord_webhook_url: marker, discord_user_id: marker, report_date: '2026-10-01' };
  const f = await fixture(async () => ({ rows: [report] }));
  const commentText = marker.repeat(40);
  await f.notify({ reportId: marker, commenterId: 7, commenterName: marker, commentText });
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0][0], marker);
  assert.equal(f.notifications[0][1].content, `<@${marker}>`);
  const embed = f.notifications[0][1].embeds[0];
  assert.equal(embed.title, '💬 日報にコメントが届きました');
  assert.equal(embed.fields[0].value, commentText.slice(0, 500) + '…');
  assert.equal(embed.fields[2].value, marker);
  assert.equal(embed.description.includes(`**${marker}**`), true); safe(f);
  for (const rows of [[], [{ ...report, discord_webhook_url: null }], [{ ...report, tutor_user_id: 7 }]]) {
    const skip = await fixture(async () => ({ rows }));
    await skip.notify({ reportId: marker, commenterId: 7, commenterName: marker, commentText });
    assert.equal(skip.notifications.length, 0); safe(skip);
  }
});
