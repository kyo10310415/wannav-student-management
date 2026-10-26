import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
const marker = 'SYNTHETIC_VQ_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, headers: { Authorization: marker } }, detail: marker });
const diagnosis = (rowNumber = 2) => ({ rowNumber, studentId: marker, totalScore: 81, diagnosisType: marker,
  overview: marker, details: marker, diagnosisDate: marker, snsAccuracy: 21, streamingAccuracy: 29, revenueAccuracy: 31 });
let sequence = 0;
async function fixture({ fail, enabled = true, results = [diagnosis()], lastRow = 2, missing = false, noDiscord = false } = {}) {
  const logs = [], queries = [], sends = [], updates = [], chartInputs = [], historyInputs = [], startRows = [];
  const errorAt = stage => { if (fail === stage) throw rawError(); };
  const deps = {
    dbQuery: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("setting_key = 'vq_diagnosis_notification_enabled'")) { errorAt('enabled'); return { rows: [{ setting_value: String(enabled) }] }; }
      if (sql.includes("setting_key = 'vq_diagnosis_last_checked_row'")) { errorAt('last-read'); return { rows: [{ setting_value: '1' }] }; }
      if (sql.includes('SELECT id, name, discord_url')) { errorAt('student'); return { rows: missing ? [] : [{ id: 7, name: marker, discord_url: noDiscord ? null : marker }] }; }
      if (sql.includes('SELECT image_url')) { errorAt('image'); return { rows: [{ image_url: marker }] }; }
      if (sql.includes('INSERT INTO system_settings')) errorAt('last-write');
      if (sql.includes('INSERT INTO vq_diagnosis_notifications')) { errorAt('save'); if (sql.includes('error_message')) errorAt('error-save'); }
      return { rows: [] };
    },
    fetchVQDiagnosisResults: async row => { startRows.push(row); errorAt('fetch'); return { results, lastRow }; },
    batchUpdateVQDiagnosisEmailStatus: async value => { updates.push(value); errorAt('sheet'); },
    fetchVQDiagnosisByStudentId: async value => { historyInputs.push(value); errorAt('history'); return [diagnosis(), diagnosis(3)]; },
    sendDiscordVQDiagnosis: async (...args) => { sends.push(args); errorAt('send'); return { id: marker }; },
    generateVQRadarChart: async value => { chartInputs.push(['radar', value]); errorAt('radar'); return Buffer.from('synthetic-radar'); },
    generateVQTrendChart: async value => { chartInputs.push(['trend', value]); errorAt('trend'); return Buffer.from('synthetic-trend'); },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))]))
  };
  const source = (await readFile(new URL('../src/jobs/vqDiagnosisChecker.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'vqDiagnosisPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const { dbQuery, fetchVQDiagnosisResults, batchUpdateVQDiagnosisEmailStatus, fetchVQDiagnosisByStudentId, sendDiscordVQDiagnosis, generateVQRadarChart, generateVQTrendChart, console } = globalThis[${JSON.stringify(key)}];\n`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`);
    return { run: module.checkAndSendVQDiagnosis, logs, queries, sends, updates, chartInputs, historyInputs, startRows };
  } finally { delete globalThis[key]; }
}
const privateLogs = f => assert.equal(f.logs.join('\n').includes(marker), false);
const lastUpdate = f => f.queries.find(q => q.sql.includes('INSERT INTO system_settings'));

test('successful diagnosis preserves Discord content, charts, database record and sheet completion', async () => {
  const f = await fixture();
  assert.deepEqual(await f.run(), { success: true, processed: 1, errors: 0, lastRow: 2 });
  assert.deepEqual(f.startRows, [2]); assert.deepEqual(f.historyInputs, [marker]);
  assert.deepEqual(f.chartInputs[0], ['radar', { snsAccuracy: 21, streamingAccuracy: 29, revenueAccuracy: 31 }]);
  assert.equal(f.chartInputs[1][0], 'trend'); assert.equal(f.chartInputs[1][1].length, 2);
  assert.equal(f.sends[0][0], marker);
  assert.equal(f.sends[0][1].content, `# 【VQ診断結果】\n\n## ・あなたのタイプ\n${marker}\n\n## ・概要\n__${marker}__\n\n## ・詳細\n__${marker}__\n\n---\n📅 診断日: ${marker}\n📊 合計点: 81点`);
  assert.deepEqual(f.sends[0][2], { radarChart: Buffer.from('synthetic-radar'), trendChart: Buffer.from('synthetic-trend'), typeImage: marker });
  const saved = f.queries.find(q => q.sql.includes('INSERT INTO vq_diagnosis_notifications'));
  assert.deepEqual(saved.params, [7, marker, 81, marker, marker, marker, marker, marker, 'sent', 2]);
  assert.deepEqual(f.updates, [[{ rowNumber: 2, value: '完了' }]]);
  assert.deepEqual(lastUpdate(f).params, ['2']); privateLogs(f);
});

