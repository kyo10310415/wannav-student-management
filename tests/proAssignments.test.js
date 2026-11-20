import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProCurricula, createProAssignmentLoader } from '../src/services/proAssignmentService.js';
test('curricula match student ID, split commas and use the last response including blanks', () => {
  const map = buildProCurricula([[' a ', 'ゲーム, 雑談，歌'], ['A', '配信, 動画'], ['B', '以前'], ['B', ''], ['', '無効']]);
  assert.deepEqual(map.get('A'), ['配信', '動画']); assert.deepEqual(map.get('B'), []); assert.equal(map.size, 2);
});
test('loader deduplicates, joins handover values, preserves missing central students and shares reads', async () => {
  let requests = 0; const calls = [];
  const now = () => new Date('2026-11-20T00:00:00Z');
  const load = createProAssignmentLoader({ now,
    env: { EXTENSION_TARGETS_API_URL: 'https://example.com/api/monthly-targets/current', EXTENSION_TARGETS_READ_TOKEN: 'synthetic' },
    request: async (url, options) => { requests++; assert.equal(url.pathname, '/api/monthly-targets/pro-assignments'); assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ success: true, month: '2026-11', data: [{ studentId: 'A' }, { studentId: 'A' }, { studentId: 'B', name: '未同期' }] }) }; },
    sheets: () => ({ spreadsheets: { values: { get: async options => { calls.push(options); return { data: { values: [['A', '配信,動画']] } }; } } } }),
    db: async (sql, args) => { assert.deepEqual(args, [['A', 'B']]); return { rows: [{ student_id: 'A', name: '中央', handover_tutor_name: '先生' }] }; },
  });
  const [a, b] = await Promise.all([load(), load()]); assert.deepEqual(a, b); assert.equal(requests, 1);
  assert.equal(a.data.length, 2); assert.equal(a.data[0].handover_tutor_name, '先生');
  assert.deepEqual(a.data[0].desired_curricula, ['配信', '動画']); assert.equal(a.data[1].can_assign, false);
  assert.equal(calls[0].range, "'PROプランお申し込みフォーム回答'!D2:E");
  load.clear(); await load(); assert.equal(requests, 2);
});
test('unavailable source does not become a cached empty list', async () => {
  let requests = 0;
  const load = createProAssignmentLoader({ env: { EXTENSION_TARGETS_API_URL: 'https://example.com/api/monthly-targets/current', EXTENSION_TARGETS_READ_TOKEN: 'synthetic' },
    request: async () => { requests++; return { ok: false }; }, sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: {} }) } } }) });
  await assert.rejects(load()); await assert.rejects(load()); assert.equal(requests, 2);
});
