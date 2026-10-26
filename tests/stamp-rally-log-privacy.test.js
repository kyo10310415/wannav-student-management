import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_STAMP_PRIVATE';
const privateError = () => Object.assign(new Error(marker), { response: { data: { error: marker } }, config: { url: marker } });
let sequence = 0;
async function fixture({ enabled = true, queryFail = false, statsFail = false, statsThrow = false, missingType = false,
  already = false, generateFail = false, generateThrow = false, missingStudent = false, missingChannel = false,
  discordFail = false, discordThrow = false, updateFail = false, recordFail = false, recordThrow = false } = {}) {
  const logs = [], queries = [], requests = [], messages = [], waits = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (queryFail || (updateFail && sql.includes('UPDATE stamp_rally_achievements'))) throw privateError();
    if (sql.includes('FROM system_settings')) return { rows: [{ setting_value: String(enabled) }] };
    if (sql.includes('SELECT id, notified_at')) return { rows: already ? [{ id: 1, notified_at: '2026-10-20' }] : [] };
    if (sql.includes('FROM students')) return { rows: missingStudent ? [] : [{ discord_url: missingChannel ? null : marker }] };
    return { rows: [] };
  };
  const deps = {
    getPool: () => ({ query }), queryExtension: query, getExtensionPool: () => ({ query }), axios: {},
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    setTimeout: (callback, delay) => { waits.push(delay); callback(); },
    internalApi: {
      get: async path => {
        requests.push({ method: 'get', path }); if (statsThrow) throw privateError();
        return { data: { success: !statsFail, error: marker, data: { [marker]: { name: marker, continuedMonths: 4, responseCount: 4,
          responseRate: 100, resultScore: 'S', isEligible: { isEligible: true, achievementType: missingType ? null : marker, privateDetail: marker } } } } };
      },
      post: async (path, body) => {
        requests.push({ method: 'post', path, body });
        if (path === '/api/survey/responses') { if (recordThrow) throw privateError(); return { data: { success: !recordFail, error: marker } }; }
        if (generateThrow) throw privateError();
        return { data: { success: !generateFail, error: marker, data: { rouletteUrl: marker, probability: 100 } } };
      },
    },
    sendStampRallyNotification: async (...args) => {
      messages.push(args); if (discordThrow) throw privateError();
      return { success: !discordFail, error: marker, reason: marker, message: marker };
    },
  };
  let source = await readFile(new URL('../src/services/stampRallyService.js', import.meta.url), 'utf8');
  source = source.replace("import { getPool } from '../db/connection.js';", 'const { getPool } = deps;')
    .replace("import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';", 'const { queryExtension, getExtensionPool } = deps;')
    .replace("import axios from 'axios';", 'const { axios } = deps;')
    .replace("import { internalApi } from '../security/internalApi.js';", 'const { internalApi } = deps;')
    .replace("await import('./discordService.js')", 'deps');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'stampPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console; const setTimeout = deps.setTimeout;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { api, logs, queries, requests, messages, waits };
}
function safe(f) { assert.equal(f.logs.join('\n').includes(marker), false); }

test('successful achievement preserves dispatch, notification arguments, SQL and success counts', async () => {
  const f = await fixture();
  assert.deepEqual(await f.api.checkStampRallyAchievements(), { success: true, sent: 1, errors: 0, total: 1 });
  assert.deepEqual(f.requests, [{ method: 'get', path: '/api/survey/stats-all' },
    { method: 'post', path: '/api/roulette/generate', body: { studentId: marker, achievementType: marker } }]);
  assert.deepEqual(f.messages, [[marker, marker, marker]]);
  assert.deepEqual(f.queries.find(call => call.sql.includes('SELECT id, notified_at')).params, [marker, marker]);
  const update = f.queries.find(call => call.sql.includes('UPDATE stamp_rally_achievements'));
  assert.deepEqual(update.params, [marker]);
  assert.ok(update.sql.includes('AND notified_at IS NULL'));
  assert.deepEqual(f.waits, [2000]);
  safe(f);
});

test('disabled, already notified and missing achievement type retain existing skip rules', async () => {
  const disabled = await fixture({ enabled: false });
  assert.equal(await disabled.api.checkStampRallyAchievements(), undefined);
  assert.equal(disabled.requests.length, 0); safe(disabled);
  for (const options of [{ already: true }, { missingType: true }]) {
    const f = await fixture(options);
    assert.deepEqual(await f.api.checkStampRallyAchievements(), { success: true, sent: 0, errors: 0, total: options.missingType ? 0 : 1 });
    assert.equal(f.requests.length, 1);
    assert.equal(f.messages.length, 0);
    assert.equal(f.waits.length, 0);
    safe(f);
  }
});

test('provider and DB top-level failures retain failure counts with only a fixed error response', async () => {
  for (const options of [{ queryFail: true }, { statsThrow: true }]) {
    const f = await fixture(options);
    const result = await f.api.checkStampRallyAchievements();
    assert.deepEqual(result, { success: false, error: 'Stamp rally achievement check failed', sent: 0, errors: 0, total: 0 });
    assert.equal(f.messages.length, 0); safe(f);
  }
  const f = await fixture({ statsFail: true });
  assert.deepEqual(await f.api.checkStampRallyAchievements(), { success: false, sent: 0, errors: 1 });
  safe(f);
});

test('per-student failures preserve partial-success counts and never mark failed sends notified', async () => {
  for (const options of [{ generateFail: true }, { generateThrow: true }, { missingStudent: true }, { missingChannel: true },
    { discordFail: true }, { discordThrow: true }, { updateFail: true }]) {
    const f = await fixture(options);
    assert.deepEqual(await f.api.checkStampRallyAchievements(), { success: true, sent: 0, errors: 1, total: 1 });
    const updateCalls = f.queries.filter(call => call.sql.includes('UPDATE stamp_rally_achievements'));
    assert.equal(updateCalls.length, options.updateFail ? 1 : 0);
    assert.deepEqual(f.waits, options.generateFail ? [] : [2000]);
    safe(f);
  }
});

test('survey recording keeps internal dispatch and boolean failure contracts without IDs or upstream logs', async () => {
  for (const options of [{}, { recordFail: true }, { recordThrow: true }]) {
    const f = await fixture(options);
    assert.equal(await f.api.recordSurveyResponse(marker, marker), !options.recordFail && !options.recordThrow);
    assert.deepEqual(f.requests, [{ method: 'post', path: '/api/survey/responses', body: { studentId: marker, responseMonth: marker } }]);
    assert.equal(f.queries.length, 0); safe(f);
  }
});
