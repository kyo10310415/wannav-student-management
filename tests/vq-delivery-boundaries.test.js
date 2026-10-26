import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
const marker = 'SYNTHETIC_VQ_DELIVERY_PRIVATE';
let sequence = 0;
async function fixture({ sendResult = { success: true, id: 'synthetic-message' }, sendError = false, returnUndefined = false, records = true, discordUrl = marker } = {}) {
  const queries = [], sends = [], logs = [], checks = [];
  const diagnosis = { student_name: marker, total_score: 81, diagnosis_type: marker, overview: marker, details: marker, discord_url: discordUrl };
  const deps = { Hono, cors, dbQuery: async (sql, params) => { queries.push({ sql, params }); return { rows: sql.includes('SELECT vqd.*') ? (records ? [diagnosis] : []) : [] }; },
    sendDiscordVQDiagnosis: async (...args) => { sends.push(args); if (sendError) throw Object.assign(new Error(marker), { config: { url: marker } }); return returnUndefined ? undefined : sendResult; },
    fetchVQDiagnosisByStudentId: async () => { throw new Error('Unexpected Sheets call'); },
    checkerModule: { default: async (...args) => { checks.push(args); return { success: true, processed: 2 }; } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/vq-diagnosis.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '')
    .replaceAll("await import('../jobs/vqDiagnosisChecker.js')", 'deps.checkerModule');
  const key = 'vqDeliveryBoundaryFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const deps = globalThis[${JSON.stringify(key)}]; const { Hono, cors, dbQuery, sendDiscordVQDiagnosis, fetchVQDiagnosisByStudentId, console } = deps;\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, queries, sends, logs, checks };
  } finally { delete globalThis[key]; }
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
const writes = f => f.queries.filter(q => /^UPDATE/.test(q.sql.trim()));

test('failed and malformed notification results never mark a diagnosis sent or clear its previous error', async () => {
  for (const sendResult of [{ success: false, error: marker }, { success: false, reason: marker }, null, undefined, {}, { success: 'true' }, { success: 1 }]) {
    const f = await fixture({ sendResult, returnUndefined: sendResult === undefined });
    const response = await f.app.request('/resend/42', post({}));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'VQ diagnosis operation failed' });
    assert.equal(f.sends.length, 1); assert.equal(f.sends[0][0], marker); assert.equal(writes(f).length, 0);
    assert.equal(f.queries.length, 1); safe(f);
  }
});

test('successful resend retains payload, destination, SQL and successful response', async () => {
  const f = await fixture(); const response = await f.app.request('/resend/42', post({}));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true, message: '再送信しました' });
  assert.equal(f.sends[0][0], marker);
  assert.equal(f.sends[0][1].content, 'お疲れ様です！\n\n**VQ診断の結果が出ました！**');
  assert.equal(f.sends[0][1].embeds[0].fields[1].value, `**${marker}**`);
  assert.equal(writes(f).length, 1); assert.deepEqual(writes(f)[0].params, ['synthetic-message', '42']);
  assert.match(writes(f)[0].sql, /status = 'sent',[\s\S]*error_message = NULL/); safe(f);
});

test('thrown notification errors and missing records or destinations preserve their failure boundaries', async () => {
  for (const [options, status] of [[{ sendError: true }, 500], [{ records: false }, 404], [{ discordUrl: null }, 400]]) {
    const f = await fixture(options); const response = await f.app.request('/resend/42', post({}));
    assert.equal(response.status, status); assert.equal((await response.json()).success, false);
    assert.equal(writes(f).length, 0); assert.equal(f.sends.length, options.sendError ? 1 : 0); safe(f);
  }
});

test('existing first row-range handler remains the only reachable duplicate and preserves cursor-before-check', async () => {
  const f = await fixture(); const response = await f.app.request('/resend-from-row', post({ startRow: 3 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: '行 3 からの再送信を開始しました', result: { success: true, processed: 2 } });
  assert.equal(writes(f).length, 1); assert.deepEqual(writes(f)[0].params, ['2']);
  assert.match(writes(f)[0].sql, /vq_diagnosis_last_checked_row/);
  assert.deepEqual(f.checks, [[]]); safe(f);
});

test('omitting or invalidating startRow retains first-handler validation rather than the unreachable default', async () => {
  for (const body of [{}, { startRow: 0 }, { startRow: 1 }]) {
    const f = await fixture(); const response = await f.app.request('/resend-from-row', post(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, '有効な開始行番号を指定してください（2以上）');
    assert.equal(f.queries.length, 0); assert.equal(f.checks.length, 0); safe(f);
  }
});
