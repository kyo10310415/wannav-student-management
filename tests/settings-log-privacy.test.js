import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_PRIVATE_SETTING';
let sequence = 0;
async function fixture(query) {
  const logs = [], queries = [];
  const deps = { Hono, getPool: () => ({ query: async (...args) => { queries.push(args); return query(...args); } }),
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  const source = (await readFile(new URL('../src/routes/settings.js', import.meta.url), 'utf8'))
    .replace("import { Hono } from 'hono';", 'const Hono = deps.Hono;')
    .replace("import { getPool } from '../db/connection.js';", 'const getPool = deps.getPool;');
  const key = 'settingsPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, queries };
}
const update = value => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, updatedBy: marker }) });

test('settings success preserves values and SQL parameters without logging setting content', async () => {
  const row = { setting_key: marker, setting_value: marker, updated_by: marker };
  const f = await fixture(async () => ({ rows: [row] }));
  for (const [path, options, data] of [['/' + marker, undefined, row], ['/', undefined, [row]], ['/' + marker, update(marker), row]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data });
  }
  assert.deepEqual(f.queries[0][1], [marker]);
  assert.deepEqual(f.queries[2][1], [marker, marker, marker]);
  assert.equal(f.logs.join('\n').includes(marker), false);
});

test('raw pool failures never expose provider data in settings responses or logs', async () => {
  const f = await fixture(async () => { throw Object.assign(new Error(marker), { detail: marker, query: marker, config: { password: marker } }); });
  for (const [path, options] of [['/fixture', undefined], ['/', undefined], ['/fixture', update(marker)]]) {
    const response = await f.app.request(path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Settings operation failed' });
  }
  assert.equal(f.logs.join('\n').includes(marker), false);
});

test('settings missing and validation responses retain their status and avoid unnecessary queries', async () => {
  const f = await fixture(async () => ({ rows: [] }));
  for (const options of [undefined, update(false)]) {
    const response = await f.app.request('/fixture', options);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'Setting not found');
  }
  const invalid = await f.app.request('/fixture', update(undefined));
  assert.equal(invalid.status, 400);
  assert.equal(f.queries.length, 2);
});
