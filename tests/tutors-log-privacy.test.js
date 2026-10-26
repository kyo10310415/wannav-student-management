import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_TUTOR_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { code: marker, config: { url: marker, credentials: marker }, detail: marker });
let sequence = 0;
async function fixture(overrides = {}) {
  const logs = [], queries = [], googleCalls = [];
  const deps = { Hono, query: async (...args) => { queries.push(args); return { rows: [] }; }, fetchTutors: async () => [],
    fetchTutorsFromCache: async () => [], fetchSatisfactionFromCache: async () => [], getCacheSyncTime: async () => ({ lastSync: marker }),
    aggregateSatisfactionByTutorMonth: rows => ({ fixture: rows.length }), aggregateMinutesQualityEvaluations: () => ({}),
    isVerifiedMinutesQualityEvaluation: () => true, normalizeMinutesQualityEvaluation: value => value,
    exportTutorQualitySnapshot: async () => ({ count: 1 }), weeklyTutorSnapshot: async () => ({ count: 1 }),
    process: { env: { GOOGLE_CACHE_SHEET_ID: marker, GOOGLE_CREDENTIALS_JSON: '{}', TUTOR_SATISFACTION_SHEET_ID: marker } },
    google: { sheets: () => ({ spreadsheets: {
      batchUpdate: async value => { googleCalls.push(['batchUpdate', value]); return { data: { replies: [{ addSheet: { properties: { sheetId: 42 } } }] } }; },
      values: { update: async value => { googleCalls.push(['update', value]); return {}; } }
    } }), auth: { GoogleAuth: class { constructor(options) { googleCalls.push(['auth', options]); } async getClient() { return 'synthetic-auth-client'; } } } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])), ...overrides };
  const source = (await readFile(new URL('../src/routes/tutors.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace("await import('googleapis')", '({ google: deps.google })');
  const key = 'tutorPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const deps = globalThis[${JSON.stringify(key)}]; const { Hono, query, fetchTutors, fetchTutorsFromCache, fetchSatisfactionFromCache, getCacheSyncTime, aggregateSatisfactionByTutorMonth, aggregateMinutesQualityEvaluations, isVerifiedMinutesQualityEvaluation, normalizeMinutesQualityEvaluation, exportTutorQualitySnapshot, weeklyTutorSnapshot, process, console } = deps;\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, queries, googleCalls };
  } finally { delete globalThis[key]; }
}
const json = (body, method = 'POST', headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('database and job route errors return fixed responses without upstream content', async () => {
  const f = await fixture({ query: async () => { throw rawError(); }, weeklyTutorSnapshot: async () => { throw rawError(); } });
  for (const [path, options] of [['/'], ['/' + marker], ['/' + marker + '/capacity', json({ student_capacity: 4 }, 'PUT')],
    ['/' + marker + '/section', json({ responsible_section: 'A' }, 'PUT')], ['/quality/monthly/' + marker + '/2026/10'],
    ['/monthly-stats/2026/10'], ['/weekly-snapshot/latest'], ['/weekly-snapshot/trigger', json({})]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Tutor operation failed' });
  }
  safe(f);
});

test('quality export authorization and validation remain enforced before export service', async () => {
  let exported = 0;
  const f = await fixture({ query: async () => ({ rows: [{}] }), exportTutorQualitySnapshot: async () => { exported++; throw rawError(); } });
  assert.equal((await f.app.request('/quality/export', json({ year: 2026, month: 10 }))).status, 401);
  assert.equal((await f.app.request('/quality/export', json({ year: 2026, month: 13 }, 'POST', { Authorization: 'Bearer fixture' }))).status, 400);
  const failed = await f.app.request('/quality/export', json({ year: 2026, month: 10 }, 'POST', { Authorization: 'Bearer fixture' }));
  assert.deepEqual(await failed.json(), { success: false, error: 'Tutor operation failed' }); assert.equal(exported, 1); safe(f);
});

test('tutor update success retains parameters and validation or missing tutor status', async () => {
  const calls = [], row = { employee_id: marker, name: marker };
  const f = await fixture({ query: async (...args) => { calls.push(args); return { rows: [row] }; } });
  assert.deepEqual(await (await f.app.request('/')).json(), { success: true, data: [row], count: 1 });
  for (const [suffix, body, expected] of [['capacity', { student_capacity: 4 }, 4], ['section', { responsible_section: '' }, null]]) {
    const response = await f.app.request('/' + marker + '/' + suffix, json(body, 'PUT'));
    assert.deepEqual(await response.json(), { success: true, data: row }); assert.deepEqual(calls.at(-1)[1], [expected, marker]);
  }
  assert.equal((await f.app.request('/fixture/section', json({ responsible_section: 'invalid' }, 'PUT'))).status, 400);
  assert.equal((await f.app.request('/fixture/capacity', json({ student_capacity: -1 }, 'PUT'))).status, 400);
  const empty = await fixture(); assert.equal((await empty.app.request('/fixture')).status, 404); safe(f);
});

test('cache failures preserve sync success fallback and fixed satisfaction error metadata', async () => {
  const f = await fixture({ fetchTutorsFromCache: async () => { throw rawError(); }, getCacheSyncTime: async () => { throw rawError(); }, fetchSatisfactionFromCache: async () => { throw rawError(); } });
  const sync = await (await f.app.request('/sync')).json();
  assert.equal(sync.success, true); assert.equal(sync.cache_error, true); assert.equal(sync.deleted, 0); assert.equal(f.queries.length, 0);
  assert.deepEqual(await (await f.app.request('/satisfaction/all')).json(), { success: true, data: {}, cache_error: true, cache_error_message: 'Tutor operation failed' }); safe(f);
});

test('sync retains deletion threshold, valid filtering and per-insert/delete failure continuation', async () => {
  for (const missingCount of [1, 2]) {
    const calls = [];
    const tutors = [0, 1, 2, 3].map(i => ({ employee_id: marker + i, name: marker, email: marker }));
    const ids = tutors.map(t => t.employee_id).concat(Array.from({ length: missingCount }, (_, i) => marker + '-missing' + i));
    const f = await fixture({ fetchTutorsFromCache: async () => [...tutors, { name: marker }], query: async (sql, params) => {
      calls.push({ sql, params }); if (sql.startsWith('SELECT employee_id')) return { rows: ids.map(employee_id => ({ employee_id })) };
      if (sql.includes('INSERT INTO tutors') && params[0] === tutors[0].employee_id) throw rawError();
      return { rows: [] };
    } });
    const response = await (await f.app.request('/sync')).json();
    assert.equal(response.success, true); assert.equal(response.count, 3); assert.equal(response.errors, 1); assert.equal(response.skipped, 1);
    assert.equal(response.deleted, missingCount === 1 ? 1 : 0);
    const deletes = calls.filter(q => q.sql.startsWith('DELETE'));
    assert.equal(deletes.length, missingCount === 1 ? 1 : 0); if (deletes.length) assert.deepEqual(deletes[0].params, [ids.at(-1)]);
    safe(f);
  }
});

test('credential parsing failures never print plain or decoded invalid credential fragments', async () => {
  for (const value of ['{"private_key":"' + marker + '" invalid}', Buffer.from('{"private_key":"' + marker + '" invalid}').toString('base64')]) {
    const f = await fixture({ process: { env: { GOOGLE_CREDENTIALS_JSON: value } } });
    const response = await f.app.request('/export-satisfaction', json({ rows: [[marker]], sortedMonths: ['2026/10'], isManualExport: true }));
    assert.equal(response.status, 500); assert.deepEqual(await response.json(), { success: false, error: 'Invalid credentials format' }); safe(f);
  }
});

test('manual Google export preserves values, merge sizing, response URL while excluding inputs from logs', async () => {
  const f = await fixture(); const rows = [['Tutor', 'metric', '2026/10'], [marker, marker, 81], [marker, marker, 82]];
  const response = await f.app.request('/export-satisfaction', json({ rows, sortedMonths: ['2026/10'], isManualExport: true, rowGroupSize: 2 }));
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.success, true);
  assert.equal(body.spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${marker}/edit#gid=42`);
  assert.deepEqual(f.googleCalls.find(c => c[0] === 'update')[1].resource.values, rows);
  const formats = f.googleCalls.filter(c => c[0] === 'batchUpdate')[1][1].resource.requests;
  assert.equal(formats[0].updateSheetProperties.properties.gridProperties.frozenColumnCount, 2);
  assert.deepEqual(formats[1].mergeCells.range, { sheetId: 42, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 }); safe(f);
});

test('Google export failures and invalid input logs exclude provider credentials and submitted values', async () => {
  const f = await fixture({ google: { sheets: () => { throw rawError(); } } });
  const failed = await f.app.request('/export-satisfaction', json({ rows: [[marker]], sortedMonths: [marker], isManualExport: true }));
  assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { success: false, error: 'Tutor operation failed' });
  const invalid = await f.app.request('/export-satisfaction', json({ rows: marker, sortedMonths: marker }));
  assert.equal(invalid.status, 400); safe(f);
});

test('sync deletion and candidate-query failures retain nonfatal response without raw provider logs', async () => {
  for (const fail of ['delete', 'candidates']) {
    const tutors = Array.from({ length: 4 }, (_, i) => ({ employee_id: marker + i, name: marker }));
    let attempted = 0;
    const f = await fixture({ fetchTutorsFromCache: async () => tutors, query: async sql => {
      if (sql.startsWith('SELECT employee_id')) {
        if (fail === 'candidates') throw rawError();
        return { rows: [...tutors, { employee_id: marker + '-missing' }] };
      }
      if (sql.startsWith('DELETE')) { attempted++; throw rawError(); }
      return { rows: [] };
    } });
    const body = await (await f.app.request('/sync')).json();
    assert.equal(body.success, true); assert.equal(body.count, 4); assert.equal(body.deleted, 0);
    assert.equal(attempted, fail === 'delete' ? 1 : 0); safe(f);
  }
});

test('missing cache configuration retains 400 responses and does not query upstream services', async () => {
  const f = await fixture({ process: { env: {} }, fetchTutorsFromCache: async () => { throw new Error('Unexpected cache call'); } });
  for (const path of ['/sync', '/satisfaction/all']) assert.equal((await f.app.request(path)).status, 400);
  assert.equal(f.queries.length, 0); safe(f);
});

test('out-of-range monthly dates retain pre-query failure after removing date logs', async () => {
  const f = await fixture();
  const response = await f.app.request('/monthly-stats/999999999/10');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'Tutor operation failed' });
  assert.equal(f.queries.length, 0); safe(f);
});
