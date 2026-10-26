import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { createWebhookTestHandler } from '../src/security/webhookTest.js';
const token = 'a'.repeat(64);
const webhook = 'https://discord.com/api/webhooks/' + '1'.repeat(18) + '/' + 'a'.repeat(60);
function fixture(role, { expired = false, legacyRole } = {}) {
  const calls = [], posts = [];
  const app = new Hono();
  if (legacyRole) app.use('/api/*', async (c, next) => { c.set('user', { role: legacyRole }); await next(); });
  installApiAccess(app, { db: async () => ({ rows: expired ? [] : [{ id: 1, role, email: 'fixture@example.invalid' }] }), integrationKey: () => 'b'.repeat(64) });
  const handler = createWebhookTestHandler({ query: async (...args) => { calls.push(args); return { rows: [{ discord_webhook_url: webhook }] }; }, post: async (...args) => posts.push(args) });
  for (const path of ['test-webhook', 'test-notification']) app.post('/api/reminders/' + path, handler);
  return { calls, posts, request: (path = 'test-webhook', headers = { Authorization: 'Bearer ' + token }) => app.request('/api/reminders/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ userId: 1, role: 'admin' }) }) };
}
test('session-backed administrator can use both synthetic webhook aliases', async () => {
  const f = fixture('admin');
  for (const path of ['test-webhook', 'test-notification']) assert.equal((await f.request(path)).status, 200);
  assert.equal(f.calls.length, 2); assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0][2].maxRedirects, 0);
});
test('leader and crew cannot read delivery targets or send even with spoofed legacy role', async () => {
  for (const role of ['leader', 'crew']) {
    const f = fixture(role, { legacyRole: 'admin' });
    assert.equal((await f.request()).status, 403);
    assert.equal(f.calls.length + f.posts.length, 0);
  }
});
test('anonymous expired and machine credentials cannot reach synthetic delivery', async () => {
  for (const options of [{ headers: {} }, { expired: true }, { headers: { 'X-Sync-API-Key': 'b'.repeat(64) } }, { headers: { 'X-Internal-Request': 'fake' } }]) {
    const f = fixture('admin', options);
    assert.equal([401, 403].includes((await f.request('test-webhook', options.headers)).status), true);
    assert.equal(f.calls.length + f.posts.length, 0);
  }
});
