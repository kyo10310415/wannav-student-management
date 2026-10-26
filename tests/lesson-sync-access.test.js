import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';

const token = 'a'.repeat(64);
const authorization = { Authorization: `Bearer ${token}` };
function fixture(role = 'crew', session = true) {
  const app = new Hono();
  const calls = { sync: 0, read: 0, lookup: 0 };
  const dispatch = installApiAccess(app, {
    integrationKey: () => 'fixture-sync-key-'.repeat(3),
    db: async (sql, params) => {
      calls.lookup++;
      assert.ok(sql.includes('FROM sessions'));
      return { rows: session && params[0] === token ? [{ id: 1, role, email: 'fixture@example.test', must_change_password: false }] : [] };
    },
  });
  app.get('/api/lessons/sync/:year/:month', c => { calls.sync++; return c.json({ fixture: 'calendar-sync' }); });
  app.get('/api/lessons/sync-from-sheet', c => { calls.sync++; return c.json({ fixture: 'sheet-sync' }); });
  app.get('/api/lessons/*', c => { calls.read++; return c.json({ fixture: 'read' }); });
  return { app, calls, dispatch };
}
const targets = ['/api/lessons/sync/2026/10', '/api/lessons/sync-from-sheet'];

test('anonymous, cookie-only, invalid and expired sessions never reach GET or HEAD sync handlers', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const path of targets) {
      for (const headers of [{}, { Cookie: `sessionToken=${token}` }, { Authorization: `Bearer ${'b'.repeat(64)}` }]) {
        const f = fixture();
        assert.equal((await f.app.request(path, { method, headers })).status, 401);
        assert.equal(f.calls.sync, 0);
      }
      const expired = fixture('admin', false);
      assert.equal((await expired.app.request(path, { method, headers: authorization })).status, 401);
      assert.equal(expired.calls.sync, 0);
    }
  }
});

test('crew is denied before GET and HEAD sync handlers, including decoded route parameters', async () => {
  const f = fixture('crew');
  for (const method of ['GET', 'HEAD']) {
    for (const path of [...targets, '/api/lessons/sync/2026%2Fextra/10', '/api/lessons/sync/2026/10?role=admin']) {
      assert.equal((await f.app.request(path, { method, headers: authorization })).status, 403, path);
    }
  }
  assert.equal(f.calls.sync, 0);
  assert.equal(f.calls.read, 0);
});

test('admin and leader preserve GET and HEAD access to both existing sync routes', async () => {
  for (const role of ['admin', 'leader']) {
    const f = fixture(role);
    for (const method of ['GET', 'HEAD']) {
      for (const path of targets) {
        assert.equal((await f.app.request(path, { method, headers: authorization })).status, 200);
      }
    }
    assert.equal(f.calls.sync, 4);
  }
});

test('similarly named paths and normal lesson reads remain available to crew', async () => {
  const f = fixture('crew');
  for (const path of ['/api/lessons/sync-status', '/api/lessons/sync-from-sheet-status', '/api/lessons/syncing/2026/10',
    '/api/lessons/month/2026/10', '/api/lessons/student/fixture', '/api/lessons/stats/2026/10']) {
    assert.equal((await f.app.request(path, { headers: authorization })).status, 200, path);
  }
  assert.equal(f.calls.sync, 0);
  assert.equal(f.calls.read, 6);
});

test('machine credentials cannot use lesson sync outside their existing allowlists', async () => {
  const f = fixture('admin');
  for (const path of targets) {
    assert.equal((await f.app.request(path, { headers: { 'X-Internal-Request': 'forged' } })).status, 403);
    assert.equal((await f.app.request(path, { headers: { 'X-Sync-API-Key': 'fixture-sync-key-'.repeat(3) } })).status, 403);
    await assert.rejects(() => f.dispatch(path), /not allowed/);
  }
  assert.equal(f.calls.lookup, 0);
  assert.equal(f.calls.sync, 0);
});
