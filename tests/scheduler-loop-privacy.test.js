import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_SCHEDULER_PRIVATE';
let sequence = 0;
const schedule = (id, overrides = {}) => ({ id, name: marker, content: marker, created_by: 'fixture@example.test',
  schedule_cron: '30 12 * * 2', target_status: 'active', target_tutor: marker, channel_type: 'notice', ...overrides });
async function fixture(schedules, { failActive = false, invalidClock = false } = {}) {
  const logs = [], queries = [], sends = [], selections = []; let isoCalls = 0;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [invalidClock ? NaN : '2026-10-27T03:30:00Z'])); }
    getFullYear() { return this.getUTCFullYear(); } getMonth() { return this.getUTCMonth(); } getDate() { return this.getUTCDate(); }
    getDay() { return this.getUTCDay(); } getHours() { return this.getUTCHours(); } getMinutes() { return this.getUTCMinutes(); }
    getTimezoneOffset() { return 0; }
    toLocaleString() { return Number.isFinite(this.getTime()) ? new Date(this.getTime() + 9 * 3600000).toISOString() : 'Invalid Date'; }
    toISOString() { isoCalls++; return super.toISOString(); }
  }
  const deps = { Date: FixedDate,
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM users')) return { rows: [{ email: 'fixture@example.test', role: 'crew' }] };
      if (sql.includes('SELECT * FROM broadcast_messages')) return { rows: schedules.filter(item => item.id === params[0]) };
      if (sql.includes('FROM broadcast_messages')) { if (failActive) throw new Error(marker); return { rows: schedules }; }
      if (sql.includes('UPDATE broadcast_messages')) return { rows: [] };
      throw new Error('Unexpected fixture SQL');
    },
    getTargetStudents: async (...args) => { selections.push(args); return [{ student_id: 'fixture-student' }]; },
    sendBroadcast: async (...args) => { sends.push(args); return { results: { sent: 1, failed: 0 } }; },
  };
  const source = (await readFile(new URL('../src/services/schedulerService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'schedulerLoopPrivacy' + sequence++;
  globalThis[key] = deps;
  let module;
  try { module = await import(`data:text/javascript;base64,${Buffer.from(`const { Date, console, query, getTargetStudents, sendBroadcast } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { module, logs, queries, sends, selections, isoCalls: () => isoCalls };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('scheduler loop preserves biweekly even/odd filtering and all three ISO evaluations without private logs', async () => {
  const f = await fixture([schedule(1, { schedule_cron: '30 12 * * 2 biweekly', schedule_start_date: '2026-10-13T00:00:00Z' }),
    schedule(2, { schedule_cron: '30 12 * * 2 biweekly', schedule_start_date: '2026-10-20T00:00:00Z' })]);
  await f.module.checkAndExecuteSchedules(); assert.equal(f.sends.length, 1);
  assert.deepEqual(f.queries.find(call => call.sql.includes('UPDATE broadcast_messages')).params, [1]);
  assert.equal(f.isoCalls(), 3); assert.equal(f.selections[0][3], 'crew'); safe(f);
});

test('recent delivery, invalid cron and time/day mismatches skip without writes or delivery', async () => {
  const f = await fixture([schedule(1, { last_sent_at: '2026-10-27T12:00:00Z' }), schedule(2, { schedule_cron: marker }),
    schedule(3, { schedule_cron: '31 12 * * 2' }), schedule(4, { schedule_cron: '30 12 1-7 * 2' })]);
  await f.module.checkAndExecuteSchedules(); assert.equal(f.sends.length, 0);
  assert.equal(f.queries.some(call => call.sql.includes('UPDATE')), false); safe(f);
});

test('per-schedule exceptions remain private and do not stop later valid schedules', async () => {
  const broken = schedule(1); Object.defineProperty(broken, 'schedule_cron', { get() { throw new Error(marker); } });
  const f = await fixture([broken, schedule(2)]); await f.module.checkAndExecuteSchedules();
  assert.equal(f.sends.length, 1); assert.deepEqual(f.queries.find(call => call.sql.includes('UPDATE broadcast_messages')).params, [2]); safe(f);
});

test('invalid date ISO evaluation and top-level lookup errors preserve existing swallowed loop failures', async () => {
  const invalid = await fixture([schedule(1)], { invalidClock: true }); await invalid.module.checkAndExecuteSchedules();
  assert.equal(invalid.isoCalls(), 1); assert.equal(invalid.sends.length, 0); safe(invalid);
  const lookup = await fixture([schedule(1)], { failActive: true }); await lookup.module.checkAndExecuteSchedules();
  assert.equal(lookup.sends.length, 0); assert.equal(lookup.isoCalls(), 0); safe(lookup);
});
