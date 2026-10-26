import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_PRIVATE_DATABASE_MAINTENANCE';
const providerError = () => Object.assign(new Error(marker), { detail: marker, query: marker, config: { password: marker }, cause: new Error(marker) });
function output() {
  const logs = [];
  return { logs, console: Object.fromEntries(['log', 'error', 'warn'].map(level => [level, (...args) => logs.push(inspect(args))])) };
}
async function routeFixture({ mainError, extensionError, getPoolError, migrationError, missingExtension = false } = {}) {
  const log = output(), queries = [];
  let migrations = 0;
  function pool(extension) {
    return { totalCount: 4, idleCount: 2, waitingCount: 1, async query(sql) {
      queries.push({ extension, sql });
      if (extension ? extensionError : mainError) throw providerError();
      if (sql.includes('pg_database_size')) return { rows: [{ size: extension ? '4096' : '2048' }] };
      if (sql.includes('pg_stat_user_tables')) return { rows: [{ table_name: 'public.fixture_table', row_count: '3' }] };
      if (sql.includes('FROM student_extensions')) return { rows: [{ table_name: 'student_extensions', row_count: '2' }] };
      if (sql.includes('SELECT EXISTS')) return { rows: [{ exists: true }] };
      return { rows: [{ schemaname: 'public', tablename: 'fixture_table', size: '2 kB', size_bytes: '2048' }] };
    } };
  }
  let source = await readFile(new URL('../src/routes/database.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*\r?\n/gm, '').replace("await import('../db/migrate.js')", 'migrationModule').replace('export default app;', 'globalThis.app = app;');
  const context = { ...log, Hono, getPool: () => { if (getPoolError) throw providerError(); return pool(false); },
    getExtensionPool: () => missingExtension ? null : pool(true),
    migrationModule: { runMigrations: async () => { migrations++; if (migrationError) throw providerError(); } } };
  vm.runInNewContext(source, context);
  return { ...log, app: context.app, queries, migrations: () => migrations };
}

test('database routes retain statistics, pool information, table list and migration success shapes', async () => {
  const f = await routeFixture();
  const stats = await (await f.app.request('/stats')).json();
  assert.equal(stats.success, true);
  assert.equal(stats.data.mainDatabase.totalSize, '2 KB');
  assert.equal(stats.data.mainDatabase.totalRows, 3);
  assert.deepEqual(stats.data.mainDatabase.rowCounts, [{ table_name: 'fixture_table', row_count: '3' }]);
  assert.equal(stats.data.extensionDatabase.totalSize, '4 KB');
  assert.equal(stats.data.extensionDatabase.totalRows, 2);
  const info = await (await f.app.request('/connection-info')).json();
  assert.deepEqual(info, { success: true, data: { mainDatabase: { totalConnections: 4, idleConnections: 2, waitingClients: 1 },
    extensionDatabase: { totalConnections: 4, idleConnections: 2, waitingClients: 1 } } });
  assert.deepEqual(await (await f.app.request('/tables')).json(), { success: true, tables: ['fixture_table'] });
  const migration = await f.app.request('/migrate', { method: 'POST' });
  assert.equal(migration.status, 200);
  assert.deepEqual(await migration.json(), { success: true, message: 'Database migrations completed successfully', lessonReportsTableExists: true });
  assert.equal(f.migrations(), 1);
});

test('partial statistics failures remain successful partial responses without provider information', async () => {
  for (const options of [{ mainError: true }, { extensionError: true }, { mainError: true, extensionError: true }, { missingExtension: true }]) {
    const f = await routeFixture(options);
    const response = await f.app.request('/stats');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    if (options.mainError) assert.equal(result.data.mainDatabase.error, 'Main database statistics could not be loaded');
    if (options.extensionError) assert.equal(result.data.extensionDatabase.error, 'Extension database statistics could not be loaded');
    if (options.missingExtension) assert.equal(result.data.extensionDatabase.error, 'Extension database not configured');
    assert.equal(JSON.stringify(result).includes(marker), false);
    assert.equal(f.logs.join('\n').includes(marker), false);
  }
});

test('all database route failures keep 500 and return no provider message, cause or stack', async () => {
  for (const [path, options, method] of [['/stats', { getPoolError: true }, 'GET'], ['/connection-info', { getPoolError: true }, 'GET'],
    ['/tables', { mainError: true }, 'GET'], ['/migrate', { migrationError: true }, 'POST'], ['/migrate', { mainError: true }, 'POST']]) {
    const f = await routeFixture(options);
    const response = await f.app.request(path, { method });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(typeof body.error, 'string');
    assert.equal(Object.hasOwn(body, 'stack'), false);
    assert.equal(JSON.stringify(body).includes(marker), false);
    assert.equal(f.logs.join('\n').includes(marker), false);
    if (options.migrationError) assert.equal(f.queries.length, 0);
  }
});

async function migrationFixture({ failOnVersion, failOnSchema = false, direct = false } = {}) {
  const log = output(), calls = [], exits = [], applied = new Set(Array.from({ length: 58 }, (_, i) => i + 2));
  let pending;
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT version FROM migration_history')) { pending = params[0]; return { rows: applied.has(pending) ? [{ version: pending }] : [] }; }
    if (sql.includes('INSERT INTO migration_history')) { applied.add(params[0]); return { rows: [] }; }
    if (failOnSchema && pending === undefined || pending === failOnVersion && failOnVersion !== undefined) throw providerError();
    return { rows: [] };
  } };
  let source = await readFile(new URL('../src/db/migrate.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*\r?\n/gm, '').replaceAll('import.meta.url', 'diagnosticUrl')
    .replace('export { runMigrations };', 'globalThis.runMigrations = runMigrations;')
    .replace(/runMigrations\(\)(\r?\n\s*\.then)/, 'globalThis.cliDone = runMigrations()$1');
  const context = { ...log, getPool: () => pool, diagnosticUrl: direct ? 'file:///fixture/migrate.js' : 'not-executed',
    process: { argv: ['node', '/fixture/migrate.js'], exit: code => exits.push(code) } };
  vm.runInNewContext(source, context);
  return { ...log, calls, exits, applied, run: context.runMigrations, cliDone: context.cliDone };
}

test('migration import remains inert and success retains statement/record/skip order', async () => {
  const f = await migrationFixture();
  assert.equal(f.calls.length, 0);
  await f.run();
  assert.ok(f.calls[0].sql.includes('CREATE TABLE IF NOT EXISTS migration_history'));
  const record = f.calls.findIndex(call => call.sql.includes('INSERT INTO migration_history'));
  assert.ok(record > 1);
  assert.ok(f.calls[record - 1].sql.includes('CREATE TABLE IF NOT EXISTS students'));
  assert.deepEqual(Array.from(f.calls[record].params), [1, 'create_students_table']);
  const before = f.calls.length;
  await f.run();
  assert.equal(f.calls.slice(before).some(call => call.sql.includes('INSERT INTO migration_history')), false);
  assert.equal(f.calls.some(call => /^\s*(ROLLBACK|BEGIN|COMMIT)\s*;?\s*$/i.test(call.sql)), false);
});

test('migration failures stop before history write with fixed errors and no added rollback', async () => {
  for (const options of [{ failOnVersion: 1 }, { failOnSchema: true }]) {
    const f = await migrationFixture(options);
    await assert.rejects(f.run(), error => error.message === 'Database migration failed' && !error.cause && !inspect(error).includes(marker));
    assert.equal(f.calls.some(call => call.sql.includes('INSERT INTO migration_history')), false);
    assert.equal(f.calls.some(call => /ROLLBACK/.test(call.sql)), false);
    assert.equal(f.logs.join('\n').includes(marker), false);
    assert.equal(f.calls.length, options.failOnSchema ? 1 : 3);
  }
});

test('the existing direct entry guard retains success/failure exits with private logs', async () => {
  for (const [options, expected] of [[{}, 0], [{ failOnVersion: 1 }, 1]]) {
    const f = await migrationFixture({ ...options, direct: true });
    await f.cliDone;
    assert.deepEqual(f.exits, [expected]);
    assert.equal(f.logs.join('\n').includes(marker), false);
  }
});
