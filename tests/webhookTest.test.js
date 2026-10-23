import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { validateDiscordWebhook, createWebhookTestHandler } from '../src/security/webhookTest.js';
const valid = 'https://discord.com/api/webhooks/' + '1'.repeat(18) + '/' + 'a'.repeat(60);
function fixture(role, registered = valid) {
  const reads = [], posts = [];
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { role }); await next(); });
  app.post('/test', createWebhookTestHandler({ query: async (...args) => {
    reads.push(args); return { rows: registered ? [{ discord_webhook_url: registered }] : [] };
  }, post: async (...args) => { posts.push(args); } }));
  return { reads, posts, request: body => app.request('/test', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
test('non-admin requests cannot query recipients or send', async () => {
  for (const role of [undefined, 'crew', 'leader']) {
    const f = fixture(role);
    assert.equal((await f.request({ userId: 1 })).status, 403);
    assert.equal(f.reads.length + f.posts.length, 0);
  }
});
test('canonical Discord host/path required; private/local/credential/redirect URLs rejected', () => {
  assert.equal(validateDiscordWebhook(valid), valid);
  for (const value of ['http://127.0.0.1', 'http://169.254.169.254/latest', 'file:///etc/passwd',
    'https://discord.com.attacker.test/api/webhooks/a', valid+'?redirect=x', valid+'#x',
    valid.replace('discord.com','user:password@discord.com'), valid.replace('discord.com','discord.com:444'),
    'https://discord.com/api/v10/users/@me']) assert.throws(() => validateDiscordWebhook(value));
});
test('unregistered URL refused before delivery', async () => {
  const f = fixture('admin', null);
  assert.equal((await f.request({ webhookUrl: valid })).status, 400);
  assert.equal(f.posts.length, 0);
});
test('registered target still validated, even if the DB contains unsafe URL', async () => {
  const f = fixture('admin', 'http://127.0.0.1');
  assert.equal((await f.request({ userId: 1 })).status, 400);
  assert.equal(f.posts.length, 0);
});
test('registered user gets synthetic text only with redirects disabled and bounded response', async () => {
  const f = fixture('admin');
  const r = await f.request({ userId: 1, message: 'PRIVATE_TEST_INPUT', discordUserId: '123' });
  assert.equal(r.status, 200);
  const [url, payload, options] = f.posts[0];
  assert.equal(url, valid);
  assert.equal(JSON.stringify(payload).includes('PRIVATE_TEST_INPUT'), false);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(options.maxRedirects, 0);
  assert.equal(options.timeout, 5000);
  assert.equal(options.proxy, false);
  assert.equal((await r.text()).includes(valid), false);
});
