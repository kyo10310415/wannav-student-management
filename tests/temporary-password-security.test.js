import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import vm from 'node:vm';
import { Hono } from 'hono';
import { generateTemporaryPassword } from '../src/security/temporaryPassword.js';
import { validateNewPassword } from '../src/security/passwordPolicy.js';
import { createLoginThrottle } from '../src/security/loginThrottle.js';
import { bodyLimit } from 'hono/body-limit';

const marker = 'SYNTHETIC_AUTH_PRIVATE';
const json = (body, token = true) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer fixture-session' } : {}) }, body: JSON.stringify(body) });
async function fixture(file, { role = 'admin', valid = true, dbFail = false, writeFail = false } = {}) {
  const logs = [], queries = [], passwords = [];
  const context = { Hono, generateTemporaryPassword, validateNewPassword, createLoginThrottle, bodyLimit,
    crypto: { randomBytes: () => ({ toString: () => 'a'.repeat(64) }) },
    bcrypt: { compare: async () => true, hash: async (password, cost) => { passwords.push(password); assert.equal(cost, 10); return 'synthetic-hash'; } },
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (dbFail || (writeFail && /^(INSERT|UPDATE|WITH updated_user)/.test(sql.trim()))) throw Object.assign(new Error(marker), { detail: marker });
      if (sql.includes('FROM sessions')) return { rows: valid ? [{ role, email: marker, user_id: 7 }] : [] };
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 7, email: marker, role: 'crew' }] };
      return { rows: [] };
    }, console: { error: (...args) => logs.push(inspect(args)) } };
  const source = (await readFile(new URL('../src/routes/' + file + '.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export default app;', 'globalThis.app = app;');
  vm.runInNewContext(source, context);
  return { app: context.app, logs, queries, passwords };
}
function privateLogs(f) { assert.equal(f.logs.join('\n').includes(marker), false); for (const password of f.passwords) assert.equal(f.logs.join('\n').includes(password), false); }

test('temporary passwords use independent 192-bit random values in the expected transport-safe format', () => {
  const values = Array.from({ length: 32 }, generateTemporaryPassword);
  assert.ok(values.every(value => /^[A-Za-z0-9_-]{32}$/.test(value)));
  assert.equal(new Set(values).size, values.length);
});

test('admin create and reset return a unique temporary password while persisting only its hash', async () => {
  for (const [file, path, body] of [['users', '/', { email: 'Fixture@Example.Test', role: 'crew' }], ['auth', '/reset-password', { userId: 7 }]]) {
    const f = await fixture(file);
    const issued = [];
    for (let i = 0; i < 2; i++) {
      const response = await f.app.request(path, json(body));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const data = await response.json();
      assert.equal(data.success, true);
      assert.ok(/^[A-Za-z0-9_-]{32}$/.test(data.temporaryPassword));
      assert.ok(data.temporaryPassword === f.passwords[i]);
      assert.equal(data.message.includes(data.temporaryPassword), false);
      const writes = f.queries.filter(({ sql }) => /^(INSERT|UPDATE|WITH updated_user)/.test(sql.trim()));
      const write = writes.at(-1);
      assert.ok(write.sql.includes('must_change_password'));
      assert.ok(write.params.includes('synthetic-hash'));
      assert.equal(JSON.stringify(write.params).includes(data.temporaryPassword), false);
      issued.push(data.temporaryPassword);
    }
    assert.ok(issued[0] !== issued[1]);
    if (file === 'auth') {
      const revocations = f.queries.filter(({ sql }) => sql.includes('DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated_user)'));
      assert.equal(revocations.length, 2);
      assert.equal(revocations[0].params[1], 7);
      assert.match(revocations[0].sql, /WITH updated_user AS \([\s\S]*UPDATE users[\s\S]*RETURNING id/);
    }
    privateLogs(f);
  }
});

test('Tutor quality authentication fails closed privately and preserves successful export arguments', async () => {
  for (const mode of ['anonymous', 'expired', 'database-failed', 'valid']) {
    const logs = [], exports = [], queries = [];
    const context = { Hono, console: { error: (...args) => logs.push(inspect(args)) },
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (mode === 'database-failed') throw new Error(marker);
        return { rows: mode === 'expired' ? [] : [{}] };
      }, exportTutorQualitySnapshot: async (...args) => { exports.push(args); return { count: 1 }; } };
    const source = (await readFile(new URL('../src/routes/tutors.js', import.meta.url), 'utf8'))
      .replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export default app;', 'globalThis.app = app;');
    vm.runInNewContext(source, context);
    const response = await context.app.request('/quality/export', json({ year: 2026, month: 10 }, mode !== 'anonymous'));
    assert.equal(response.status, { anonymous: 401, expired: 401, 'database-failed': 500, valid: 200 }[mode]);
    if (mode === 'valid') assert.deepEqual(exports[0], [2026, 10]);
    else assert.equal(exports.length, 0);
    assert.equal(logs.join('\n').includes(marker), false);
    if (mode === 'anonymous') assert.equal(queries.length, 0);
    if (mode === 'database-failed') assert.equal((await response.text()).includes(marker), false);
  }
});

test('create and reset reject anonymous, expired and non-admin sessions before issuing credentials', async () => {
  for (const [file, path, body] of [['users', '/', { email: marker, role: 'crew' }], ['auth', '/reset-password', { userId: 7 }]]) {
    for (const [options, token, expected] of [[{}, false, 401], [{ valid: false }, true, 401], [{ role: 'crew' }, true, 403], [{ role: 'leader' }, true, 403]]) {
      const f = await fixture(file, options);
      const response = await f.app.request(path, json(body, token));
      assert.equal(response.status, expected);
      assert.equal(Object.hasOwn(await response.json(), 'temporaryPassword'), false);
      assert.equal(f.passwords.length, 0);
      assert.equal(f.queries.some(({ sql }) => /^(INSERT|UPDATE|WITH updated_user)/.test(sql.trim())), false);
      privateLogs(f);
    }
  }
});

test('credential write failures disclose neither temporary passwords nor upstream errors', async () => {
  for (const [file, path, body] of [['users', '/', { email: marker, role: 'crew' }], ['auth', '/reset-password', { userId: 7 }]]) {
    const f = await fixture(file, { writeFail: true });
    const response = await f.app.request(path, json(body));
    assert.equal(response.status, 500);
    const content = await response.text();
    assert.equal(content.includes(marker), false);
    assert.equal(content.includes(f.passwords[0]), false);
    privateLogs(f);
  }
});

test('auth endpoints and admin lookup failures keep upstream data out of logs and responses', async () => {
  const f = await fixture('auth', { dbFail: true });
  for (const [path, options] of [['/login', json({ email: marker, password: marker })], ['/logout', json({})],
    ['/verify', { headers: { Authorization: 'Bearer fixture-session' } }], ['/change-password', json({ currentPassword: marker, newPassword: marker + '-new' })], ['/reset-password', json({ userId: 7 })]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500, path);
    assert.equal((await response.text()).includes(marker), false);
  }
  privateLogs(f);
  const users = await fixture('users', { dbFail: true });
  assert.equal((await users.app.request('/', json({ email: marker, role: 'crew' }))).status, 500);
  assert.equal(users.passwords.length, 0);
  privateLogs(users);
});

test('admin UI shows issued credentials without browser storage and keeps the generic response fallback', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const match = source.match(/function showIssuedTemporaryPassword\(data\) \{[\s\S]*?\n\}/);
  assert.ok(match);
  const alerts = [];
  const context = { alert: value => alerts.push(value) };
  vm.runInNewContext(match[0] + '\nglobalThis.show = showIssuedTemporaryPassword;', context);
  context.show({ message: 'fixture', temporaryPassword: marker });
  assert.ok(alerts[0].includes(marker));
  context.show({ message: 'legacy-response' });
  assert.equal(alerts[1], 'legacy-response');
  assert.equal(/localStorage|sessionStorage|console\.|fetch\(|axios\./.test(match[0]), false);
  for (const fn of ['handleCreateUser', 'resetUserPassword']) {
    assert.ok(new RegExp('async function ' + fn + '\\([^)]*\\)[\\s\\S]*?showIssuedTemporaryPassword\\(response.data\\)').test(source));
  }
});
