import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_PRIVATE_ROULETTE';
let sequence = 0;
const failure = () => Object.assign(new Error(marker), { detail: marker, query: marker, parameters: [marker], config: { password: marker } });
async function fixture(query) {
  const logs = [], queries = [];
  let notifications = 0;
  const deps = { Hono, getPool: () => ({ query: async (...args) => { queries.push(args); return query(...args); } }),
    crypto: { randomBytes: size => { assert.equal(size, 32); return { toString: encoding => { assert.equal(encoding, 'hex'); return marker; } }; } },
    axios: { post: async () => { notifications++; throw new Error('Unexpected notification in isolated test'); } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/roulette.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const Hono = deps.Hono;')
    .replace("import { getPool } from '../db/connection.js';", 'const getPool = deps.getPool;')
    .replace("import crypto from 'crypto';", 'const crypto = deps.crypto;')
    .replace("import axios from 'axios';", 'const axios = deps.axios;');
  const key = 'roulettePrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries, notifications: () => notifications };
}
const request = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const privateLogs = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all roulette exception responses and fallback logs conceal provider details', async () => {
  const f = await fixture(async () => { throw failure(); });
  const cases = [
    ['/generate', request({ studentId: marker, achievementType: marker })], ['/verify/' + marker],
    ['/spin', request({ token: marker })], ['/result/' + marker], ['/test-draw', request({ studentId: marker })],
    ['/reset-test-results', request({})], ['/winners'], ['/winners/' + marker, request({ consultationStaff: marker }, 'PATCH')],
    ['/losers'], ['/unopened'], ['/test-send', request({ studentId: marker, channelUrl: marker, discordUserId: marker })],
    ['/fix-completed-dates', request({})]
  ];
  for (const [path, options] of cases) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Roulette operation failed' }, path);
  }
  privateLogs(f);
  assert.equal(f.notifications(), 0);
});

test('generated capability remains only in response and SQL parameters, never logs', async () => {
  let count = 0;
  const rows = [
    { student_id: marker, name: marker, result_score: 'S' },
    { id: marker, notified_at: null },
    { id: marker, achievement_date: '2026-10-01' }
  ];
  const f = await fixture(async () => ({ rows: [rows[count++]] }));
  const response = await f.app.request('/generate', request({ studentId: marker, achievementType: marker }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.studentName, marker);
  assert.equal(body.data.token, marker);
  assert.equal(body.data.probability, 100);
  assert.equal(body.data.rouletteUrl.endsWith('/roulette.html?token=' + marker), true);
  assert.deepEqual(f.queries[0][1], [marker]);
  assert.deepEqual(f.queries[1][1], [marker, marker]);
  assert.deepEqual(f.queries[2][1], [body.data.rouletteUrl, marker]);
  assert.equal(f.notifications(), 0);
  privateLogs(f);
});

test('winner updates retain SQL parameters and returned row without logging staff or row data', async () => {
  const row = { id: marker, consultation_staff: marker, status: marker, completed_at: marker };
  const f = await fixture(async () => ({ rows: [row] }));
  const response = await f.app.request('/winners/' + marker, request({ consultationStaff: marker, status: marker, completedAt: marker }, 'PATCH'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: row });
  assert.deepEqual(f.queries[1][1], [marker, marker, marker, marker]);
  assert.match(f.queries[1][0], /completed_at = \$3/);
  privateLogs(f);
});

test('missing completion column retains fallback update and does not log raw exceptions', async () => {
  let calls = 0;
  const row = { id: marker, consultation_staff: marker };
  const f = await fixture(async () => { if (calls++ === 0) throw failure(); return { rows: [row] }; });
  const response = await f.app.request('/winners/' + marker, request({ consultationStaff: marker, completedAt: marker }, 'PATCH'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: row });
  assert.deepEqual(f.queries[1][1], [marker, marker]);
  assert.equal(f.queries[1][0].includes('completed_at'), false);
  privateLogs(f);
});

test('completion repair retains response counts without logging database rows', async () => {
  let calls = 0;
  const f = await fixture(async () => ({ rows: calls++ === 0 ? [{ student_id: marker, name: marker }] : [{ id: marker }] }));
  const response = await f.app.request('/fix-completed-dates', request({}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(f.queries.length, 2);
  privateLogs(f);
});

test('invalid request bodies keep validation status and perform no database operations', async () => {
  const f = await fixture(async () => { throw new Error('Unexpected database operation'); });
  for (const path of ['/generate', '/spin', '/test-draw', '/test-send']) {
    const response = await f.app.request(path, request({}));
    assert.equal(response.status, 400);
  }
  assert.equal(f.queries.length, 0);
  assert.equal(f.notifications(), 0);
});
