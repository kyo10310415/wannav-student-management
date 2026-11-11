import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMonthlyExtensionTargets } from '../src/services/extensionTargetsService.js';
import { readFile } from 'node:fs/promises';

const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date());
const env = token => ({ EXTENSION_TARGETS_API_URL: 'https://example.com/api/monthly-targets/current', EXTENSION_TARGETS_READ_TOKEN: token });
test('today badges distinguish target types, non-targets and lookup failures', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function renderTodayExtensionTargets('), source.indexOf('function renderTodayStudentRows('));
  const render = new Function(`${code}; return renderTodayExtensionTargets;`)();
  const map = new Map([['TEST', { examination: [1], hearing: [4] }]]);
  assert.match(render('TEST', map), /今月延長審査対象（1回目）/);
  assert.match(render('TEST', map), /今月ヒアリング対象（4回目）/);
  assert.equal(render('OTHER', map), '');
  assert.match(render('OTHER', null), /対象情報未取得/);
});
test('simultaneous target reads share one request and cache the current month', async () => {
  let calls = 0;
  const value = { success: true, month, data: [{ studentId: 'TEST', examination: [1], hearing: [4] }] };
  const fake = async (url, options) => { calls++; assert.equal(options.headers.Authorization, 'Bearer test-token'); assert.equal(options.redirect, 'error'); return { ok: true, json: async () => value }; };
  const results = await Promise.all(Array.from({ length: 20 }, () => fetchMonthlyExtensionTargets(fake, env('test-token'))));
  assert.equal(calls, 1);
  results.forEach(r => assert.deepEqual(r, value));
  assert.deepEqual(await fetchMonthlyExtensionTargets(fake, env('test-token')), value);
  assert.equal(calls, 1);
});
test('missing configuration, HTTP errors, wrong month and invalid rounds fail closed', async () => {
  await assert.rejects(fetchMonthlyExtensionTargets(null, {}));
  await assert.rejects(fetchMonthlyExtensionTargets(async () => ({ ok: false }), env('failure')));
  for (const value of [{ success: true, month: '2000-01', data: [] }, { success: true, month, data: [{ studentId: 'TEST', examination: ['<script>'], hearing: [] }] }]) {
    await assert.rejects(fetchMonthlyExtensionTargets(async () => ({ ok: true, json: async () => value }), env('invalid')));
  }
});
