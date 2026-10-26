import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
const marker = 'SYNTHETIC_SUSPENSION_PRIVATE';
let sequence = 0;
async function fixture(fetch) {
  const logs = []; let calls = 0;
  const deps = { Hono, fetchSuspensionData: async () => { calls++; return fetch(); },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/suspensions.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const key = 'suspensionsPrivacyFixture' + sequence++; globalThis[key] = deps;
  try {
    const prefix = `const { Hono, fetchSuspensionData, console } = globalThis[${JSON.stringify(key)}];\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, calls: () => calls };
  } finally { delete globalThis[key]; }
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('suspension success retains all returned fields and counts without logging record data', async () => {
  for (const rows of [[{ student_id: marker, name: marker, suspension_reason: marker }], []]) {
    const f = await fixture(async () => rows); const response = await f.app.request('/');
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true, data: rows, count: rows.length });
    assert.equal(f.calls(), 1); safe(f);
  }
});

test('upstream failures retain successful empty fallback while hiding error message, code and status', async () => {
  const f = await fixture(async () => { throw Object.assign(new Error(marker), { code: marker, status: marker, config: { credentials: marker } }); });
  const response = await f.app.request('/'); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: [], count: 0, cache_error: true, cache_error_message: 'Suspension data could not be loaded' });
  safe(f);
});

test('outer serialization failures retain fixed 500 response without personal record contents', async () => {
  const circular = { name: marker }; circular.self = circular;
  const f = await fixture(async () => [circular]); const response = await f.app.request('/');
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { success: false, error: 'Suspension data could not be loaded' }); safe(f);
});

test('invalid null source data retains the existing inner failure fallback', async () => {
  const f = await fixture(async () => null); const response = await f.app.request('/');
  assert.equal(response.status, 200); assert.equal((await response.json()).cache_error, true); safe(f);
});
