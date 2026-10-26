import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_SURVEY_PRIVATE';
const privateError = () => Object.assign(new Error(marker), { response: { status: 400, data: marker }, config: { url: marker } });
let sequence = 0;
async function fixture({ query = async () => ({ rows: [] }), cacheFail = false, stampFail = false, discordFail = false } = {}) {
  const logs = [], queries = [], posts = [], stamps = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return query(sql, params); } };
  const cache = async value => { if (cacheFail) throw privateError(); return value; };
  const deps = { Hono, getPool: () => pool, getExtensionPool: () => pool, queryExtension: pool.query,
    fetchSurveyResponsesFromCache: () => cache({ [marker]: 2 }), fetchCurrentMonthSurveyResponses: () => cache(new Set([marker])),
    fetchMonthlyResponseHistory: () => cache(new Map([[marker, new Set(['2026-09', '2026-10'])]])), fetchExtensionResultsFromCache: () => cache({ [marker]: marker }),
    checkStampRallyAchievements: async () => { stamps.push(true); if (stampFail) throw privateError(); return { success: true, sent: 2, errors: 0, total: 2 }; },
    axios: { post: async (url, body) => { posts.push({ url, body }); if (discordFail) throw privateError(); return { status: 204, data: marker }; } },
    process: { env: { GOOGLE_CACHE_SHEET_ID: marker } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
  };
  let source = await readFile(new URL('../src/routes/survey.js', import.meta.url), 'utf8');
  source = source.replace("import { Hono } from 'hono';", 'const { Hono } = deps;')
    .replace("import { getPool } from '../db/connection.js';", 'const { getPool } = deps;')
    .replace("import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';", 'const { queryExtension, getExtensionPool } = deps;')
    .replace(/import \{\s*fetchSurveyResponsesFromCache,[\s\S]*?\} from '..\/services\/cacheService.js';/, 'const { fetchSurveyResponsesFromCache, fetchCurrentMonthSurveyResponses, fetchMonthlyResponseHistory, fetchExtensionResultsFromCache } = deps;')
    .replace("await import('../services/stampRallyService.js')", 'deps')
    .replace("(await import('axios')).default", 'deps.axios');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'surveyPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console; const process = deps.process;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries, posts, stamps };
}
function safe(f) { assert.equal(f.logs.join('\n').includes(marker), false); }
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('DB route failures return fixed messages without raw exception data', async () => {
  const f = await fixture({ query: async () => { throw privateError(); } });
  const targets = [['/debug/' + marker], ['/responses/' + marker], ['/stats-all'], ['/stats/' + marker], ['/eligible-students'],
    ['/responses', post({ studentId: marker, responseMonth: '2026-10' })], ['/reset-failed-notifications', post({})]];
  for (const [path, options] of targets) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Survey operation failed' });
  }
  safe(f);
});

test('Discord failure never discloses webhook, response or upstream error, while preserving send request', async () => {
  const f = await fixture({ query: async () => ({ rows: [{ discord_url: marker, name: marker }] }), discordFail: true });
  const response = await f.app.request('/test-discord-webhook', post({ studentId: marker }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'Survey operation failed', discordError: 'Discord webhook request failed' });
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].url, marker);
  assert.equal(f.posts[0].body.embeds[0].fields[0].value, marker);
  assert.equal(f.posts[0].body.embeds[0].fields[1].value, marker);
  safe(f);
});

test('successful recording, read, reset and Discord responses retain business payloads and SQL parameters', async () => {
  const record = { student_id: marker, response_month: '2026-10', name: marker, discord_url: marker };
  const f = await fixture({ query: async sql => ({ rows: sql.includes('SELECT id FROM survey_responses') ? [] : [record] }) });
  assert.deepEqual(await (await f.app.request('/responses/' + marker)).json(), { success: true, data: [record] });
  assert.deepEqual(await (await f.app.request('/responses', post({ studentId: marker, responseMonth: '2026-10' }))).json(), { success: true, data: record });
  const insert = f.queries.find(call => call.sql.includes('INSERT INTO survey_responses'));
  assert.deepEqual(insert.params, [marker, '2026-10']);
  const reset = await (await f.app.request('/reset-failed-notifications', post({}))).json();
  assert.equal(reset.success, true);
  assert.equal(reset.count, 1);
  assert.deepEqual(reset.studentIds, [marker]);
  const discord = await (await f.app.request('/test-discord-webhook', post({ studentId: marker }))).json();
  assert.equal(discord.success, true);
  assert.equal(discord.discordStatus, 204);
  assert.equal(discord.discordData, marker);
  safe(f);
});

test('stamp service success and failure preserve counts, and clear-cache remains available', async () => {
  for (const stampFail of [false, true]) {
    const f = await fixture({ stampFail });
    const response = await f.app.request('/check-stamp-rally', post({}));
    const body = await response.json();
    assert.equal(response.status, stampFail ? 500 : 200);
    assert.equal(body.success, !stampFail);
    assert.equal(body.sent, stampFail ? 0 : 2);
    assert.equal(body.errors, 0);
    if (stampFail) assert.equal(body.error, 'Survey operation failed');
    assert.equal(f.stamps.length, 1);
    assert.equal((await (await f.app.request('/clear-cache', post({}))).json()).success, true);
    safe(f);
  }
});

test('cache and extension partial failures stay private and retain bulk stats fallback', async () => {
  let rouletteAttempts = 0;
  const f = await fixture({ cacheFail: true, query: async sql => {
    if (sql.includes('FROM student_extensions')) throw privateError();
    if (sql.includes('FROM roulette_results') && ++rouletteAttempts === 1) throw privateError();
    if (sql.includes('FROM students s')) return { rows: [{ student_id: marker, name: marker, continued_months: 1, lesson_start_date: '2026-10-01', status: 'アクティブ' }] };
    return { rows: [] };
  } });
  const response = await f.app.request('/stats-all');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(Object.hasOwn(body.data, marker), true);
  assert.equal(rouletteAttempts, 2);
  safe(f);
});

test('validation and not-found responses keep existing status codes before any notification', async () => {
  const f = await fixture();
  for (const [path, body, status] of [['/responses', {}, 400], ['/responses', { studentId: marker, responseMonth: marker }, 400],
    ['/test-discord-webhook', {}, 400], ['/test-discord-webhook', { studentId: marker }, 404]]) {
    assert.equal((await f.app.request(path, post(body))).status, status);
  }
  assert.equal(f.posts.length, 0);
  safe(f);
});
