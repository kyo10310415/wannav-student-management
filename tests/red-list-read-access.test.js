import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';

const token = 'a'.repeat(64);
const authorization = { Authorization: `Bearer ${token}` };
const scores = { total: 0, rank: 'none' };
let sequence = 0;
async function fixture({ role = 'crew', session = true, existing = false, install = true, contextRole } = {}) {
  const calls = { session: 0, get: [], calculate: [], update: [], updateAll: [], routeSql: 0, notification: 0 };
  const deps = { Hono,
    getRedList: async (...args) => { calls.get.push(args); return existing ? { rank: 'low', total_score: 3 } : null; },
    calculateRedListScore: async (...args) => { calls.calculate.push(args); return scores; },
    updateRedList: async (...args) => { calls.update.push(args); return scores; },
    updateAllRedLists: async (...args) => { calls.updateAll.push(args); return { updated: 0, errors: 0 }; },
    getAllRedLists: async () => [],
    query: async () => { calls.routeSql++; throw new Error('Unexpected route SQL in fixture'); },
    sendDiscordMessage: async () => { calls.notification++; throw new Error('Forbidden fixture notification'); },
    getStudentDiscordInfo: async () => { calls.notification++; throw new Error('Forbidden fixture lookup'); },
  };
  let source = await readFile(new URL('../src/routes/redList.js', import.meta.url), 'utf8');
  source = source.replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
  assert.equal(/\bimport\s+/.test(source), false);
  const key = 'redListReadAccessFixture' + sequence++;
  globalThis[key] = deps;
  let routes;
  try { routes = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  const app = new Hono();
  if (install) {
    installApiAccess(app, { db: async (sql, params) => {
      calls.session++; assert.ok(sql.includes('FROM sessions'));
      return { rows: session && params[0] === token ? [{ id: 1, role, email: 'fixture@example.test', must_change_password: false }] : [] };
    }, integrationKey: () => 'fixture-integration-key-'.repeat(3) });
  } else if (contextRole) {
    app.use('*', async (c, next) => { c.set('authenticatedUser', { role: contextRole }); return next(); });
  }
  app.route('/api/red-list', routes);
  return { app, calls };
}
const target = '/api/red-list/fixture-student?yearMonth=2026-10';
const post = { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ yearMonth: '2026-10' }) };
function noBusinessCalls(f) {
  for (const key of ['get', 'calculate', 'update', 'updateAll']) assert.equal(f.calls[key].length, 0);
  assert.equal(f.calls.routeSql, 0); assert.equal(f.calls.notification, 0);
}

test('crew missing-record GET and HEAD calculate without persistence or notification', async () => {
  for (const method of ['GET', 'HEAD']) {
    const f = await fixture();
    const response = await f.app.request(target, { method, headers: authorization });
    assert.equal(response.status, 200);
    if (method === 'GET') assert.deepEqual(await response.json(), { success: true, data: scores, message: 'Calculated' });
    else assert.equal(await response.text(), '');
    assert.deepEqual(f.calls.get, [['fixture-student', '2026-10']]);
    assert.deepEqual(f.calls.calculate, [['fixture-student', '2026-10']]);
    assert.equal(f.calls.update.length, 0); assert.equal(f.calls.updateAll.length, 0);
    assert.equal(f.calls.routeSql, 0); assert.equal(f.calls.notification, 0);
  }
});

test('forged role inputs cannot promote crew missing-record reads to persistence', async () => {
  const f = await fixture();
  const response = await f.app.request(target + '&role=admin', { headers: { ...authorization, 'X-Role': 'admin', 'X-User-Role': 'leader' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).message, 'Calculated');
  assert.equal(f.calls.update.length, 0);
});

test('admin and leader retain missing-record GET and HEAD save behavior', async () => {
  for (const role of ['admin', 'leader']) {
    for (const method of ['GET', 'HEAD']) {
      const f = await fixture({ role });
      const response = await f.app.request(target, { method, headers: authorization }); assert.equal(response.status, 200);
      if (method === 'GET') assert.deepEqual(await response.json(), { success: true, data: scores, message: 'Calculated and saved' });
      assert.deepEqual(f.calls.update, [['fixture-student', '2026-10']]);
      assert.equal(f.calls.calculate.length, 1);
    }
  }
});

test('existing records retain successful data without calculation or persistence for all roles', async () => {
  for (const role of ['crew', 'admin', 'leader']) {
    const f = await fixture({ role, existing: true });
    assert.deepEqual(await (await f.app.request(target, { headers: authorization })).json(), { success: true, data: { rank: 'low', total_score: 3 } });
    assert.equal(f.calls.calculate.length, 0); assert.equal(f.calls.update.length, 0);
  }
});

test('anonymous, cookie-only, invalid and expired sessions cannot reach read handlers', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const headers of [{}, { Cookie: `sessionToken=${token}` }, { Authorization: `Bearer ${'b'.repeat(64)}` }]) {
      const f = await fixture(); assert.equal((await f.app.request(target, { method, headers })).status, 401); noBusinessCalls(f);
    }
    const expired = await fixture({ session: false });
    assert.equal((await expired.app.request(target, { method, headers: authorization })).status, 401); noBusinessCalls(expired);
  }
});

test('crew update POSTs remain forbidden while manager update POSTs remain permitted', async () => {
  for (const role of ['crew', 'admin', 'leader']) {
    for (const path of ['/api/red-list/update', '/api/red-list/update/fixture-student']) {
      const f = await fixture({ role });
      const response = await f.app.request(path, post); assert.equal(response.status, role === 'crew' ? 403 : 200);
      if (role === 'crew') noBusinessCalls(f);
      else assert.equal(f.calls.update.length + f.calls.updateAll.length, 1);
    }
  }
});

test('machine credentials and forged internal headers cannot access these read or update routes', async () => {
  for (const headers of [{ 'X-Sync-API-Key': 'fixture-integration-key-'.repeat(3) }, { 'X-Internal-Request': 'forged' }]) {
    const f = await fixture(); assert.equal((await f.app.request(target, { headers })).status, 403); noBusinessCalls(f);
  }
});

test('missing or unrecognized authenticated context never causes automatic persistence', async () => {
  for (const contextRole of [undefined, 'viewer']) {
    const f = await fixture({ install: false, contextRole });
    const response = await f.app.request(target); assert.equal(response.status, 200);
    assert.equal((await response.json()).message, 'Calculated'); assert.equal(f.calls.update.length, 0);
  }
});
