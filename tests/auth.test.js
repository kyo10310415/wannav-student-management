import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createRequireAuth, requireAuth } from '../src/middleware/auth.js';

function createApp(query) {
  const app = new Hono();
  app.use('*', createRequireAuth({ query }));
  app.get('/', c => c.json(c.get('user')));
  return app;
}

test('default requireAuth rejects missing credentials before connecting to DB', async () => {
  const app = new Hono();
  app.use('*', requireAuth);
  app.get('/', () => { throw new Error('Must not run'); });
  assert.equal((await app.request('/')).status, 401);
});

test('malformed authorization is rejected before DB access', async () => {
  const app = createApp(() => { assert.fail('DB must not be called'); });
  for (const authorization of ['', 'Basic abc', 'Bearer', 'Bearer ', 'Bearer a b',
    'Bearer a,Bearer b', 'Bearer ' + 'a'.repeat(256), "Bearer 'OR'1'='1"]) {
    const response = await app.request('/', { headers: { Authorization: authorization } });
    assert.equal(response.status, 401, authorization);
  }
});

for (const role of ['admin', 'leader', 'crew']) {
  test(`valid ${role} session supplies only minimal user context`, async () => {
    let calls = 0;
    const token = 'a'.repeat(64);
    const app = createApp(async (sql, params) => {
      calls++;
      assert.match(sql, /s\.session_token = \$1/);
      assert.match(sql, /s\.expires_at > NOW\(\)/);
      assert.match(sql, /JOIN users/);
      assert.ok(!sql.includes(token));
      assert.deepEqual(params, [token]);
      return { rows: [{ user_id: 7, email: 'test@example.invalid', role, session_token: token, password_hash: 'secret' }] };
    });
    const response = await app.request('/', { headers: { Authorization: `bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 7, email: 'test@example.invalid', role });
    assert.equal(calls, 1);
  });
}

test('unknown and expired tokens return 401 and never invoke the handler', async () => {
  // Expiry filtering is performed by SQL; the mock verifies that predicate.
  const app = createApp(async (sql, params) => {
    assert.match(sql, /s\.expires_at > NOW\(\)/);
    assert.ok(['unknown', 'expired'].includes(params[0]));
    return { rows: [] };
  });
  for (const token of ['unknown', 'expired']) {
    const response = await app.request('/', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).success, false);
  }
});

test('DB failures return a generic 500 without leaking details', async () => {
  const app = createApp(async () => { throw new Error('SQL secret transcript token'); });
  const response = await app.request('/', { headers: { Authorization: 'Bearer private-token' } });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: '認証情報を確認できませんでした' });
});

test('downstream failures are handled by the app and not relabeled as auth failures', async () => {
  const app = createApp(async () => ({ rows: [{ user_id: 1, role: 'crew' }] }));
  app.get('/failure', () => { throw new Error('downstream'); });
  app.onError((error, c) => c.json({ handledBy: 'app', message: error.message }, 500));
  const response = await app.request('/failure', { headers: { Authorization: 'Bearer test' } });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { handledBy: 'app', message: 'downstream' });
});
