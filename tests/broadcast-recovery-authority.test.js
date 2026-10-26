import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { classifyLegacyBroadcastRecipients } from '../src/utils/broadcastRecovery.js';
const owner = 'owner@example.invalid';
const marker = 'SYNTHETIC_RECOVERY_PRIVATE';
let sequence = 0;
async function fixture({ role = 'crew', creator = owner, duplicate = false, isTest = false, gas = false, total,
  saved = ['OWN'], logs = [], recipientCount = 1, historyStatus = 'failed', messageName = '[Scheduled] fixture', claim = true } = {}) {
  const queries = [], transaction = [], dispatches = [], outputs = []; let released = 0;
  const job = { job_id: 'fixture-job', broadcast_id: 7, created_by: gas ? 'gas-broadcast' : owner, creator_email: creator, creator_role: role,
    message_name: messageName, target_status: gas ? 'explicit' : 'active', target_tutor: 'all', channel_type: gas ? 'chat' : 'notice',
    is_test: isTest, total: total ?? (role === 'crew' ? 1 : 2), status: historyStatus, recipient_count: recipientCount, sent: 0, failed: 0 };
  const deps = { classifyLegacyBroadcastRecipients,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('bm.name AS message_name')) return { rows: Array(duplicate ? 2 : 1).fill(job) };
      if (sql.includes('SELECT COUNT(*)::int AS count FROM broadcast_job_recipients')) return { rows: [{ count: 0 }] };
      if (sql.includes('FROM students s')) return { rows: sql.includes('AND t.email =') ? [{ student_id: 'OWN', name: marker }] : [{ student_id: 'OWN', name: marker }, { student_id: 'OTHER', name: marker }] };
      if (sql.includes('BOOL_OR(status')) return { rows: logs };
      if (sql.includes('SELECT student_id FROM broadcast_job_recipients')) return { rows: saved.map(student_id => ({ student_id })) };
      if (sql.includes('SELECT\n       bj.*')) return { rows: [job] };
      if (sql.includes('SELECT job_id')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS count') && sql.includes("status IN ('pending', 'failed')")) return { rows: [{ count: 1 }] };
      if (sql.includes('RETURNING broadcast_jobs.*')) return { rows: [job] };
      if (sql.includes("SET status = 'running'")) return { rows: claim ? [{}] : [] };
      if (sql.includes('RETURNING *')) return { rows: [] };
      return { rows: [] };
    }, getClient: async () => ({ query: async (...args) => { transaction.push(args); return { rows: [] }; }, release: () => released++ }),
    createKeyedJobDispatcher: worker => ({ dispatch: async id => { dispatches.push(id); } }),
    axios: { post: async () => { throw new Error('Forbidden fixture notification'); } }, FormData: class {},
    fetchStudentBroadcastInfo: async () => { throw new Error('Forbidden fixture Sheets lookup'); }, discordClient: {},
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => outputs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/services/broadcastService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'broadcastRecoveryAuthorityFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const { query, getClient, classifyLegacyBroadcastRecipients, createKeyedJobDispatcher, axios, FormData, fetchStudentBroadcastInfo, discordClient, console } = globalThis[${JSON.stringify(key)}];\n`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(prefix + source + '\nexport { prepareLegacyJobRecipients, assertBroadcastRecipientAccess, _runBroadcastJob };').toString('base64')}`);
    return { module, queries, transaction, dispatches, outputs, released: () => released, job };
  } finally { delete globalThis[key]; }
}
const safe = f => assert.equal(f.outputs.join('\n').includes(marker), false);
const insertRecipients = f => f.transaction.find(([sql]) => sql.includes('INSERT INTO broadcast_job_recipients'));

test('legacy scheduled crew recovery uses current owner authority and retains safe classification', async () => {
  const f = await fixture({ recipientCount: 0 });
  await f.module.prepareLegacyJobRecipients('fixture-job', 'requester@example.invalid', 'admin');
  const selector = f.queries.find(q => q.sql.includes('FROM students s'));
  assert.match(selector.sql, /AND t.email =/); assert.equal(selector.params.at(-1), owner);
  const meta = f.queries.find(q => q.sql.includes('bm.name AS message_name'));
  assert.match(meta.sql, /LOWER\(creator.email\) = LOWER\(bj.created_by\)/); assert.match(meta.sql, /bm.channel_type/);
  assert.deepEqual(JSON.parse(insertRecipients(f)[1][1]).map(r => r.student_id), ['OWN']);
  assert.equal(f.transaction[0][0], 'BEGIN'); assert.equal(f.transaction.at(-1)[0], 'COMMIT'); assert.equal(f.released(), 1); safe(f);
});

