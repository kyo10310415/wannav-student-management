import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
let sequence = 0;
async function fixture({ role = 'crew', missing = false, duplicate = false, fail = false, noTargets = false, notFound = false, failActive = false, deliveryFail = false } = {}) {
  const queries = [], sends = [], logs = [];
  const owner = 'owner@example.invalid';
  const schedule = { id: 42, name: 'SYNTHETIC_PRIVATE', content: 'SYNTHETIC_PRIVATE', channel_type: 'discord', target_status: 'active', target_tutor: 'all', created_by: owner };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM broadcast_messages')) { if (failActive) throw Error('SYNTHETIC_PRIVATE'); return { rows: notFound ? [] : [schedule] }; }
    if (sql.includes('FROM users')) { if (fail) throw Error('SYNTHETIC_PRIVATE'); return { rows: missing ? [] : Array(duplicate ? 2 : 1).fill({ email: owner, role }) }; }
    if (sql.includes('FROM students')) return { rows: noTargets ? [] : sql.includes('AND t.email =') ? [{ student_id: 'OWN' }] : [{ student_id: 'OWN' }, { student_id: 'OTHER' }] };
    return { rows: [] };
  };
  const quiet = Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))]));
  const broadcast = await readFile(new URL('../src/services/broadcastService.js', import.meta.url), 'utf8');
  const targetSource = broadcast.slice(broadcast.indexOf('export async function getTargetStudents'), broadcast.indexOf('// ─── タイムアウト付き'));
  const source = (await readFile(new URL('../src/services/schedulerService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'scheduledAuthority' + sequence++;
  globalThis[key] = { query, console: quiet, sendBroadcast: async (...args) => { sends.push(args); return { success: !deliveryFail, results: { sent: args[1].length, failed: 0 } }; } };
  try {
    const module = await import('data:text/javascript;base64,' + Buffer.from(`const { query, console, sendBroadcast } = globalThis[${JSON.stringify(key)}];\n${targetSource.replace('export async function', 'async function')}\n${source}`).toString('base64'));
    return { module, queries, sends, logs };
  } finally { delete globalThis[key]; }
}
test('scheduled crew delivery uses the real recipient selector to restrict to own students', async () => {
  const f = await fixture();
  assert.equal((await f.module.executeScheduledBroadcast(42)).success, true);
  assert.deepEqual(f.sends[0][1], [{ student_id: 'OWN' }]);
  const selection = f.queries.find(item => item.sql.includes('FROM students'));
  assert.equal(selection.params.at(-1), 'owner@example.invalid');
  assert.equal(f.queries.filter(item => item.sql.includes('UPDATE broadcast_messages')).length, 1);
  assert.equal(f.logs.join('\n').includes('SYNTHETIC_PRIVATE'), false);
});
test('scheduled admin and leader retain unrestricted target selection', async () => {
  for (const role of ['admin', 'leader']) {
    const f = await fixture({ role });
    assert.equal((await f.module.executeScheduledBroadcast(42)).success, true);
    assert.equal(f.sends[0][1].length, 2);
  }
});
test('missing unknown duplicated or unavailable creators fail before recipient selection and delivery', async () => {
  for (const options of [{ missing: true }, { role: 'unknown' }, { duplicate: true }, { fail: true }]) {
    const f = await fixture(options);
    const result = await f.module.executeScheduledBroadcast(42);
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(f.logs.join('\n').includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(f.sends.length, 0);
    assert.equal(f.queries.some(item => item.sql.includes('FROM students') || item.sql.includes('UPDATE')), false);
  }
});

test('disabled or empty schedules retain no-delivery outcomes and do not update last sent', async () => {
  for (const options of [{ notFound: true }, { noTargets: true }]) {
    const f = await fixture(options);
    const result = await f.module.executeScheduledBroadcast(42);
    assert.equal(result.success, false);
    assert.equal(f.sends.length, 0);
    assert.equal(f.queries.some(item => item.sql.includes('UPDATE')), false);
  }
});
test('active schedule lookup failures preserve throw and checker catch without private logs', async () => {
  const f = await fixture({ failActive: true });
  await assert.rejects(f.module.getActiveSchedules());
  await f.module.checkAndExecuteSchedules();
  assert.equal(f.logs.join('\n').includes('SYNTHETIC_PRIVATE'), false);
  assert.equal(f.sends.length, 0);
});
test('cron conversion retains existing weekly biweekly monthly behavior and validation', async () => {
  const { module } = await fixture();
  assert.equal(module.generateCronExpression('weekly', '2', '09:30'), '30 09 * * 2');
  assert.equal(module.generateCronExpression('biweekly', '2', '09:30'), '30 09 * * 2');
  assert.equal(module.generateCronExpression('monthly', '2', '09:30'), '30 09 1-7 * 2');
  assert.equal(module.parseCronExpression('30 09 1-7 * 2').frequency, 'monthly');
  assert.throws(() => module.generateCronExpression('invalid', '2', '09:30'));
  assert.throws(() => module.parseCronExpression('invalid'));
});


test('failed asynchronous delivery does not advance scheduled last_sent_at', async () => {
  const f = await fixture({ deliveryFail: true });
  const result = await f.module.executeScheduledBroadcast(42);
  assert.equal(result.success, false);
  assert.equal(f.sends.length, 1);
  assert.equal(f.queries.some(item => item.sql.includes('UPDATE broadcast_messages')), false);
});