test('top-level settings and Sheets failures return fixed error without provider metadata', async () => {
  for (const fail of ['enabled', 'last-read', 'fetch']) {
    const f = await fixture({ fail });
    assert.deepEqual(await f.run(), { success: false, error: 'VQ diagnosis processing failed', processed: 0, errors: 0 });
    assert.equal(f.sends.length, 0); privateLogs(f);
  }
});

test('per-diagnosis upstream failures keep error completion and database error text fixed', async () => {
  for (const fail of ['student', 'send', 'save']) {
    const f = await fixture({ fail });
    assert.deepEqual(await f.run(), { success: true, processed: 0, errors: 1, lastRow: 2 });
    assert.deepEqual(f.updates, [[{ rowNumber: 2, value: '完了（エラー: 診断処理に失敗しました）' }]]);
    const saved = f.queries.find(q => q.sql.includes('error_message'));
    assert.equal(saved.params[8], 'VQ diagnosis processing failed');
    assert.deepEqual(lastUpdate(f).params, ['2']); privateLogs(f);
  }
});

test('optional image, history and chart failures preserve partial-success send fallback', async () => {
  for (const fail of ['image', 'history', 'radar', 'trend']) {
    const f = await fixture({ fail });
    assert.deepEqual(await f.run(), { success: true, processed: 1, errors: 0, lastRow: 2 });
    const attachments = f.sends[0][2];
    assert.equal(attachments.typeImage, fail === 'image' ? null : marker);
    assert.deepEqual(attachments.radarChart, fail === 'radar' ? null : Buffer.from('synthetic-radar'));
    assert.deepEqual(attachments.trendChart, ['history', 'trend'].includes(fail) ? null : Buffer.from('synthetic-trend'));
    assert.deepEqual(f.updates, [[{ rowNumber: 2, value: '完了' }]]); privateLogs(f);
  }
});

test('sheet and last-row write errors remain nonfatal and do not expose upstream details', async () => {
  for (const fail of ['sheet', 'last-write']) {
    const f = await fixture({ fail });
    assert.deepEqual(await f.run(), { success: true, processed: 1, errors: 0, lastRow: 2 });
    assert.deepEqual(lastUpdate(f).params, ['2']); privateLogs(f);
  }
});

test('missing student and Discord URL preserve business completion labels and suppress sends', async () => {
  for (const [options, value, message] of [[{ missing: true }, '完了（生徒不明）', '生徒が見つかりません'],
    [{ noDiscord: true }, '完了（Discord URL未設定）', 'Discord URLが設定されていません']]) {
    const f = await fixture(options);
    assert.deepEqual(await f.run(), { success: true, processed: 0, errors: 1, lastRow: 2 });
    assert.equal(f.sends.length, 0); assert.deepEqual(f.updates, [[{ rowNumber: 2, value }]]);
    assert.equal(f.queries.find(q => q.sql.includes('error_message')).params[8], message); privateLogs(f);
  }
});

test('error-record failures do not stop later diagnoses or leak exceptions', async () => {
  const f = await fixture({ missing: true, fail: 'error-save', results: [diagnosis(2), diagnosis(3)], lastRow: 3 });
  assert.deepEqual(await f.run(), { success: true, processed: 0, errors: 4, lastRow: 3 });
  assert.equal(f.updates[0].length, 4); assert.deepEqual(lastUpdate(f).params, ['3']); privateLogs(f);
});

test('disabled and empty batches preserve early responses and last-row reconciliation', async () => {
  const off = await fixture({ enabled: false });
  assert.deepEqual(await off.run(), { success: false, message: 'システムがOFFです', processed: 0 });
  assert.equal(off.startRows.length, 0); assert.equal(off.queries.length, 1);
  const empty = await fixture({ results: [], lastRow: 4 });
  assert.deepEqual(await empty.run(), { success: true, message: '新規診断結果なし', processed: 0, errors: 0 });
  assert.deepEqual(lastUpdate(empty).params, ['4']); assert.equal(empty.sends.length, 0); privateLogs(empty);
});
