import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { getNewAssignmentMonthWindow, isValidNewAssignmentMonth } from '../src/services/handoverMonthService.js';
const marker = 'SYNTHETIC_HANDOVER_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, headers: { Authorization: marker } }, detail: marker });
let sequence = 0;
async function fixture(overrides = {}) {
  const logs = [], queries = [], googleCalls = [];
  const deps = { Hono, getNewAssignmentMonthWindow, isValidNewAssignmentMonth,
    query: async (...args) => { queries.push(args); return { rows: [], rowCount: 0 }; },
    process: { env: { GOOGLE_CREDENTIALS_JSON: '{}', HANDOVER_EXPORT_SHEET_ID: marker } },
    google: { auth: { GoogleAuth: class { constructor(options) { googleCalls.push(['auth', options]); } async getClient() { return 'synthetic-auth'; } } },
      sheets: () => ({ spreadsheets: {
        get: async value => { googleCalls.push(['get', value]); return { data: { sheets: [] } }; },
        batchUpdate: async value => { googleCalls.push(['batchUpdate', value]); return { data: { replies: value.resource.requests.filter(r => r.addSheet).map((r, i) => ({ addSheet: { properties: { sheetId: i + 1 } } })) } }; },
        values: { batchUpdate: async value => { googleCalls.push(['values', value]); return {}; } }
      } }) },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])), ...overrides };
  const source = (await readFile(new URL('../src/routes/handover.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'handoverPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const { Hono, query, google, getNewAssignmentMonthWindow, isValidNewAssignmentMonth, process, console } = globalThis[${JSON.stringify(key)}];\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, queries, googleCalls };
  } finally { delete globalThis[key]; }
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all six upstream route errors conceal messages, SQL and credential metadata', async () => {
  const f = await fixture({ query: async () => { throw rawError(); } });
  for (const [path, options] of [['/students'], ['/students/' + marker + '/assignment', json({ handover_tutor_name: marker }, 'PUT')],
    ['/tutor-sidebar'], ['/new-assignments'], ['/reset', json({})], ['/export', json({})]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Handover operation failed' });
  }
  safe(f);
});

test('students preserve remaining-lesson aggregation and student data', async () => {
  let count = 0; const rows = [{ student_id: marker, name: marker }, { student_id: 'fixture-other', name: marker }];
  const f = await fixture({ query: async () => ({ rows: count++ === 0 ? [{ student_id: marker, remaining_lessons: '3' }] : rows }) });
  assert.deepEqual(await (await f.app.request('/students')).json(), { success: true, data: [{ ...rows[0], remaining_lessons: 3 }, { ...rows[1], remaining_lessons: 0 }] }); safe(f);
});

test('assignment upsert and reset preserve update parameters and successful counts', async () => {
  const calls = [], row = { student_id: marker, handover_tutor_name: marker };
  const f = await fixture({ query: async (...args) => { calls.push(args); return { rows: [row], rowCount: 3 }; } });
  for (const name of [marker, '']) {
    const response = await f.app.request('/students/' + marker + '/assignment', json({ handover_tutor_name: name }, 'PUT'));
    assert.deepEqual(await response.json(), { success: true, data: row }); assert.deepEqual(calls.at(-1)[1], [marker, name || null]);
  }
  assert.deepEqual(await (await f.app.request('/reset', json({}))).json(), { success: true, cleared: 3 });
  assert.match(calls.at(-1)[0], /WHERE handover_tutor_name IS NOT NULL/); safe(f);
});

test('tutor sidebar retains capacity, handover and section aggregation', async () => {
  const resultRows = [
    [{ tutor_name: marker, notion_name: marker, student_capacity: '10', responsible_section: 'A' }],
    [{ homeroom_tutor: marker, cnt: '4' }],
    [{ homeroom_tutor: marker, section_pro: '1', section_a: '1', section_a_over: '2', section_b: '0', section_c: '0' }],
    [{ handover_tutor_name: marker, homeroom_tutor: marker }, { handover_tutor_name: marker, homeroom_tutor: 'other' }]
  ]; let count = 0;
  const f = await fixture({ query: async () => ({ rows: resultRows[count++] }) });
  const body = await (await f.app.request('/tutor-sidebar')).json();
  assert.deepEqual(body, { success: true, data: [{ tutor_name: marker, notion_name: marker, capacity: 10, active_count: 4,
    to_count: 2, from_count: 1, available: 5, responsible_section: 'A', section_counts: { Pro: 1, A: 3, B: 0, C: 0 } }] }); safe(f);
});

test('new assignment month selection keeps SQL windows, legacy next_month and validation', async () => {
  const calls = [];
  const f = await fixture({ query: async (...args) => { calls.push(args); return { rows: [] }; } });
  for (const selection of ['current', 'next']) {
    const expected = getNewAssignmentMonthWindow(selection);
    const response = await f.app.request('/new-assignments?month=' + selection);
    assert.deepEqual(await response.json(), { success: true, data: [], selected_month: selection, target_month: expected.label,
      ...(selection === 'next' ? { next_month: expected.label } : {}) });
    assert.deepEqual(calls.at(-1)[1], [expected.startDate, expected.endDate]);
  }
  const count = calls.length;
  assert.equal((await f.app.request('/new-assignments?month=invalid')).status, 400); assert.equal(calls.length, count); safe(f);
});

test('Google export preserves tutor sheets, student rows, formatting, columns and successful URL', async () => {
  const row = { student_id: marker, name: marker, homeroom_tutor: marker, handover_tutor_name: marker, notion_url: marker, discord_url: marker };
  let count = 0;
  const f = await fixture({ query: async () => ({ rows: count++ === 0 ? [row] : [] }) });
  const response = await f.app.request('/export', json({})); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.success, true); assert.equal(body.sheetCount, 2);
  assert.equal(body.spreadsheetId, marker); assert.equal(body.spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${marker}`);
  const writes = f.googleCalls.find(call => call[0] === 'values')[1];
  assert.equal(writes.resource.valueInputOption, 'USER_ENTERED');
  for (const value of writes.resource.data) assert.deepEqual(value.values, [['生徒名', '担当Tutor', '引き継ぎ先Tutor', 'Notionリンク', 'Discordリンク'], [marker, marker, marker, marker, marker]]);
  const formatting = f.googleCalls.filter(call => call[0] === 'batchUpdate')[1][1].resource.requests;
  assert.equal(formatting.filter(r => r.updateDimensionProperties).length, 10);
  assert.equal(formatting.filter(r => r.updateSheetProperties).length, 2); safe(f);
});

test('Google exceptions and malformed credentials remain private without live API access', async () => {
  const failed = await fixture({ google: { auth: { GoogleAuth: class { async getClient() { throw rawError(); } } } } });
  assert.deepEqual(await (await failed.app.request('/export', json({}))).json(), { success: false, error: 'Handover operation failed' }); safe(failed);
  for (const credential of ['{"private_key":"' + marker + '" invalid}', Buffer.from('{"private_key":"' + marker + '" invalid}').toString('base64')]) {
    const f = await fixture({ process: { env: { GOOGLE_CREDENTIALS_JSON: credential, HANDOVER_EXPORT_SHEET_ID: marker } } });
    const response = await f.app.request('/export', json({})); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Invalid credentials format' }); assert.equal(f.googleCalls.length, 0); safe(f);
  }
});
