import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
const marker = 'SYNTHETIC_VQ_ROUTE_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, credentials: marker }, detail: marker });
const record = { rowNumber: 3, studentId: marker, diagnosisDate: '2026-10-26', totalScore: 81, diagnosisType: marker, overview: marker.repeat(30), details: marker.repeat(40),
  snsAccuracy: 20, streamingAccuracy: 30, revenueAccuracy: 31, typeAScore: 1, typeQScore: 2, typeVQScore: 3, emailSent: '完了' };
let sequence = 0;
async function fixture({ fail, queryOverride, records = [record] } = {}) {
  const logs = [], queries = [], sends = [], sheetCalls = [], chartCalls = [], checks = [];
  const errorAt = stage => { if (fail === stage || fail === 'all') throw rawError(); };
  const deps = { Hono, cors,
    dbQuery: async (sql, params) => {
      queries.push({ sql, params }); errorAt('db'); if (queryOverride) return queryOverride(sql, params);
      if (sql.includes('SELECT image_url')) { errorAt('image'); return { rows: [{ image_url: marker }] }; }
      if (sql.includes('SELECT id, name, discord_url')) return { rows: [{ id: 7, name: marker, discord_url: marker }] };
      if (sql.includes('SELECT name FROM students')) return { rows: [{ name: marker }] };
      if (sql.includes('SELECT vqd.*')) return { rows: [{ id: 42, student_name: marker, discord_url: marker, total_score: 81, diagnosis_type: marker, overview: marker, details: marker }] };
      return { rows: [{ id: 42, setting_value: 'true', diagnosis_type: marker, image_url: marker, student_name: marker, diagnosis_date: '2026-10-26' }] };
    }, sendDiscordVQDiagnosis: async (...args) => { sends.push(args); errorAt('send'); return fail === 'send-result' ? { success: false, error: marker } : { success: true, id: marker, messageId: marker }; },
    fetchVQDiagnosisByStudentId: async value => { sheetCalls.push(['history', value]); errorAt('history'); return [record, record]; },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  deps.sheetsModule = {
    fetchVQDiagnosisResults: async (...args) => { sheetCalls.push(['results', ...args]); errorAt('sheets'); return { results: records }; },
    fetchVQDiagnosisByStudentId: deps.fetchVQDiagnosisByStudentId,
    updateVQDiagnosisEmailStatus: async (...args) => { sheetCalls.push(['update', ...args]); errorAt('sheet-update'); }
  };
  deps.chartModule = { generateVQRadarChart: async value => { chartCalls.push(['radar', value]); errorAt('radar'); return Buffer.from('radar'); },
    generateVQTrendChart: async value => { chartCalls.push(['trend', value]); errorAt('trend'); return Buffer.from('trend'); } };
  deps.checkerModule = { default: async () => { checks.push(true); errorAt('checker'); return { success: true, processed: 1 }; } };
  const source = (await readFile(new URL('../src/routes/vq-diagnosis.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '')
    .replaceAll("await import('../services/sheetsService.js')", 'deps.sheetsModule')
    .replaceAll("await import('../services/chartService.js')", 'deps.chartModule')
    .replaceAll("await import('../jobs/vqDiagnosisChecker.js')", 'deps.checkerModule');
  const key = 'vqRoutesPrivacyFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const deps = globalThis[${JSON.stringify(key)}]; const { Hono, cors, dbQuery, sendDiscordVQDiagnosis, fetchVQDiagnosisByStudentId, console } = deps;\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, queries, sends, sheetCalls, chartCalls, checks };
  } finally { delete globalThis[key]; }
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('all reachable route exception boundaries return fixed errors and conceal provider data', async () => {
  const f = await fixture({ fail: 'all' });
  for (const [path, options] of [['/status'], ['/toggle', json({ enabled: true })], ['/check', json({})], ['/history'], ['/student/' + marker],
    ['/resend-from-row', json({ startRow: 3 })], ['/resend/42', json({})], ['/images'], ['/images', json({ diagnosis_type: marker, image_url: marker })],
    ['/images/42', { method: 'DELETE' }], ['/test', json({ channelUrl: marker, userId: marker })], ['/resend-single-row', json({ rowNumber: 3 })], ['/history/42', { method: 'DELETE' }]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'VQ diagnosis operation failed' });
  }
  safe(f);
});

test('status, toggle, history and checker retain successful data and row-resend ordering', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/status')).json(), { success: true, enabled: true });
  assert.deepEqual(await (await f.app.request('/toggle', json({ enabled: false }))).json(), { success: true, enabled: false });
  assert.deepEqual(f.queries.at(-1).params, ['false']);
  const history = await (await f.app.request('/history?student_id=' + marker + '&limit=3')).json();
  assert.equal(history.success, true); assert.equal(history.count, 1); assert.deepEqual(f.queries.at(-1).params, [marker, '3']);
  assert.deepEqual(await (await f.app.request('/check', json({}))).json(), { success: true, processed: 1 });
  const resend = await (await f.app.request('/resend-from-row', json({ startRow: 3 }))).json();
  assert.equal(resend.success, true); assert.equal(resend.result.processed, 1);
  assert.deepEqual(f.queries.at(-1).params, ['2']); assert.equal(f.checks.length, 2); safe(f);
});

test('student history preserves diagnosis, scoring and sent-state mapping', async () => {
  const f = await fixture(); const body = await (await f.app.request('/student/' + marker)).json();
  assert.equal(body.studentId, marker); assert.equal(body.count, 2);
  assert.deepEqual(body.history[0], { student_name: marker, diagnosis_date: record.diagnosisDate, total_score: 81, sns_score: 1, streaming_score: 2, revenue_score: 3,
    sns_accuracy: 20, streaming_accuracy: 30, revenue_accuracy: 31, diagnosis_type: marker, overview: record.overview, details: record.details, status: 'sent', sent_at: record.diagnosisDate, sheet_row_number: 3 }); safe(f);
});

test('image CRUD and history deletion preserve successful fields and parameter binding', async () => {
  const f = await fixture();
  assert.equal((await (await f.app.request('/images')).json()).success, true);
  const saved = await (await f.app.request('/images', json({ diagnosis_type: marker, image_url: marker }))).json();
  assert.equal(saved.image.image_url, marker); assert.deepEqual(f.queries.at(-1).params, [marker, marker]);
  assert.equal((await f.app.request('/images/42', { method: 'DELETE' })).status, 200);
  const deleted = await (await f.app.request('/history/42', { method: 'DELETE' })).json();
  assert.equal(deleted.deleted.student_name, marker); assert.deepEqual(f.queries.at(-1).params, ['42']); safe(f);
});

test('test send preserves selected diagnosis, charts, mention and truncated content', async () => {
  const f = await fixture(); const response = await f.app.request('/test', json({ channelUrl: marker, userId: marker }));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.data.studentId, marker); assert.equal(body.data.hasRadarChart, true); assert.equal(body.data.hasTrendChart, true); assert.equal(body.data.hasTypeImage, true);
  assert.equal(f.sends[0][0], marker); assert.equal(f.sends[0][1].content.includes(`<@${marker}>`), true);
  assert.equal(f.sends[0][1].content.includes(record.overview.substring(0, 500)), true);
  assert.deepEqual(f.sends[0][2], { radarChart: Buffer.from('radar'), trendChart: Buffer.from('trend'), typeImage: marker });
  assert.deepEqual(f.sheetCalls[0], ['results', 2]); safe(f);
});

test('optional history/image/chart failures retain partial test-send success', async () => {
  for (const fail of ['history', 'image', 'radar', 'trend']) {
    const f = await fixture({ fail }); const response = await f.app.request('/test', json({ channelUrl: marker }));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.data.hasRadarChart, fail !== 'radar');
    assert.equal(body.data.hasTrendChart, !['history', 'trend'].includes(fail)); assert.equal(body.data.hasTypeImage, fail !== 'image'); safe(f);
  }
});

