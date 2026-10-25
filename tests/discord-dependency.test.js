import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, GatewayIntentBits, Partials, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { REST } from '@discordjs/rest';

test('updated Discord client constructs existing intents and payloads without login', async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Channel, Partials.Reaction] });
  assert.equal(client.isReady(), false);
  assert.equal(new EmbedBuilder().setDescription('Synthetic fixture').toJSON().description, 'Synthetic fixture');
  assert.equal(new AttachmentBuilder(Buffer.from('fixture'), { name: 'fixture.txt' }).name, 'fixture.txt');
  await client.destroy();
});
test('updated Discord REST accepts injected transport without external requests', async () => {
  let calls = 0;
  const rest = new REST({ makeRequest: async (url, init) => {
    calls++; assert.ok(url.endsWith('/users/@me')); assert.equal(init.method, 'GET');
    return new Response(JSON.stringify({ id: 'fixture-user' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } }).setToken('synthetic-not-a-real-token');
  try { assert.equal((await rest.get('/users/@me')).id, 'fixture-user'); assert.equal(calls, 1); }
  finally { rest.clearHashSweeper(); rest.clearHandlerSweeper(); }
});
