import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionPointSchemaInitializer, ACTION_POINT_SCHEMA_SQL } from '../src/services/actionPointSchema.js';
import { createActionPointService } from '../src/services/actionPointService.js';

test('missing tables are initialized once before concurrent first reads', async () => {
  const calls = [];
  const ensure = createActionPointSchemaInitializer(async sql => { calls.push(sql); return { rows: [{ ready: false }] }; });
  await Promise.all([ensure(), ensure(), ensure()]); await ensure();
  assert.equal(calls.length, 2); assert.match(calls[0], /to_regclass/);
  assert.equal(calls[1], ACTION_POINT_SCHEMA_SQL);
  assert.equal((calls[1].match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 4);
  assert.doesNotMatch(calls[1], /\b(?:DROP|DELETE|UPDATE|ALTER|migration_history)\b/i);
});
test('already initialized databases do not need DDL permission or another migration', async () => {
  const calls = [];
  const ensure = createActionPointSchemaInitializer(async sql => { calls.push(sql); return { rows: [{ ready: true }] }; });
  await ensure(); await ensure(); assert.equal(calls.length, 1);
});
test('failed initialization retries on the next read and does not expose provider details', async () => {
  let attempts = 0;
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const ensure = createActionPointSchemaInitializer(async sql => {
      if (sql.includes('to_regclass')) return { rows: [{ ready: false }] };
      if (++attempts === 1) throw new Error('SYNTHETIC_PRIVATE_CONNECTION');
      return { rows: [] };
    });
    await assert.rejects(ensure(), { message: 'Action point schema initialization failed' });
    await ensure(); assert.equal(attempts, 2);
    assert.ok(!logs.join('').includes('SYNTHETIC_PRIVATE_CONNECTION'));
  } finally { console.error = original; }
});
test('list, update and month-end snapshot all wait for schema initialization', async () => {
  for (const operation of ['getAll', 'updateAll', 'snapshotTutors']) {
    let initialized = false, dbCalls = 0;
    const service = createActionPointService({ ensureSchema: async () => { initialized = true; throw new Error('Stop after readiness check'); },
      query: async () => { dbCalls++; assert.ok(initialized); return { rows: [] }; } });
    await assert.rejects(operation === 'snapshotTutors' ? service[operation](new Date('2026-11-30T14:59:00Z')) : service[operation]());
    assert.equal(initialized, true); assert.equal(dbCalls, 0);
  }
});