test('legacy manager recovery retains all targets and rejects unknown or ambiguous creators without fallback', async () => {
  for (const role of ['admin', 'leader']) {
    const f = await fixture({ role }); await f.module.prepareLegacyJobRecipients('fixture-job', owner, 'crew');
    assert.equal(JSON.parse(insertRecipients(f)[1][1]).length, 2);
  }
  for (const params of [{ creator: null }, { role: undefined, creator: null }, { role: 'unknown' }, { duplicate: true }]) {
    const f = await fixture(params);
    await assert.rejects(() => f.module.prepareLegacyJobRecipients('fixture-job', owner, 'admin'), error => error.status === 403);
    assert.equal(f.transaction.length, 0); assert.equal(f.queries.some(q => q.sql.includes('FROM students s')), false); safe(f);
  }
});

test('legacy count and historical-target checks remain fail-closed before any recipient writes', async () => {
  for (const params of [{ total: 2 }, { logs: [{ student_id: 'OTHER', was_sent: true }] }]) {
    const f = await fixture(params);
    await assert.rejects(() => f.module.prepareLegacyJobRecipients('fixture-job', owner, 'crew'), /自動復旧できません/);
    assert.equal(f.transaction.length, 0); safe(f);
  }
});

test('legacy synthetic test jobs retain their artificial recipient without requiring a human creator', async () => {
  const f = await fixture({ isTest: true, creator: null, role: 'unknown', total: 1 });
  await f.module.prepareLegacyJobRecipients('fixture-job', owner, 'admin');
  assert.equal(JSON.parse(insertRecipients(f)[1][1])[0].student_id, 'TEST');
  assert.equal(f.queries.some(q => q.sql.includes('FROM students s')), false); safe(f);
});

test('saved pending recipients outside crew scope reject resume before reconciliation, state writes or dispatch', async () => {
  for (const messageName of ['[Scheduled] fixture', 'renamed-template']) {
    const f = await fixture({ saved: ['OWN', 'OTHER'], messageName });
    await assert.rejects(() => f.module.resumeBroadcastJob('fixture-job', owner, 'crew'), error => error.status === 403);
    assert.equal(f.queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q.sql.trim())), false);
    assert.equal(f.dispatches.length, 0); assert.equal(f.transaction.length, 0); safe(f);
  }
});

test('authorized crew and manager durable resumes retain their existing dispatch and status transitions', async () => {
  for (const [role, saved] of [['crew', ['OWN']], ['leader', ['OWN', 'OTHER']], ['admin', ['OWN', 'OTHER']]]) {
    const f = await fixture({ role, saved }); const result = await f.module.resumeBroadcastJob('fixture-job', owner, role);
    assert.equal(result.job_id, 'fixture-job'); assert.deepEqual(f.dispatches, ['fixture-job']);
    assert.equal(f.queries.filter(q => q.sql.includes("SET status = 'pending'")).length, 1); safe(f);
  }
});

test('worker refuses unauthorized durable jobs after atomic claim but before recipient claim or notification', async () => {
  for (const params of [{ saved: ['OTHER'] }, { creator: null }, { role: 'unknown' }, { duplicate: true }]) {
    const f = await fixture(params); await f.module._runBroadcastJob('fixture-job');
    assert.equal(f.queries.some(q => q.sql.includes("SET status = 'running'")), true);
    assert.equal(f.queries.some(q => q.sql.includes("SET status = 'sending'")), false);
    assert.equal(f.queries.some(q => q.sql.includes("SET status = CASE WHEN status = 'sending'")), true);
    assert.equal(f.queries.some(q => q.sql.includes('RETURNING broadcast_jobs.*') && q.params[1] === 'interrupted'), true); safe(f);
  }
});

test('test and exact GAS machine jobs bypass human ownership checks while ordinary jobs cannot forge an exception', async () => {
  for (const params of [{ isTest: true, creator: null, role: 'unknown' }, { gas: true, creator: null, role: 'unknown' }]) {
    const f = await fixture(params); await f.module.assertBroadcastRecipientAccess('fixture-job');
    assert.equal(f.queries.some(q => q.sql.includes('FROM students s')), false);
    assert.equal(f.queries.some(q => q.sql.includes('SELECT student_id FROM broadcast_job_recipients')), false);
  }
  const f = await fixture({ creator: null, messageName: '[Scheduled] gas-broadcast' });
  await assert.rejects(() => f.module.assertBroadcastRecipientAccess('fixture-job'), error => error.status === 403);
});

test('saved manager recipients retain snapshot behavior without recalculating current target filters', async () => {
  for (const role of ['admin', 'leader']) {
    const f = await fixture({ role, saved: ['FORMER-TARGET'] });
    await f.module.assertBroadcastRecipientAccess('fixture-job');
    assert.equal(f.queries.some(q => q.sql.includes('FROM students s')), false);
    assert.equal(f.queries.some(q => q.sql.includes('SELECT student_id FROM broadcast_job_recipients')), false);
  }
});

test('a worker that does not acquire the existing atomic job claim never validates or interrupts another run', async () => {
  const f = await fixture({ claim: false, creator: null }); await f.module._runBroadcastJob('fixture-job');
  assert.equal(f.queries.length, 1);
  assert.equal(f.queries[0].sql.includes("SET status = 'running'"), true);
  assert.equal(f.queries.some(q => q.sql.includes('interrupted') || q.sql.includes('error_message = $2')), false);
});
