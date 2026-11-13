import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

// Bounded in-memory regression, no live endpoint or memory exhaustion.
function chunks(bytes) {
  let sent = 0;
  return new ReadableStream({ pull(controller) {
    if (sent++ < bytes) controller.enqueue(new Uint8Array([65]));
    else controller.close();
  }});
}
function fixture(maxSize) {
  const app = new Hono();
  let called = false;
  app.post('/', bodyLimit({ maxSize }), async c => {
    called = true;
    const reader = c.req.raw.body.getReader();
    let count = 0, bytes = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      count++; bytes += item.value.byteLength;
    }
    return c.json({ count, bytes });
  });
  return { app, called: () => called };
}
test('tiny transfer chunks are coalesced instead of retained/replayed individually', async () => {
  const { app } = fixture(16 * 1024);
  const result = await app.request('/', { method: 'POST', body: chunks(8192), duplex: 'half' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { count: 1, bytes: 8192 });
});
test('chunked body at exact size limit is preserved', async () => {
  const { app } = fixture(4096);
  const result = await app.request('/', { method: 'POST', body: chunks(4096), duplex: 'half' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { count: 1, bytes: 4096 });
});
test('chunked body above limit is rejected before the handler', async () => {
  const f = fixture(4096);
  const result = await f.app.request('/', { method: 'POST', body: chunks(4097), duplex: 'half' });
  assert.equal(result.status, 413);
  assert.equal(f.called(), false);
});
