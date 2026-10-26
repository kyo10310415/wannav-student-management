import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
const marker = 'SYNTHETIC_RED_LIST_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { detail: marker, config: { url: marker } });
let sequence = 0;
async function fixture({ fail, existing = [], history = [{ year_month: '2026-09', final_rank: 'low' }], date = '2026-10-26T03:00:00Z', queryOverride } = {}) {
  const logs = [], queries = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length >= 2 ? [Date.UTC(...args)] : args.length ? args : [date])); }
    getTimezoneOffset() { return 0; }
    getFullYear() { return this.getUTCFullYear(); } getMonth() { return this.getUTCMonth(); } getDate() { return this.getUTCDate(); }
  }
  const errorAt = stage => { if (fail === stage || fail === 'all') throw rawError(); };
  const deps = { Date: FixedDate, process: { env: { GOOGLE_CACHE_SHEET_ID: marker } },
    fetchSatisfactionFromCache: async () => { errorAt('cache'); return [{ student_id: marker, year_month: '2026/10', satisfaction_score: '7' }]; },
    query: async (sql, params) => {
      queries.push({ sql, params }); if (queryOverride) return queryOverride(sql, params);
      if (sql.includes('SELECT reservation_locked')) { errorAt('existing'); return { rows: existing }; }
      if (sql.includes('absence_count')) { errorAt('absence'); return { rows: [{ absence_count: '1' }] }; }
      if (sql.includes('response_count')) { errorAt('survey'); return { rows: [{ response_count: 0 }] }; }
      if (sql.includes('reschedule_count')) { errorAt('reschedule'); return { rows: [{ reschedule_count: '1' }] }; }
      if (sql.includes('reservation_count')) { errorAt('reservation'); return { rows: [{ reservation_count: '1' }] }; }
      if (sql.includes('SELECT DISTINCT lesson_date')) { errorAt('dates'); return { rows: [{ lesson_date: marker }] }; }
      if (sql.includes('FROM red_list_history')) { errorAt('history'); return { rows: history }; }
      return { rows: [] };
    }, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/services/redListService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'redListServicePrivacyFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const { query, fetchSatisfactionFromCache, Date, process, console } = globalThis[${JSON.stringify(key)}];\n`;
    return { module: await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`), logs, queries };
  } finally { delete globalThis[key]; }
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('score components, month parameters and reservation checks retain successful output privately', async () => {
  const f = await fixture();
  assert.deepEqual(await f.module.calculateRedListScore(marker, '2026-10'), { satisfaction: 4, absence: 3, survey: 1, reschedule: 1, reservation: 1, total: 10, rank: 'high', satisfactionAvg: 7 });
  assert.deepEqual(f.queries.find(q => q.sql.includes('response_count')).params, [marker, '2026-09']);
  assert.deepEqual(f.queries.find(q => q.sql.includes('reservation_count')).params, [marker, '2026-10']); safe(f);
});

test('component upstream failures preserve partial scores and do not log raw data', async () => {
  const points = { cache: ['satisfaction', 4], absence: ['absence', 3], survey: ['survey', 1], reschedule: ['reschedule', 1], reservation: ['reservation', 1], dates: ['reservation', 1] };
  for (const [fail, [component, pointsLost]] of Object.entries(points)) {
    const f = await fixture({ fail }); const result = await f.module.calculateRedListScore(marker, '2026-10');
    assert.equal(result[component], 0); assert.equal(result.total, 10 - pointsLost); safe(f);
  }
  const all = await fixture({ fail: 'all' });
  assert.equal((await all.module.calculateRedListScore(marker, '2026-10')).total, 0); safe(all);
});

test('before tenth and future month preserve reservation-check skip without querying reservations', async () => {
  for (const [date, month] of [['2026-10-09T03:00:00Z', '2026-10'], ['2026-10-26T03:00:00Z', '2026-11']]) {
    const f = await fixture({ date }); const result = await f.module.calculateRedListScore(marker, month);
    assert.equal(result.reservation, 0); assert.equal(f.queries.some(q => q.sql.includes('reservation_count')), false); safe(f);
  }
});

test('update preserves reservation locks, automatic consecutive EX and manual EX during history failure', async () => {
  for (const [params, exRank] of [[{}, true], [{ existing: [{ reservation_locked: true, reservation_score: 0, ex_rank: false }] }, true],
    [{ existing: [{ reservation_locked: true, reservation_score: 0, ex_rank: true }], fail: 'history' }, true]]) {
    const f = await fixture(params); const result = await f.module.updateRedList(marker, '2026-10');
    assert.equal(result.exRank, exRank);
    const insert = f.queries.at(-1); assert.match(insert.sql, /INSERT INTO red_list/);
    assert.deepEqual(insert.params.slice(0, 2), [marker, '2026-10']); assert.equal(insert.params[11], exRank);
    if (params.existing) { assert.equal(result.reservation, 0); assert.equal(result.total, 9); assert.equal(insert.params[9], false); }
    else { assert.equal(result.total, 10); assert.equal(insert.params[9], true); }
    assert.match(insert.sql, /WHEN red_list.ex_rank = TRUE THEN TRUE/); safe(f);
  }
});

test('batch updates retain per-student failure continuation and successful aggregate counts', async () => {
  const f = await fixture({ queryOverride: async (sql, params) => {
    if (sql.includes('SELECT student_id FROM students')) return { rows: [{ student_id: marker + '-fail' }, { student_id: marker }] };
    if (sql.includes('SELECT reservation_locked')) { if (params[0].endsWith('-fail')) throw rawError(); return { rows: [] }; }
    if (sql.includes('absence_count')) return { rows: [{ absence_count: 0 }] };
    if (sql.includes('response_count')) return { rows: [{ response_count: 1 }] };
    if (sql.includes('reschedule_count')) return { rows: [{ reschedule_count: 0 }] };
    if (sql.includes('reservation_count')) return { rows: [{ reservation_count: 2 }] };
    return { rows: [] };
  } });
  assert.deepEqual(await f.module.updateAllRedLists('2026-10'), { updated: 1, errors: 1 });
  assert.equal(f.queries.filter(q => q.sql.includes('INSERT INTO red_list')).length, 1); safe(f);
});

test('read operations retain returned rows and parameterized student/month filters', async () => {
  const row = { student_id: marker, total_score: 4 }, queries = [];
  const f = await fixture({ queryOverride: async (...args) => { queries.push(args); return { rows: [row] }; } });
  assert.equal(await f.module.getRedList(marker, '2026-10'), row);
  assert.deepEqual(await f.module.getAllRedLists('2026-10'), [row]);
  assert.deepEqual(queries[0][1], [marker, '2026-10']); assert.deepEqual(queries[1][1], ['2026-10']); safe(f);
});
