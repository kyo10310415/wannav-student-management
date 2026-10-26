import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { classifyLegacyBroadcastRecipients } from '../src/utils/broadcastRecovery.js';

const email = 'fixture-owner@example.test';
const token = 'a'.repeat(64);
const headers = { Authorization: `Bearer ${token}` };
let sequence = 0;
async function fixture({ role = 'crew', legacy = false, noOwnJob = false, session = true } = {}) {
  const own = { job_id: 'own-job', broadcast_id: 1, created_by: email, status: legacy ? 'interrupted' : 'running', stale: true,
    total: 2, sent: legacy ? 1 : 0, failed: 0, unknown_count: 0, is_test: true };
  const other = { ...own, job_id: 'other-job', broadcast_id: 2, created_by: 'fixture-other@example.test', status: 'running' };
  const jobs = new Map([[other.job_id, other], ...noOwnJob ? [] : [[own.job_id, own]]]);
  const recipients = new Map([...jobs.keys()].map(id => [id, legacy && id === 'own-job' ? [] : [{ status: 'sending' }, { status: 'pending' }]]));
  const queries = [], writes = [], dispatches = [], notifications = [];
  const status = id => {
    const job = jobs.get(id); if (!job) return null;
    const rows = recipients.get(id) || [];
    return { ...job, recipient_count: rows.length, pending: rows.length ? rows.filter(row => ['pending', 'sending'].includes(row.status)).length : Math.max(job.total - job.sent - job.failed - job.unknown_count, 0), unknown_recipients: [] };
  };
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM sessions')) return { rows: session ? [{ id: 1, user_id: 1, email, role, must_change_password: false }] : [] };
    if (sql.includes('WHERE bj.job_id = $1')) return { rows: status(params[0]) ? [status(params[0])] : [] };
    if (sql.includes('SELECT job_id') && sql.includes('updated_at <')) {
      return { rows: [...jobs.values()].filter(job => job.stale && ['pending', 'running'].includes(job.status) && (params.length < 3 || job.job_id === params[2])).map(job => ({ job_id: job.job_id })) };
    }
    if (sql.includes('SELECT job_id') && sql.includes('WHERE created_by = $1')) return { rows: [...jobs.values()].filter(job => job.created_by === params[0]).map(job => ({ job_id: job.job_id })).slice(0, 1) };
    if (sql.includes('UPDATE broadcast_job_recipients')) {
      writes.push({ kind: 'recipient-reconcile', jobId: params[0] });
      for (const row of recipients.get(params[0]) || []) if (row.status === 'sending') row.status = 'unknown';
      return { rows: [] };
    }
    if (sql.includes('WITH counts AS')) {
      writes.push({ kind: 'progress', jobId: params[0] });
      const job = jobs.get(params[0]), rows = recipients.get(params[0]) || [];
      if (rows.length) { job.sent = rows.filter(row => row.status === 'sent').length; job.failed = rows.filter(row => row.status === 'failed').length; job.unknown_count = rows.filter(row => row.status === 'unknown').length; }
      if (params[1]) job.status = params[1]; job.stale = false;
      return { rows: [{ ...job }] };
    }
    if (sql.includes('LEFT JOIN users creator')) return { rows: jobs.has(params[0]) ? [{ ...jobs.get(params[0]) }] : [] };
    if (sql.includes('FROM broadcast_logs')) return { rows: [] };
    if (sql.includes('INSERT INTO broadcast_job_recipients')) {
      writes.push({ kind: 'legacy-recipients', jobId: params[0] }); recipients.set(params[0], JSON.parse(params[1])); return { rows: [] };
    }
    if (sql.includes('SELECT COUNT(*)::int AS count')) return { rows: [{ count: (recipients.get(params[0]) || []).filter(row => ['pending', 'failed'].includes(row.status)).length }] };
    if (sql.includes("UPDATE broadcast_jobs SET status = 'pending'")) {
      writes.push({ kind: 'resume', jobId: params[0] }); jobs.get(params[0]).status = 'pending'; return { rows: [] };
    }
    if (sql.includes('UPDATE broadcast_jobs SET updated_at')) { writes.push({ kind: 'legacy-time', jobId: params[0] }); return { rows: [] }; }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error('Unexpected fixture SQL');
  };
  const forbidden = async () => { notifications.push(true); throw new Error('Forbidden real delivery boundary'); };
  const deps = { Hono, query, getClient: async () => ({ query, release() {} }), classifyLegacyBroadcastRecipients,
    createKeyedJobDispatcher: () => ({ dispatch: async id => { dispatches.push(id); } }),
    axios: { post: forbidden, get: forbidden }, FormData: class {}, discordClient: {}, fetchStudentBroadcastInfo: forbidden };
  const key = 'broadcastJobAccessFixture' + sequence++;
  globalThis[key] = deps;
  let service, routes;
  try {
    let source = await readFile(new URL('../src/services/broadcastService.js', import.meta.url), 'utf8');
    source = source.replace("import axios from 'axios';", 'const { axios } = deps;').replace("import FormData from 'form-data';", 'const { FormData } = deps;')
      .replace("import { client as discordClient } from './discordService.js';", 'const { discordClient } = deps;')
      .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
    assert.equal(/\bimport(?:\s|\()/.test(source), false);
    const prefix = `const deps = globalThis[${JSON.stringify(key)}];\n`;
    service = await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`);
    Object.assign(deps, service);
    source = (await readFile(new URL('../src/routes/broadcast.js', import.meta.url), 'utf8'))
      .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`)
      .replace("await import('../db/connection.js')", 'deps');
    assert.equal(/\bimport(?:\s|\()/.test(source), false);
    routes = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  const app = new Hono(); installApiAccess(app, { db: query, integrationKey: () => '' }); app.route('/api/broadcast', routes);
  return { app, service, jobs, recipients, queries, writes, dispatches, notifications };
}
const post = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' };

test('GET and HEAD of unauthorized or absent jobs cannot reconcile any job before denial', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const [id, code] of [['other-job', 403], ['missing-job', 404]]) {
      const f = await fixture(); const response = await f.app.request('/api/broadcast/jobs/' + id, { method, headers });
      assert.equal(response.status, code); assert.deepEqual(f.writes, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.notifications, []);
      assert.equal(f.queries.some(call => call.sql.includes('updated_at <')), false);
    }
  }
});

