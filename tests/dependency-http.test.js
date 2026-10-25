import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';

test('updated Node adapter preserves protected static paths and JSON request handling', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.dependency-fixture-'));
  let server;
  try {
    await mkdir(join(directory, 'private'));
    await writeFile(join(directory, 'private', 'secret.txt'), 'SYNTHETIC_PRIVATE_FIXTURE');
    const app = new Hono();
    app.use('/private/*', async (c, next) => c.req.header('Authorization') === 'fixture-only' ? next() : c.text('Denied', 401));
    app.post('/echo', async c => c.json(await c.req.json()));
    app.use('*', serveStatic({ root: './' + basename(directory) }));
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    if (!server.listening) await new Promise(r => server.once('listening', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(origin + '/private/secret.txt')).status, 401);
    for (const path of ['/private%2Fsecret.txt', '/private//secret.txt', '/private%5Csecret.txt']) {
      const response = await fetch(origin + path);
      assert.equal((await response.text()).includes('SYNTHETIC_PRIVATE_FIXTURE'), false, path);
    }
    const allowed = await fetch(origin + '/private/secret.txt', { headers: { Authorization: 'fixture-only' } });
    assert.equal(await allowed.text(), 'SYNTHETIC_PRIVATE_FIXTURE');
    const response = await fetch(origin + '/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fixture: true }) });
    assert.deepEqual(await response.json(), { fixture: true });
  } finally {
    if (server) await new Promise(r => server.close(r));
    assert.equal(dirname(resolve(directory)), resolve(process.cwd()));
    assert.ok(basename(directory).startsWith('.dependency-fixture-'));
    await rm(directory, { recursive: true, force: true });
  }
});
