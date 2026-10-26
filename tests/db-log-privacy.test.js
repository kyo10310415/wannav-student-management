import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { inspect } from 'node:util';
import { getQueryLogMetadata, privateDatabaseError } from '../src/db/private-errors.js';

const marker = 'SYNTHETIC_PRIVATE_DB_DATA';
const variants = [
  { file: 'connection.js', query: 'query', client: 'getClient', pool: 'getPool', fatalIdle: true },
  { file: 'extensionConnection.js', query: 'queryExtension', client: 'getExtensionClient', pool: 'getExtensionPool' },
  { file: 'externalConnection.js', query: 'queryExternal', client: 'getExternalClient', pool: 'getExternalPool' },
];
function providerError(code = '23505') {
  return Object.assign(new Error(marker), { code, detail: marker, query: marker, params: [marker],
    config: { password: marker }, cause: new Error(marker), constraint: marker, table: marker });
}
async function fixture(variant, { queryError, connectError, constructorError, configured = true, env = {} } = {}) {
  const logs = [], queries = [], configurations = [], exits = [], handlers = new Map();
  const result = { rows: [{ private: marker }], rowCount: 1 };
  const client = { query() {}, release() {} };
  let allocations = 0, connects = 0;
  class Pool {
    constructor(config) { allocations++; if (constructorError) throw constructorError; configurations.push(config); }
    on(name, fn) { handlers.set(name, fn); }
    async query(...args) { queries.push(args); if (queryError) throw queryError; return result; }
    async connect() { connects++; if (connectError) throw connectError; return client; }
  }
  const environment = { ...(configured ? { DATABASE_URL: 'fixture', EXTENSION_DATABASE_URL: 'fixture', EXTERNAL_DATABASE_URL: 'fixture' } : {}), ...env };
  let source = await readFile(new URL('../src/db/' + variant.file, import.meta.url), 'utf8');
  source = source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '');
  const api = vm.runInNewContext(`(() => { ${source}; return { ${variant.query}, ${variant.client}, ${variant.pool} }; })()`, {
    pg: { Pool }, process: { env: environment, exit: code => exits.push(code) }, Date,
    console: Object.fromEntries(['log', 'error', 'warn'].map(level => [level, (...args) => logs.push(inspect(args))])),
    getDatabaseConfig: (...args) => ({ fixtureConfig: args }), getQueryLogMetadata, privateDatabaseError,
  });
  return { api, logs, queries, result, client, configurations, exits, handlers,
    allocations: () => allocations, connects: () => connects };
}

test('DB helpers preserve SQL/parameters, returned data and cached pools while logging metadata only', async () => {
  for (const variant of variants) {
    const f = await fixture(variant);
    const sql = `SELECT '${marker}' AS private_value`;
    const params = [marker];
    assert.equal(await f.api[variant.query](sql, params), f.result);
    assert.equal(await f.api[variant.query](sql, params), f.result);
    assert.equal(f.queries[0][0], sql);
    assert.equal(f.queries[0][1], params);
    assert.equal(f.allocations(), 1);
    assert.ok(f.logs.some(line => line.includes('SELECT')));
    assert.equal(f.logs.join('\n').includes(marker), false);
    assert.equal(f.logs.join('\n').includes('private_value'), false);
    assert.equal(await f.api[variant.client](), f.client);
  }
});

test('query failures preserve SQLSTATE while suppressing every provider detail in logs and public errors', async () => {
  for (const variant of variants) {
    const original = providerError();
    const f = await fixture(variant, { queryError: original });
    let surfaced;
    await assert.rejects(f.api[variant.query](`INSERT INTO fixture VALUES ('${marker}')`, [marker]), error => { surfaced = error; return error.code === '23505'; });
    assert.notEqual(surfaced, original);
    assert.equal(inspect(surfaced).includes(marker), false);
    assert.equal(f.logs.join('\n').includes(marker), false);
    for (const field of ['cause', 'detail', 'query', 'params', 'config', 'constraint', 'table']) assert.equal(Object.hasOwn(surfaced, field), false);
  }
});

test('acquisition and construction errors return safe messages with canonical network codes', async () => {
  for (const variant of variants) {
    const f = await fixture(variant, { connectError: providerError('ECONNRESET') });
    await assert.rejects(f.api[variant.client](), error => error.code === 'ECONNRESET' && !inspect(error).includes(marker));
    const broken = await fixture(variant, { constructorError: providerError('ECONNREFUSED') });
    assert.throws(() => broken.api[variant.pool](), error => error.code === 'ECONNREFUSED' && !inspect(error).includes(marker));
    assert.equal(f.logs.join('\n').includes(marker), false);
  }
});

test('idle failures reveal no details and preserve the primary pool exit behavior', async () => {
  for (const variant of variants) {
    const f = await fixture(variant);
    f.api[variant.pool]();
    f.handlers.get('error')(providerError());
    assert.equal(f.logs.join('\n').includes(marker), false);
    assert.deepEqual(f.exits, variant.fatalIdle ? [-1] : []);
  }
});

test('optional DB absence and production logging controls retain their behavior', async () => {
  for (const variant of variants.slice(1)) {
    const f = await fixture(variant, { configured: false });
    assert.equal(f.api[variant.pool](), null);
    await assert.rejects(f.api[variant.query]('SELECT 1'), /database not configured/);
    await assert.rejects(f.api[variant.client](), /database not configured/);
    assert.equal(f.allocations(), 0);
  }
  const quiet = await fixture(variants[0], { env: { NODE_ENV: 'production', DB_SLOW_QUERY_MS: '99999999' } });
  await quiet.api.query('SELECT 1');
  assert.equal(quiet.logs.length, 0);
  const verbose = await fixture(variants[0], { env: { NODE_ENV: 'production', DB_QUERY_LOGGING: 'true' } });
  await verbose.api.query(`SELECT '${marker}'`);
  assert.equal(verbose.logs.length, 1);
  assert.equal(verbose.logs.join('\n').includes(marker), false);
});

test('operation and error metadata use bounded safe categories', () => {
  assert.deepEqual(getQueryLogMetadata('SELECT secret', 3, 7), { operation: 'SELECT', duration: 3, rows: 7 });
  for (const sql of [marker, '/* ' + marker + ' */ SELECT 1', { text: marker }, null]) {
    const metadata = getQueryLogMetadata(sql, marker, marker);
    assert.deepEqual(metadata, { operation: 'OTHER', duration: 0 });
  }
  assert.equal(Object.hasOwn(privateDatabaseError(providerError(marker), 'Database query failed'), 'code'), false);
});
