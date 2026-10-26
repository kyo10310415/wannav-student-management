import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { normalizeFunnelStudentId } from '../src/services/funnelService.js';

const marker = 'SYNTHETIC_FUNNEL_PRIVATE';
const failure = () => Object.assign(new Error(marker), { response: { data: marker }, config: { url: marker } });
const headers = { Authorization: 'Bearer fixture-session' };
const post = body => ({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let sequence = 0;
async function fixture({ role = 'admin', session = true, fail = [], job = { id: marker }, broadcast = [{ studentId: marker, chatUrl: marker, discordId: marker }] } = {}) {
  const logs = [], queries = [], calls = [], failures = new Set(fail), clock = { now: Date.parse('2026-10-26T06:00:00Z') };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const wrap = (name, result) => async (...args) => { calls.push({ name, args }); if (failures.has(name)) throw failure(); return result; };
  const messages = [
    { id: '3', createdAt: 3, author: { id: 'staff', username: marker }, content: marker, url: marker },
    { id: '1', createdAt: 1, author: { id: marker, username: marker }, content: marker, url: marker },
    { id: '2', createdAt: 2, author: { id: 'bot', username: marker, bot: true }, content: marker, url: marker },
  ];
  const deps = { Hono, Date: FixedDate, normalizeFunnelStudentId,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM sessions')) { if (failures.has('auth')) throw failure(); return { rows: session ? [{ role, email: marker }] : [] }; }
      if (failures.has('db')) throw failure(); return { rows: [{ student_id: marker, name: marker }] };
    },
    fetchFunnelDataForMonth: wrap('funnel', { student: marker }), getFunnelDiscordScanJob: wrap('status', job),
    startFunnelDiscordScan: wrap('scan', job), fetchStudentBroadcastInfo: wrap('broadcast', broadcast), fetchChannelMessages: wrap('messages', messages),
  };
  const source = (await readFile(new URL('../src/routes/funnel.js', import.meta.url), 'utf8'))
    .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'funnelPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, Date } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries, calls, failures, clock };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
const get = headers => ({ headers });

test('anonymous, invalid sessions and crew retain 401/403 and never reach business providers', async () => {
  for (const options of [{}, { session: false }, { role: 'crew' }]) {
    const f = await fixture(options);
    const suppliedHeaders = Object.keys(options).length ? headers : {};
    for (const path of ['/?year=2025&month=1', '/analysis-export?year=2025&month=1', '/discord-scan/fixture']) {
      assert.equal((await f.app.request(path, get(suppliedHeaders))).status, options.role === 'crew' ? 403 : 401);
    }
    assert.equal(f.calls.length, 0); safe(f);
  }
  const leader = await fixture({ role: 'leader' });
  assert.equal((await leader.app.request('/analysis-export?year=2025&month=1', get(headers))).status, 403);
  assert.equal(leader.calls.length, 0); safe(leader);
});

test('session lookup failure is fixed, private and stops all route handlers', async () => {
  const f = await fixture({ fail: ['auth'] });
  for (const [path, options] of [['/?year=2025&month=1', get(headers)], ['/analysis-export?year=2025&month=1', get(headers)],
    ['/discord-scan/fixture', get(headers)], ['/discord-scan', post({ year: 2025, month: 1 })]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Funnel operation failed' });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 4); safe(f);
});

test('provider and export DB failures return fixed errors without upstream messages', async () => {
  for (const [name, path, options, expected] of [
    ['funnel', '/?year=2025&month=1', get(headers), { success: false, error: 'Funnel operation failed' }],
    ['scan', '/discord-scan', post({ year: 2025, month: 1 }), { success: false, error: 'Funnel operation failed' }],
    ['status', '/discord-scan/fixture', get(headers), { success: false, error: 'Funnel operation failed' }],
    ['broadcast', '/analysis-export?year=2025&month=1&studentId=' + marker, get(headers), { error: 'Funnel operation failed' }],
    ['messages', '/analysis-export?year=2025&month=1&studentId=' + marker, get(headers), { error: 'Funnel operation failed' }],
    ['db', '/analysis-export?year=2025&month=1', get(headers), { error: 'Funnel operation failed' }],
  ]) {
    const f = await fixture({ fail: [name] }); const response = await f.app.request(path, options);
    assert.equal(response.status, 500); assert.deepEqual(await response.json(), expected); safe(f);
  }
});

test('leader scan and funnel success preserve arguments, identity and response status', async () => {
  const f = await fixture({ role: 'leader' });
  assert.deepEqual(await (await f.app.request('/?year=2025&month=1', get(headers))).json(), { success: true, student: marker });
  const scan = await f.app.request('/discord-scan', post({ year: '2025', month: '1' })); assert.equal(scan.status, 202);
  assert.deepEqual(await scan.json(), { success: true, data: { id: marker } });
  assert.deepEqual(f.calls.find(call => call.name === 'scan').args, [{ year: 2025, month: 1, createdBy: marker }]);
  assert.deepEqual(await (await f.app.request('/discord-scan/' + marker, get(headers))).json(), { success: true, data: { id: marker } });
  assert.deepEqual(f.calls.find(call => call.name === 'status').args, [marker]); safe(f);
});

test('admin bulk export retains business payload, ranges, no-store and date boundaries', async () => {
  const f = await fixture(); const response = await f.app.request('/analysis-export?year=2025&month=12', get(headers));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json(); assert.equal(body.year, 2025); assert.equal(body.month, 12);
  assert.equal(body.cutoff, '2025-12-31T15:00:00.000Z'); assert.equal(body.followupEnd, '2026-01-07T15:00:00.000Z');
  assert.deepEqual(body.funnel, { student: marker }); assert.deepEqual(body.students, [{ student_id: marker, name: marker }]);
  assert.deepEqual(body.lessons, body.students); assert.deepEqual(body.reports, body.students);
  assert.equal(body.historicalStudentStateAvailable, false);
  assert.deepEqual(f.queries.find(call => call.sql.includes('FROM lesson_reports')).params, ['2025-12-01', '2026-01-01']); safe(f);
});

test('admin message export preserves sort, author roles, content and five minute cache retry behavior', async () => {
  const f = await fixture({ fail: ['broadcast'] }); const path = '/analysis-export?year=2025&month=1&studentId=' + marker.toLowerCase();
  assert.equal((await f.app.request(path, get(headers))).status, 500);
  f.failures.clear(); const response = await f.app.request(path, get(headers));
  const body = await response.json(); assert.equal(body.studentId, marker); assert.equal(body.channelUrl, marker);
  assert.deepEqual(body.messages.map(item => item.role), ['student', 'bot', 'staff']);
  assert.deepEqual(body.messages.map(item => item.id), ['1', '2', '3']); assert.equal(body.messages[0].content, marker);
  await f.app.request(path, get(headers)); assert.equal(f.calls.filter(call => call.name === 'broadcast').length, 2);
  f.clock.now += 5 * 60 * 1000; await f.app.request(path, get(headers));
  assert.equal(f.calls.filter(call => call.name === 'broadcast').length, 3); safe(f);
});

test('invalid dates, incomplete months and missing Discord/job info retain status without starting scans', async () => {
  const f = await fixture({ job: null, broadcast: [] });
  for (const [path, options, status] of [['/?year=2025&month=13', get(headers), 400],
    ['/analysis-export?year=2100&month=1', get(headers), 400], ['/analysis-export?year=2025&month=0', get(headers), 400],
    ['/discord-scan', post({ year: 2025, month: 0 }), 400], ['/discord-scan/fixture', get(headers), 404],
    ['/analysis-export?year=2025&month=1&studentId=' + marker, get(headers), 404]]) {
    assert.equal((await f.app.request(path, options)).status, status);
  }
  assert.equal(f.calls.some(call => call.name === 'scan'), false); safe(f);
});
