import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_RED_LIST_PRIVATE';
let sequence = 0;
async function fixture({ failAt = 0, dailyFail = false } = {}) {
  const logs = [], queries = [], updates = [];
  const rawError = () => Object.assign(new Error(marker), { detail: marker, config: { password: marker } });
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length > 1 ? [Date.UTC(...args)] : args.length ? args : ['2026-01-01T00:00:00Z'])); }
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getTimezoneOffset() { return 0; }
  }
  const deps = { Date: FixedDate, console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    query: async (sql, params) => { queries.push({ sql, params }); if (queries.length === failAt) throw rawError(); return { rowCount: queries.length === 1 ? 12 : 3 }; },
    updateAllRedLists: async month => { updates.push(month); if (dailyFail) throw rawError(); return { updated: 12, errors: 2 }; } };
  const api = {};
  for (const file of ['redListDaily', 'redListMonthly']) {
    const source = (await readFile(new URL('../src/jobs/' + file + '.js', import.meta.url), 'utf8'))
      .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
      .replace("import { updateAllRedLists } from '../services/redListService.js';", 'const { updateAllRedLists } = deps;');
    const key = 'redJobPrivacyFixture' + sequence++;
    globalThis[key] = deps;
    try { Object.assign(api, await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, Date } = deps;\n${source}`).toString('base64')}`)); }
    finally { delete globalThis[key]; }
  }
  return { api, logs, queries, updates };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('daily red list job preserves JST month selection and partial-success result', async () => {
  const f = await fixture();
  assert.deepEqual(await f.api.dailyRedListUpdate(), { updated: 12, errors: 2 });
  assert.deepEqual(f.updates, ['2026-01']);
  assert.equal(f.queries.length, 0);
  safe(f);
});

test('monthly red list job preserves year rollover, archive-before-delete and original retention cutoff', async () => {
  const f = await fixture();
  assert.deepEqual(await f.api.monthlyRedListReset(), { archived: 12, deleted: 3 });
  assert.equal(f.queries.length, 2);
  assert.match(f.queries[0].sql, /INSERT INTO red_list_history[\s\S]*WHERE year_month = \$1[\s\S]*ON CONFLICT DO NOTHING/);
  assert.match(f.queries[1].sql, /DELETE FROM red_list[\s\S]*WHERE year_month < \$1/);
  assert.deepEqual(f.queries.map(({ params }) => params), [['2025-12'], ['2025-12']]);
  safe(f);
});

test('daily upstream failure hides provider data and retains a rejected job result', async () => {
  const f = await fixture({ dailyFail: true });
  await assert.rejects(f.api.dailyRedListUpdate, error => {
    assert.equal(error.message, 'Daily red list update failed');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.equal(Object.hasOwn(error, 'config'), false);
    return true;
  });
  safe(f);
});

test('monthly failures stay private and stop at the same archive or delete stage', async () => {
  for (const failAt of [1, 2]) {
    const f = await fixture({ failAt });
    await assert.rejects(f.api.monthlyRedListReset, error => {
      assert.equal(error.message, 'Monthly red list reset failed');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      return true;
    });
    assert.equal(f.queries.length, failAt);
    safe(f);
  }
});
