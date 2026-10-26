import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import crypto from 'node:crypto';
const marker = 'SYNTHETIC_CHART_PRIVATE';
let sequence = 0;
async function fixture({ fail = false } = {}) {
  const logs = [], configurations = [], options = [];
  const error = Object.assign(new Error(marker), { config: { secret: marker } });
  const deps = { crypto, console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])), ChartJSNodeCanvas: class { constructor(value) { options.push(value); } async renderToBuffer(configuration) { configurations.push(configuration); if (fail) throw error; return Buffer.from('fixture-image'); } } };
  const source = (await readFile(new URL('../src/services/chartService.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'chartPrivacy' + sequence++;
  globalThis[key] = deps;
  try { return { module: await import('data:text/javascript;base64,' + Buffer.from(`const { crypto, console, ChartJSNodeCanvas } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')), logs, configurations, options, error }; }
  finally { delete globalThis[key]; }
}
test('both chart failures preserve the same error without logging provider details', async () => {
  const f = await fixture({ fail: true });
  await assert.rejects(f.module.generateVQRadarChart({ snsAccuracy: 50 }), error => error === f.error);
  await assert.rejects(f.module.generateVQTrendChart([{ diagnosisDate: '2026-10-01' }, { diagnosisDate: '2026-10-02' }]), error => error === f.error);
  assert.equal(f.logs.join('\n').includes(marker), false);
});
test('radar payload defaulting and cache reuse preserve image bytes without cache identifiers in logs', async () => {
  const f = await fixture(); const data = { snsAccuracy: 42, streamingAccuracy: 0, private: marker };
  const first = await f.module.generateVQRadarChart(data);
  const second = await f.module.generateVQRadarChart(data);
  assert.equal(first, second); assert.equal(f.configurations.length, 1);
  assert.deepEqual(f.configurations[0].data.datasets[0].data, [42, 0, 0]);
  assert.equal(f.options[0].width, 500);
  const hash = crypto.createHash('md5').update(JSON.stringify({ type: 'radar', data })).digest('hex');
  assert.equal(f.logs.join('\n').includes(hash), false); assert.equal(f.logs.join('\n').includes(marker), false);
});
test('trend minimum history and chronological dataset mapping remain intact', async () => {
  const f = await fixture();
  assert.equal(await f.module.generateVQTrendChart([]), null);
  assert.equal(await f.module.generateVQTrendChart([{}]), null);
  const rows = [{ diagnosisDate: '2026-10-02', snsAccuracy: 80 }, { diagnosisDate: '2026-10-01', snsAccuracy: 20 }];
  assert.equal((await f.module.generateVQTrendChart(rows)).toString(), 'fixture-image');
  assert.deepEqual(f.configurations[0].data.datasets[0].data, [20, 80]);
  assert.equal(rows[0].diagnosisDate, '2026-10-02');
});
