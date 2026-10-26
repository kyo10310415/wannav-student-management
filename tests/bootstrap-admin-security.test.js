import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { validateNewPassword } from '../src/security/passwordPolicy.js';

const marker = 'SYNTHETIC_BOOTSTRAP_PRIVATE';
const email = 'fixture@example.test';
let sequence = 0;
async function fixture({ exists = false, queryFail = false, hashFail = false } = {}) {
  const logs = [], queries = [], hashes = [], imports = [], exits = [];
  const runQuery = async (...args) => { queries.push(args); if (queryFail) throw Object.assign(new Error(marker), { detail: marker }); return { rows: args[0].startsWith('SELECT') && exists ? [{ id: 1 }] : [] }; };
  const deps = { validateNewPassword, bcrypt: { hash: async (...args) => { hashes.push(args); if (hashFail) throw new Error(marker); return marker + '-hash'; } },
    loadQuery: () => { imports.push(true); return runQuery; },
    process: { env: {}, argv: ['node'], exit: code => exits.push(code) },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  let source = await readFile(new URL('../create-admin.js', import.meta.url), 'utf8');
  source = source.replace("import 'dotenv/config';", '')
    .replace("import bcrypt from 'bcryptjs';", 'const { bcrypt } = deps;')
    .replace("import { validateNewPassword } from './src/security/passwordPolicy.js';", 'const { validateNewPassword } = deps;')
    .replace("(await import('./src/db/connection.js')).query", 'deps.loadQuery()');
  const key = 'bootstrapPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { process, console } = deps;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { api, logs, queries, hashes, imports, exits };
}
const safe = f => { assert.equal(f.logs.join('\n').includes(marker), false); assert.equal(f.logs.join('\n').includes(email), false); };

test('import does not load database, hash credentials or exit', async () => {
  const f = await fixture(); assert.deepEqual(f.imports, []); assert.deepEqual(f.queries, []);
  assert.deepEqual(f.hashes, []); assert.deepEqual(f.exits, []); assert.deepEqual(f.logs, []);
});

test('missing and invalid environment input fails before any database access or hash', async () => {
  for (const env of [{}, { ADMIN_EMAIL: email }, { ADMIN_PASSWORD: marker }, { ADMIN_EMAIL: marker, ADMIN_PASSWORD: marker },
    { ADMIN_EMAIL: email, ADMIN_PASSWORD: 'short' }, { ADMIN_EMAIL: email, ADMIN_PASSWORD: 'x'.repeat(73) }]) {
    const f = await fixture(); assert.equal(await f.api.createAdmin({ env }), 1);
    assert.equal(f.imports.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.hashes.length, 0); safe(f);
  }
});

test('valid creation stores only hash and keeps admin/forced-change flags without logging credentials', async () => {
  const f = await fixture(); assert.equal(await f.api.createAdmin({ env: { ADMIN_EMAIL: ` ${email.toUpperCase()} `, ADMIN_PASSWORD: marker } }), 0);
  assert.deepEqual(f.hashes, [[marker, 10]]); assert.equal(f.imports.length, 1);
  assert.deepEqual(f.queries[0][1], [email]);
  assert.deepEqual(f.queries[1][1], [email, marker + '-hash', 'admin', true]);
  assert.match(f.queries[1][0], /INSERT INTO users \(email, password_hash, role, must_change_password\)/); safe(f);
});

test('duplicate account and upstream failures keep refusal without reset, raw errors or credential output', async () => {
  for (const options of [{ exists: true }, { queryFail: true }, { hashFail: true }]) {
    const f = await fixture(options); assert.equal(await f.api.createAdmin({ env: { ADMIN_EMAIL: email, ADMIN_PASSWORD: marker } }), 1);
    assert.equal(f.queries.some(([sql]) => /UPDATE|DELETE|INSERT/i.test(sql)), false);
    if (options.exists) assert.equal(f.hashes.length, 0); safe(f);
  }
});

test('direct guard supports absolute/relative native Windows paths and does not run on import', async () => {
  const f = await fixture();
  const absolute = resolve('create-admin.js'); const url = pathToFileURL(absolute).href;
  assert.equal(f.api.isDirectInvocation(url, absolute), true);
  assert.equal(f.api.isDirectInvocation(url, './create-admin.js'), true);
  assert.equal(f.api.isDirectInvocation(url, resolve('other.js')), false);
  assert.equal(f.api.isDirectInvocation(url, ''), false);
  assert.equal(f.api.isDirectInvocation(url), false);
  const spaced = resolve('fixture path', 'create-admin.js');
  assert.equal(f.api.isDirectInvocation(pathToFileURL(spaced).href, spaced), true);
});

test('isolated direct CLI exits zero/one using only fake hashing and database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'bootstrap-admin-fixture-'));
  assert.equal(dirname(resolve(folder)), resolve(tmpdir())); assert.ok(basename(folder).startsWith('bootstrap-admin-fixture-'));
  try {
    let source = await readFile(new URL('../create-admin.js', import.meta.url), 'utf8');
    source = source.replace("import 'dotenv/config';", '')
      .replace("import bcrypt from 'bcryptjs';", "const bcrypt = { hash: async () => 'fixture-hash' };")
      .replace("import { validateNewPassword } from './src/security/passwordPolicy.js';", `import { validateNewPassword } from ${JSON.stringify(new URL('../src/security/passwordPolicy.js', import.meta.url).href)};`)
      .replace("(await import('./src/db/connection.js')).query", "(async () => ({ rows: [] }))");
    const entry = join(folder, 'create-admin.mjs'); await writeFile(entry, source, 'utf8');
    for (const [env, code] of [[{ ADMIN_EMAIL: email, ADMIN_PASSWORD: marker }, 0], [{ ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }, 1]]) {
      const result = spawnSync(process.execPath, [entry], { encoding: 'utf8', env: { ...process.env, ...env } });
      assert.equal(result.status, code); assert.equal(result.error, undefined);
      assert.equal((result.stdout + result.stderr).includes(marker), false); assert.equal((result.stdout + result.stderr).includes(email), false);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
