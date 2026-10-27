import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
test('minutes SDK explicitly disables inherited debug logging while preserving cached client and mocked requests', async () => {
  const logs = [], options = []; let requests = 0;
  class FixtureOpenAI extends OpenAI {
    constructor(value) {
      options.push(value);
      super({ ...value, logger: Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)])), fetch: async () => {
        requests++;
        return new Response(JSON.stringify({ id: 'fixture', choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop', index: 0 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } });
    }
  }
  const source = await readFile(new URL('../src/services/minutesService.js', import.meta.url), 'utf8');
  const functionSource = source.slice(source.indexOf('function getOpenAIClient()'), source.indexOf('export function applyTemplate'));
  const key = 'minutesSdkLoggingFixture'; const old = process.env.OPENAI_LOG;
  globalThis[key] = { OpenAI: FixtureOpenAI, process: { env: { OPENAI_API_KEY: 'fixture-api-key' } } };
  process.env.OPENAI_LOG = 'debug';
  try {
    const module = await import('data:text/javascript;base64,' + Buffer.from(`const { OpenAI, process } = globalThis[${JSON.stringify(key)}]; let _client=null;\n${functionSource}\nexport { getOpenAIClient };`).toString('base64'));
    const client = module.getOpenAIClient(); assert.equal(module.getOpenAIClient(), client);
    assert.equal(options.length, 1); assert.equal(options[0].apiKey, 'fixture-api-key'); assert.equal(options[0].logLevel, 'off');
    await client.chat.completions.create({ model: 'fixture', messages: [{ role: 'user', content: 'SYNTHETIC_PRIVATE_TRANSCRIPT' }] });
    assert.equal(requests, 1); assert.equal(logs.length, 0);
  } finally { delete globalThis[key]; if (old === undefined) delete process.env.OPENAI_LOG; else process.env.OPENAI_LOG = old; }
});
