import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { google } from 'googleapis';

const require = createRequire(import.meta.url);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const consumers = ['gaxios', 'googleapis-common', 'node-cron'];
function consumerRequire(name) {
  return createRequire(require.resolve(name));
}
async function readBody(body) {
  if (typeof body === 'string') return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
function assertMultipart(headers, body, expected) {
  const contentType = headers['content-type'] || headers['Content-Type'];
  const match = /boundary=([^;]+)/.exec(contentType);
  assert.ok(match);
  assert.match(match[1], uuidPattern);
  assert.ok(body.includes(`--${match[1]}`));
  assert.ok(body.includes(`--${match[1]}--`));
  for (const text of expected) assert.ok(body.includes(text));
}

test('each installed consumer resolves the patched CommonJS uuid and zero-argument v4', () => {
  for (const consumer of consumers) {
    const load = consumerRequire(consumer);
    assert.equal(load('uuid/package.json').version, '11.1.1', consumer);
    const uuid = load('uuid');
    assert.equal(typeof uuid.v4, 'function');
    const first = uuid.v4();
    assert.match(first, uuidPattern);
    assert.notEqual(uuid.v4(), first);
  }
});

test('real gaxios builds a valid multipart boundary without network', async () => {
  const { Gaxios } = require('gaxios');
  const client = new Gaxios();
  let requests = 0;
  const result = await client.request({
    url: 'https://fixture.invalid/upload', method: 'POST',
    multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'fixture-gaxios-body' }],
    adapter: async config => {
      requests++;
      assert.equal(new URL(config.url).hostname, 'fixture.invalid');
      assertMultipart(config.headers, await readBody(config.body), ['fixture-gaxios-body']);
      return { status: 200, statusText: 'OK', headers: {}, config, data: { fixture: true } };
    }
  });
  assert.deepEqual(result.data, { fixture: true });
  assert.equal(requests, 1);
});

test('real googleapis-common builds Drive multipart upload with an entirely local auth transport', async () => {
  let requests = 0;
  const auth = { request: async config => {
    requests++;
    assert.equal(new URL(config.url).hostname, 'www.googleapis.com');
    assert.equal(config.params.uploadType, 'multipart');
    assertMultipart(config.headers, await readBody(config.data), ['fixture-upload-name', 'fixture-google-body']);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { id: 'fixture-file' } };
  } };
  const drive = google.drive({ version: 'v3', auth });
  const result = await drive.files.create({
    requestBody: { name: 'fixture-upload-name' },
    media: { mimeType: 'text/plain', body: 'fixture-google-body' }
  });
  assert.deepEqual(result.data, { id: 'fixture-file' });
  assert.equal(requests, 1);
});

test('cron creates generated and explicit names without starting timers or executing jobs', () => {
  const cron = require('node-cron');
  const load = consumerRequire('node-cron');
  const storage = load('./storage');
  let executions = 0;
  const generated = cron.schedule('* * * * *', () => executions++, { scheduled: false });
  const named = cron.schedule('* * * * *', () => executions++, { scheduled: false, name: 'fixture-explicit-name' });
  const stored = {};
  try {
    assert.match(generated.options.name, uuidPattern);
    assert.equal(named.options.name, 'fixture-explicit-name');
    assert.equal(generated._scheduler.timeout, undefined);
    assert.equal(named._scheduler.timeout, undefined);
    storage.save(stored);
    assert.match(stored.options.name, uuidPattern);
    assert.equal(cron.getTasks().get(generated.options.name), generated);
    assert.equal(cron.getTasks().get(stored.options.name), stored);
    assert.equal(executions, 0);
  } finally {
    generated.stop(); named.stop();
    for (const item of [generated, named, stored]) cron.getTasks().delete(item.options.name);
  }
  assert.equal(executions, 0);
});

test('patched uuid rejects undersized output buffers for advisory-affected methods', () => {
  for (const consumer of consumers) {
    const uuid = consumerRequire(consumer)('uuid');
    const namespace = uuid.NIL;
    for (const method of ['v3', 'v5']) {
      assert.throws(() => uuid[method]('fixture', namespace, new Uint8Array(8), 4), RangeError);
    }
    assert.throws(() => uuid.v6({}, new Uint8Array(8), 4), RangeError);
  }
});
