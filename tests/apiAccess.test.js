import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { configureInternalApi, internalApi } from '../src/security/internalApi.js';

const token = 'a'.repeat(64);
function fixture(role = 'crew') {
  const state = { user: { id: 7, email: 'tutor@example.test', role, tutor_id: 3,
    tutor_name: 'Fixture Tutor', notion_name: 'fixture-tutor', employee_id: 'E3', must_change_password: false }, calls: 0, lookups: 0 };
  const app = new Hono();
  const dispatch = installApiAccess(app, {
    integrationKey: () => 'sync-fixture-only-'.repeat(3),
    db: async (sql, params) => {
      state.lookups++;
      if (sql.includes('FROM sessions')) return { rows: params[0] === token && state.user ? [state.user] : [] };
      if (sql.includes('FROM students')) return { rows: params[0] === 'OWN' ? [{ student_id: 'OWN' }] : [] };
      if (sql.includes('FROM helper_requests')) return { rows: params[0] === '1' && params[1] === 'E3' ? [{ id: 1 }] : [] };
      throw new Error('Unexpected query');
    }
  });
  app.all('/api/*', c => { state.calls++; return c.json({ success: true, actor: c.get('authenticatedUser')?.id }); });
  return { app, state, dispatch };
}
const authorized = { Authorization: `Bearer ${token}` };
const json = (body, headers = authorized) => ({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('anonymous, invalid, expired and query-string credentials never reach business handlers', async () => {
  const { app, state } = fixture();
  for (const url of ['/api/students', '/api/database', '/api/survey/stats-all', `/api/students?sessionToken=${token}`, '/api/students.js']) {
    assert.equal((await app.request(url)).status, 401);
  }
  assert.equal((await app.request('/api/students', { headers: { Authorization: 'Bearer ' + 'b'.repeat(64) } })).status, 401);
  state.user = null;
  assert.equal((await app.request('/api/students', { headers: authorized })).status, 401);
  assert.equal(state.calls, 0);
});

test('server-side role protects administration and immediately observes role changes', async () => {
  const { app, state } = fixture('admin');
  assert.equal((await app.request('/api/database', { headers: authorized })).status, 200);
  state.user.role = 'crew';
  for (const url of ['/api/database', '/api/users', '/api/tutor-red-list', '/api/extension-review/capabilities', '/api/funnel', '/api/vq-diagnosis/history', '/api/schedules/absence-requests/pending', '/api/roulette/winners']) {
    assert.equal((await app.request(url, { headers: authorized })).status, 403, url);
  }
  assert.equal((await app.request('/api/students?role=admin', { headers: authorized })).status, 200);
  assert.equal((await app.request('/api/settings/key', { ...json({ role: 'admin' }), method: 'PUT' })).status, 403);
  assert.equal((await app.request('/api/auth/reset-password', json({ role: 'admin' }))).status, 403);
  state.user.role = 'unknown';
  assert.equal((await app.request('/api/students', { headers: authorized })).status, 403);
});

test('leader preserves shared business access but cannot manage users', async () => {
  const { app } = fixture('leader');
  for (const url of ['/api/students', '/api/tutors', '/api/funnel', '/api/minutes/all', '/api/users/consultation-staff']) {
    assert.equal((await app.request(url, { headers: authorized })).status, 200, url);
  }
  assert.equal((await app.request('/api/users', json({ role: 'admin' }))).status, 403);
});

test('initial password users can only verify, logout and change password', async () => {
  const { app, state } = fixture('admin');
  state.user.must_change_password = true;
  assert.equal((await app.request('/api/students', { headers: authorized })).status, 403);
  assert.equal((await app.request('/api/auth/verify', { headers: authorized })).status, 200);
  assert.equal((await app.request('/api/auth/change-password', json({}))).status, 200);
});

test('crew cannot act as another tutor or change another tutor student', async () => {
  const { app, state } = fixture();
  assert.equal((await app.request('/api/daily-reports', json({ tutor_id: 4 }))).status, 403);
  assert.equal((await app.request('/api/daily-reports/tutor/4', { headers: authorized })).status, 403);
  assert.equal((await app.request('/api/daily-reports', json({ tutor_id: 3 }))).status, 200);
  assert.equal((await app.request('/api/schedules/absence', json({ tutor_email: 'other@example.test' }))).status, 403);
  assert.equal((await app.request('/api/schedules/absence/event/other%40example.test', { method: 'DELETE', headers: authorized })).status, 403);
  assert.equal((await app.request('/api/schedules/absence/request/approve', json({ leader_email: state.user.email }))).status, 403);
  assert.equal((await app.request('/api/lesson-reports', json({ student_id: 'OTHER', tutor_name: 'fixture-tutor', role: 'admin' }))).status, 403);
  assert.equal((await app.request('/api/lesson-reports', json({ student_id: 'OWN' }))).status, 200);
  assert.equal((await app.request('/api/students/OTHER/pro-plan', { ...json({}), method: 'PATCH' })).status, 403);
});

test('opaque student capabilities are narrowly excluded, not all roulette APIs', async () => {
  const { app, state } = fixture();
  assert.equal((await app.request('/api/roulette/verify/' + 'c'.repeat(64))).status, 200);
  assert.equal((await app.request('/api/roulette/spin', json({ token: 'c'.repeat(64) }, {}))).status, 200);
  assert.equal((await app.request('/api/roulette/verify/student-id')).status, 401);
  assert.equal((await app.request('/api/roulette/generate', json({}, {}))).status, 401);
  assert.equal((await app.request('/api/roulette/spin', json({ studentId: 'OWN' }, {}))).status, 400);
  assert.equal((await app.request('/api/roulette/result/OWN')).status, 401);
  assert.equal(state.lookups, 0);
});

test('crew write allowlist rejects maintenance routes and future unclassified mutations', async () => {
  const { app, state } = fixture();
  for (const path of ['/api/handover/reset', '/api/roulette/reset-test-results', '/api/roulette/test-send',
    '/api/roulette/fix-completed-dates', '/api/survey/clear-cache', '/api/survey/reset-failed-notifications',
    '/api/stats/send', '/api/helper-requests/check-expired', '/api/future-admin-operation']) {
    assert.equal((await app.request(path, json({ role: 'admin' }))).status, 403, path);
  }
  assert.equal((await app.request('/api/lesson-reports/1', { method: 'DELETE', headers: authorized })).status, 403);
  assert.equal((await app.request('/api/tutors/OTHER/capacity', { ...json({}), method: 'PUT' })).status, 403);
  assert.equal((await app.request('/api/tutors/OTHER/section', { ...json({}), method: 'PUT' })).status, 403);
  assert.equal(state.calls, 0);
});

test('crew helper requests require their own identity, assigned student and deletion ownership', async () => {
  const { app } = fixture();
  assert.equal((await app.request('/api/helper-requests', json({ requesting_tutor_id: 'OTHER', student_id: 'OWN' }))).status, 403);
  assert.equal((await app.request('/api/helper-requests', json({ requesting_tutor_id: 'E3', student_id: 'OTHER' }))).status, 403);
  assert.equal((await app.request('/api/helper-requests', json({ requesting_tutor_id: 'E3', student_id: 'OWN' }))).status, 200);
  assert.equal((await app.request('/api/helper-requests/1/accept', json({ tutor_id: 'OTHER' }))).status, 403);
  assert.equal((await app.request('/api/helper-requests/1/accept', json({ tutor_id: 'E3' }))).status, 200);
  assert.equal((await app.request('/api/helper-requests/2', { method: 'DELETE', headers: authorized })).status, 403);
  assert.equal((await app.request('/api/helper-requests/1', { method: 'DELETE', headers: authorized })).status, 200);
});

test('local cron dispatch has only enumerated routes and never performs network I/O', async () => {
  const { app, dispatch, state } = fixture();
  configureInternalApi(dispatch);
  assert.equal((await internalApi.get('/api/students/sync')).data.success, true);
  assert.equal((await internalApi.post('/api/roulette/generate', { studentId: 'OWN' })).data.success, true);
  assert.equal(state.lookups, 0);
  await assert.rejects(() => internalApi.get('/api/users'), /not allowed/);
  await assert.rejects(() => dispatch('https://other.example.test/api/students/sync'), /not allowed/);
  assert.equal((await app.request('/api/students/sync', { headers: { 'X-Internal-Request': 'forged' } })).status, 403);
  assert.equal((await app.request('/api/students/sync')).status, 401);
});

test('GAS sync credential cannot access unrelated data or administrative operations', async () => {
  const { app } = fixture();
  const headers = { 'X-Sync-API-Key': 'sync-fixture-only-'.repeat(3) };
  assert.equal((await app.request('/api/external/lesson-start-dates', { headers })).status, 200);
  assert.equal((await app.request('/api/students', { headers })).status, 403);
  assert.equal((await app.request('/api/database', { headers })).status, 403);
  assert.equal((await app.request('/api/external/lesson-start-dates', { headers: { 'X-Sync-API-Key': 'invalid' } })).status, 401);
});

test('authentication DB failure fails closed without returning database details', async () => {
  const app = new Hono();
  installApiAccess(app, { db: async () => { throw new Error('PRIVATE_DATABASE_SENTINEL'); } });
  app.get('/api/students', c => c.json({ private: true }));
  const response = await app.request('/api/students', { headers: authorized });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('PRIVATE_DATABASE_SENTINEL'));
});

test('browser adds credentials only to same-origin API calls for axios and fetch', async () => {
  let requestInterceptor, responseError, sent;
  const context = {
    localStorage: { getItem: () => token, removeItem() {} },
    URL, Headers, Request,
    window: { location: { href: 'https://app.example.test/', origin: 'https://app.example.test' },
      fetch: async (input, options) => { sent = { input, options }; return new Response('{}'); } },
    axios: { interceptors: { request: { use(fn) { requestInterceptor = fn; } }, response: { use(ok, error) { responseError = error; } } } },
    showLoginPage() {}
  };
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split('// State')[0];
  vm.runInNewContext(source, context);
  assert.equal(requestInterceptor({ url: '/api/students' }).headers.Authorization, `Bearer ${token}`);
  assert.equal(requestInterceptor({ url: 'students', baseURL: '/api/' }).headers.Authorization, `Bearer ${token}`);
  assert.equal(requestInterceptor({ url: 'https://other.example.test/api/students' }).headers, undefined);
  assert.equal(requestInterceptor({ url: '/app.js' }).headers, undefined);
  await context.window.fetch('/api/students');
  assert.equal(sent.options.headers.get('Authorization'), `Bearer ${token}`);
  await context.window.fetch('https://other.example.test/api/students');
  assert.equal(sent.options.headers, undefined);
  await assert.rejects(() => responseError({ response: { status: 401 }, config: { url: '/api/students' } }));
  assert.equal(requestInterceptor({ url: '/api/students' }).headers, undefined);
});
