import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { getDatabaseConfig } from '../src/db/connection-config.cjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const url = 'postgresql://fixture:fixture-only@database.example/fixture';
function parameters(target, env) {
  // Real pg parsing, without connecting or sending credentials.
  return new pg.Client(getDatabaseConfig(target, env)).connectionParameters;
}

test('external DBs retain TLS certificate validation after pg parses URL flags', () => {
  for (const query of ['', '?sslmode=disable', '?sslmode=no-verify', '?ssl=false',
    '?ssl=0', '?sslmode=require&uselibpqcompat=true']) {
    const parsed = parameters(url + query, { RENDER: 'true' });
    assert.equal(parsed.ssl.rejectUnauthorized, true, query);
    assert.equal(parsed.ssl.checkServerIdentity, undefined, query);
    assert.equal(parsed.host, 'database.example');
  }
});

test('CA and mTLS file settings survive without replacing strict verification', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.db-tls-fixture-'));
  try {
    const target = new URL(url);
    for (const [parameter, value] of [['sslrootcert', 'SYNTHETIC_CA'], ['sslcert', 'SYNTHETIC_CERT'], ['sslkey', 'SYNTHETIC_KEY']]) {
      const file = join(directory, parameter);
      await writeFile(file, value);
      target.searchParams.set(parameter, file);
    }
    target.searchParams.set('sslmode', 'no-verify');
    const parsed = parameters(target.toString(), {});
    assert.equal(parsed.ssl.ca, 'SYNTHETIC_CA');
    assert.equal(parsed.ssl.cert, 'SYNTHETIC_CERT');
    assert.equal(parsed.ssl.key, 'SYNTHETIC_KEY');
    assert.equal(parsed.ssl.rejectUnauthorized, true);
    assert.equal(parsed.ssl.checkServerIdentity, undefined);
    assert.throws(() => getDatabaseConfig(url + '?sslrootcert=not-a-real-file', {}), { message: 'Invalid PostgreSQL TLS certificate configuration' });
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(process.cwd()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('only Render short internal Postgres names permit self-signed certificates', () => {
  const internal = 'postgresql://fixture:fixture-only@dpg-fixture123-a/fixture';
  assert.equal(parameters(internal, { RENDER: 'true' }).ssl.rejectUnauthorized, false);
  assert.equal(parameters(internal, {}).ssl.rejectUnauthorized, true);
  for (const host of ['dpg-fixture123-a.example', 'dpg-fixture123-a.render.com', 'localhost', '127.0.0.1', 'other-internal']) {
    assert.equal(parameters(url.replace('database.example', host), { RENDER: 'true' }).ssl.rejectUnauthorized, true, host);
  }
});

test('Render internal TLS cannot be disabled by URL parameters', () => {
  const parsed = parameters('postgresql://fixture:fixture-only@dpg-fixture123-a/fixture?sslmode=disable&ssl=0', { RENDER: 'true' });
  assert.equal(typeof parsed.ssl, 'object');
  assert.equal(parsed.ssl.rejectUnauthorized, false);
});

test('query target overrides, invalid URLs and global bypass fail without disclosing input', () => {
  for (const target of ['SYNTHETIC_SECRET', 'https://fixture:fixture-only@database.example/', url + '?host=other.example']) {
    assert.throws(() => getDatabaseConfig(target, {}), { message: 'Invalid PostgreSQL connection configuration' });
  }
  assert.throws(() => getDatabaseConfig(url, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }), { message: 'Global TLS verification bypass is not supported' });
});

test('credentials, database, port and normal driver options remain intact', () => {
  const parsed = parameters('postgresql://fixture%40user:p%40ss%3Aword@database.example:5544/db%20name?application_name=fixture&connect_timeout=5', {});
  assert.equal(parsed.user, 'fixture@user');
  assert.equal(parsed.password, 'p@ss:word');
  assert.equal(parsed.database, 'db name');
  assert.equal(parsed.port, 5544);
  assert.equal(parsed.application_name, 'fixture');
  assert.equal(new URL(getDatabaseConfig('postgresql://database.example/fixture?connect_timeout=5', {}).connectionString).searchParams.get('connect_timeout'), '5');
});

test('local plaintext is opt-in only for legacy non-production loopback paths', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const target = url.replace('database.example', host);
    assert.equal(new pg.Client(getDatabaseConfig(target, {})).connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(new pg.Client(getDatabaseConfig(target, {}, true)).connectionParameters.ssl, false);
    for (const env of [{ RENDER: 'true' }, { NODE_ENV: 'production' }, { PGSSLMODE: 'require' }]) {
      assert.equal(new pg.Client(getDatabaseConfig(target, env, true)).connectionParameters.ssl.rejectUnauthorized, true);
    }
    assert.equal(new pg.Client(getDatabaseConfig(target + '?sslmode=disable', {}, true)).connectionParameters.ssl.rejectUnauthorized, true);
  }
});

test('all six connection entry points use actual pg TLS parsing without executing business or maintenance SQL', () => {
  const files = [
    ['src/db/connection.js', 'getPool()', true],
    ['src/db/extensionConnection.js', 'getExtensionPool()', false],
    ['src/db/externalConnection.js', 'getExternalPool()', false],
    ['check_external_db.js', null, false],
    ['run-migration.js', null, true],
    ['run-migration-render.cjs', null, true],
  ];
  for (const [file, invoke, localPlain] of files) {
    let source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    if (file === 'check_external_db.js') source = source.slice(0, source.indexOf('  try {')) + '\n}';
    else if (file.startsWith('run-migration')) source = source.slice(0, source.indexOf('async function runMigration'));
    source = source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
      .replace('fileURLToPath(import.meta.url)', "'/fixture/run-migration.js'");
    for (const [host, envExtra, expected] of [
      ['database.example', { RENDER: 'true' }, true],
      ['dpg-fixture123-a', { RENDER: 'true' }, false],
      ['localhost', { NODE_ENV: 'development' }, localPlain ? null : true],
    ]) {
      const target = url.replace('database.example', host);
      const env = { ...envExtra, DATABASE_URL: target, EXTERNAL_DATABASE_URL: target, EXTENSION_DATABASE_URL: target };
      const captured = [];
      class Pool {
        constructor(config) { captured.push({ parsed: new pg.Client(config).connectionParameters, config }); }
        on() {}
      }
      const helper = (target, ignoredEnv, allow) => getDatabaseConfig(target, env, allow);
      const setup = { URL, pg: { Pool, Client: Pool }, process: { env }, getDatabaseConfig: helper,
        console: { log() {}, warn() {}, error() {} }, dirname: path.dirname,
        require(name) { if (name === 'pg') return { Pool }; if (name.includes('connection-config')) return { getDatabaseConfig: helper }; return {}; } };
      vm.runInNewContext(source + (invoke ? '\n' + invoke + ';' : file === 'check_external_db.js' ? '\ncheckDatabase();' : ''), setup);
      assert.equal(captured.length, 1, file);
      assert.equal(captured[0].parsed.host, host, file);
      if (expected === null) assert.equal(captured[0].parsed.ssl, false, file);
      else assert.equal(captured[0].parsed.ssl.rejectUnauthorized, expected, file);
      if (file.endsWith('.cjs')) assert.equal(captured[0].config.connectionTimeoutMillis, 10000);
    }
  }
});