test('own GET and HEAD reconcile only the authorized stale job and keep polling progress usable', async () => {
  for (const method of ['GET', 'HEAD']) {
    const f = await fixture(); const response = await f.app.request('/api/broadcast/jobs/own-job', { method, headers }); assert.equal(response.status, 200);
    if (method === 'GET') { const body = await response.json(); assert.equal(body.job.status, 'interrupted'); assert.equal(body.job.unknown, 1); assert.equal(body.job.pending, 1); }
    assert.ok(f.writes.length > 0); assert.ok(f.writes.every(write => write.jobId === 'own-job'));
    assert.equal(f.jobs.get('other-job').status, 'running'); assert.equal(f.recipients.get('other-job')[0].status, 'sending');
    assert.deepEqual(f.queries.find(call => call.sql.includes('updated_at <')).params, ['5 minutes', '30 seconds', 'own-job']);
    assert.deepEqual(f.dispatches, []); assert.deepEqual(f.notifications, []);
  }
});

test('recoverable selects own job before any writes and never touches unrelated stale jobs', async () => {
  const f = await fixture(); const response = await f.app.request('/api/broadcast/jobs/recoverable', { headers }); assert.equal(response.status, 200);
  assert.equal((await response.json()).job.status, 'interrupted'); assert.ok(f.writes.every(write => write.jobId === 'own-job'));
  assert.equal(f.jobs.get('other-job').status, 'running');
  const select = f.queries.findIndex(call => call.sql.includes('WHERE created_by = $1'));
  const stale = f.queries.findIndex(call => call.sql.includes('updated_at <')); assert.ok(select < stale);
  const empty = await fixture({ noOwnJob: true });
  assert.deepEqual(await (await empty.app.request('/api/broadcast/jobs/recoverable', { headers })).json(), { success: true, job: null });
  assert.deepEqual(empty.writes, []); assert.equal(empty.jobs.get('other-job').status, 'running');
});

test('authorized legacy recovery preserves conservative unknown classification and no automatic delivery', async () => {
  const f = await fixture({ legacy: true }); const response = await f.app.request('/api/broadcast/jobs/recoverable', { headers }); assert.equal(response.status, 200);
  assert.ok(f.writes.some(write => write.kind === 'legacy-recipients')); assert.ok(f.writes.every(write => write.jobId === 'own-job'));
  assert.equal(f.recipients.get('own-job')[0].status, 'unknown'); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.notifications, []);
});

test('resume authorizes before reconciliation and retries only the authorized job', async () => {
  const denied = await fixture(); assert.equal((await denied.app.request('/api/broadcast/jobs/other-job/resume', post)).status, 403);
  assert.deepEqual(denied.writes, []); assert.deepEqual(denied.dispatches, []);
  const own = await fixture(); assert.equal((await own.app.request('/api/broadcast/jobs/own-job/resume', post)).status, 200);
  assert.ok(own.writes.every(write => write.jobId === 'own-job')); assert.deepEqual(own.dispatches, ['own-job']);
  assert.equal(own.recipients.get('own-job')[0].status, 'unknown'); assert.equal(own.recipients.get('own-job')[1].status, 'pending');
  assert.equal(own.jobs.get('other-job').status, 'running'); assert.deepEqual(own.notifications, []);
});

test('manager visibility and internal global reconciliation remain compatible', async () => {
  for (const role of ['admin', 'leader']) {
    const f = await fixture({ role }); assert.equal((await f.app.request('/api/broadcast/jobs/other-job', { headers })).status, 200);
    assert.ok(f.writes.every(write => write.jobId === 'other-job')); assert.equal(f.jobs.get('own-job').status, 'running');
  }
  const global = await fixture(); await global.service.reconcileStaleBroadcastJobs();
  assert.deepEqual(new Set(global.writes.map(write => write.jobId)), new Set(['own-job', 'other-job']));
  assert.deepEqual(global.queries[0].params, ['5 minutes', '30 seconds']); assert.deepEqual(global.dispatches, []);
});

test('anonymous and expired requests remain denied before any job work', async () => {
  for (const options of [{}, { session: false }]) {
    const f = await fixture(options); const response = await f.app.request('/api/broadcast/jobs/own-job', options.session === false ? { headers } : {});
    assert.equal(response.status, 401); assert.deepEqual(f.writes, []); assert.deepEqual(f.dispatches, []);
    assert.equal(f.queries.some(call => call.sql.includes('FROM broadcast_jobs')), false);
  }
});