test('single-row resend keeps sheet completion, notification record and failure-before-write ordering', async () => {
  const f = await fixture(); const response = await f.app.request('/resend-single-row', json({ rowNumber: 3 }));
  assert.equal(response.status, 200); assert.equal((await response.json()).data.studentName, marker);
  assert.deepEqual(f.sheetCalls[0], ['results', 3, 3, true]); assert.deepEqual(f.sheetCalls.at(-1), ['update', 3, '完了']);
  assert.deepEqual(f.queries.at(-1).params, [7, marker, 81, marker, record.overview, record.details, record.diagnosisDate, 'sent', 3, marker]); safe(f);
  for (const path of ['/test', '/resend-single-row']) {
    const failed = await fixture({ fail: 'send-result' });
    const result = await failed.app.request(path, json(path === '/test' ? { channelUrl: marker } : { rowNumber: 3 }));
    assert.equal(result.status, 500); assert.deepEqual(await result.json(), { success: false, error: 'VQ diagnosis operation failed' });
    assert.equal(failed.sheetCalls.some(call => call[0] === 'update'), false); assert.equal(failed.queries.some(q => q.sql.includes('INSERT INTO vq_diagnosis_notifications')), false); safe(failed);
  }
});

test('record resend retains destination and clears prior error after notification', async () => {
  const f = await fixture(); assert.equal((await f.app.request('/resend/42', json({}))).status, 200);
  assert.equal(f.sends[0][0], marker); assert.equal(f.sends[0][1].embeds[0].fields[1].value, `**${marker}**`);
  assert.match(f.queries.at(-1).sql, /error_message = NULL/); assert.deepEqual(f.queries.at(-1).params, [marker, '42']); safe(f);
});

test('existing validation, missing data and invalid test URL type keep their statuses', async () => {
  const f = await fixture();
  for (const [path, body] of [['/resend-from-row', { startRow: 1 }], ['/resend-single-row', { rowNumber: 1 }], ['/images', {}], ['/test', {}]]) assert.equal((await f.app.request(path, json(body))).status, 400);
  const badType = await f.app.request('/test', json({ channelUrl: {} })); assert.equal(badType.status, 500); assert.equal(f.sheetCalls.length, 0);
  const empty = await fixture({ records: [], queryOverride: async () => ({ rows: [] }) });
  for (const [path, options] of [['/resend/42', json({})], ['/images/42', { method: 'DELETE' }], ['/history/42', { method: 'DELETE' }], ['/test', json({ channelUrl: marker })], ['/resend-single-row', json({ rowNumber: 3 })]]) assert.equal((await empty.app.request(path, options)).status, 404);
  safe(f); safe(empty);
});
