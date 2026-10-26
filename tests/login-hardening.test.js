import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import vm from 'node:vm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createLoginThrottle } from '../src/security/loginThrottle.js';
import { validateNewPassword } from '../src/security/passwordPolicy.js';

const marker = 'SYNTHETIC_LOGIN_PRIVATE';
const post = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function fixture({ missing = false, compare = async () => false, queryFail = false, throttleOptions = {} } = {}) {
  let time = 0;
  const logs = [], queries = [], comparisons = [], hashes = [];
  const context = { Hono, bodyLimit, validateNewPassword,
    createLoginThrottle: () => createLoginThrottle({ now: () => time, ...throttleOptions }),
    bcrypt: { compare: async (...args) => { comparisons.push(args); return compare(...args); }, hash: async (...args) => { hashes.push(args); return 'synthetic-new-hash'; } },
    crypto: { randomBytes: () => ({ toString: () => 'a'.repeat(64) }) },
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryFail) throw Object.assign(new Error(marker), { detail: marker });
      if (sql.includes('SELECT * FROM users')) return { rows: missing ? [] : [{ id: 7, email: marker, role: 'crew', password_hash: 'synthetic-old-hash', must_change_password: true }] };
      if (sql.includes('FROM sessions')) return { rows: [{ user_id: 7, password_hash: 'synthetic-old-hash' }] };
      if (sql.includes('SELECT tutor_name')) return { rows: [{ tutor_name: marker }] };
      return { rows: [] };
    }, console: { error: (...args) => logs.push(inspect(args)) } };
  const source = (await readFile(new URL('../src/routes/auth.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export default app;', 'globalThis.app = app;');
  vm.runInNewContext(source, context);
  return { app: context.app, queries, comparisons, hashes, logs, advance: ms => { time += ms; } };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('account failures and parallel reservations are bounded and cannot be bypassed by case or proxy headers', async () => {
  for (const missing of [false, true]) {
    const f = await fixture({ missing });
    for (let i = 0; i < 5; i++) assert.equal((await f.app.request('/login', post({ email: marker, password: marker }))).status, 401);
    const before = f.queries.length;
    const response = await f.app.request('/login', post({ email: marker.toLowerCase(), password: marker }, { 'X-Forwarded-For': '192.0.2.2', 'CF-Connecting-IP': '192.0.2.3' }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '900');
    assert.equal(f.queries.length, before);
    f.advance(900_000);
    assert.equal((await f.app.request('/login', post({ email: marker, password: marker }))).status, 401);
    safe(f);
  }
  const throttle = createLoginThrottle({ maxConcurrent: 10 });
  const pending = Array.from({ length: 5 }, () => throttle.begin(marker));
  assert.ok(pending.every(attempt => attempt.allowed));
  assert.equal(throttle.begin(marker).allowed, false);
  for (const attempt of pending) { attempt.finish('failure'); attempt.finish('success'); }
  assert.equal(throttle.begin(marker).allowed, false);
});

test('concurrent work and bounded LRU avoid a shared cooldown and never evict pending checks', () => {
  let time = 0;
  const throttle = createLoginThrottle({ now: () => time, maxConcurrent: 1, maxEntries: 2 });
  const first = throttle.begin('one');
  assert.equal(throttle.begin('two').allowed, false);
  first.finish('failure');
  throttle.begin('two').finish('failure');
  const third = throttle.begin('three');
  assert.equal(third.allowed, true);
  third.finish('failure');
  for (let i = 0; i < 200; i++) throttle.begin('distinct-' + i).finish('failure');
  const legitimate = throttle.begin('legitimate');
  assert.equal(legitimate.allowed, true);
  legitimate.finish('success');
  time = 900_000;
  const recovered = throttle.begin('three');
  assert.equal(recovered.allowed, true);
  recovered.finish('error');
  const success = throttle.begin('three');
  assert.equal(success.allowed, true);
  success.finish('success');
});

test('valid login keeps legacy passwords and successful payloads while clearing account failures', async () => {
  let valid = false;
  const f = await fixture({ compare: async () => valid });
  for (let i = 0; i < 4; i++) await f.app.request('/login', post({ email: marker, password: 'old' }));
  valid = true;
  const response = await f.app.request('/login', post({ email: marker, password: 'old' }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.data.user.mustChangePassword, true);
  assert.equal(data.data.user.tutorName, marker);
  assert.equal(data.data.sessionToken.length, 64);
  valid = false;
  assert.equal((await f.app.request('/login', post({ email: marker, password: 'old' }))).status, 401);
  assert.ok(f.queries.some(({ sql }) => sql.includes('INSERT INTO sessions')));
  assert.ok(f.comparisons.every(([password]) => password === 'old'));
  safe(f);
});

test('bad input and large login bodies stop before DB or bcrypt; service failures release work slots', async () => {
  const f = await fixture();
  for (const body of [{ email: {}, password: marker }, { email: marker, password: [] }, { email: 'x'.repeat(321), password: marker }]) {
    assert.equal((await f.app.request('/login', post(body))).status, 400);
  }
  assert.equal((await f.app.request('/login', post({ email: marker, password: 'x'.repeat(17_000) }))).status, 413);
  assert.equal(f.queries.length, 0);
  assert.equal(f.comparisons.length, 0);
  assert.equal((await f.app.request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  const failed = await fixture({ queryFail: true });
  for (let i = 0; i < 6; i++) assert.equal((await failed.app.request('/login', post({ email: marker, password: marker }))).status, 500);
  safe(failed);
});

test('password change validates before DB and updates password plus other sessions in a single statement', async () => {
  const f = await fixture({ compare: async () => true });
  const headers = { Authorization: 'Bearer fixture-current-session' };
  for (const newPassword of ['short', 'x'.repeat(73), {}, '😀'.repeat(19)]) {
    assert.equal((await f.app.request('/change-password', post({ currentPassword: marker, newPassword }, headers))).status, 400);
  }
  assert.equal(f.queries.length, 0);
  const response = await f.app.request('/change-password', post({ currentPassword: 'legacy-short', newPassword: marker }, headers));
  assert.equal(response.status, 200);
  assert.equal(f.hashes.length, 1);
  assert.ok(f.hashes[0][0] === marker);
  const update = f.queries.at(-1);
  assert.match(update.sql, /WITH updated_user AS \([\s\S]*UPDATE users[\s\S]*DELETE FROM sessions/);
  assert.match(update.sql, /session_token <> \$3/);
  assert.deepEqual(Array.from(update.params), ['synthetic-new-hash', 7, 'fixture-current-session']);
  safe(f);
});
