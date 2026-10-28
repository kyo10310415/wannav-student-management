import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
const marker = 'SYNTHETIC_BROADCAST_PRIVATE';
let sequence = 0;
const rawError = response => Object.assign(new Error(marker), { response, config: { url: marker, headers: { Authorization: marker } }, detail: marker });
async function fixture(overrides = {}) {
  const logs = [], calls = [], waits = [];
  const deps = {
    axios: { post: async () => ({ status: 204 }) }, FormData: class {},
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
    getClient: async () => { throw rawError(); }, fetchStudentBroadcastInfo: async () => [],
    discordClient: { channels: { fetch: async () => ({ send: async () => {} }) } },
    classifyLegacyBroadcastRecipients: () => [], createKeyedJobDispatcher: worker => ({ dispatch: worker }),
    process: { env: { BROADCAST_VERBOSE_LOGGING: 'true', DISCORD_BROADCAST_TEST_WEBHOOK_URL: marker } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    setTimeout: (fn, ms) => { waits.push(ms); if (ms < 15000) queueMicrotask(fn); return {}; }, clearTimeout: () => {}, ...overrides
  };
  let source = await readFile(new URL('../src/services/broadcastService.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '');
  const key = 'broadcastPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const { axios, FormData, query, getClient, fetchStudentBroadcastInfo, discordClient, classifyLegacyBroadcastRecipients, createKeyedJobDispatcher, process, console, setTimeout, clearTimeout } = globalThis[${JSON.stringify(key)}];\n`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(prefix + source + '\nexport { sendViaWebhook, sendViaBot };').toString('base64')}`);
    return { module, logs, calls, waits };
  } finally { delete globalThis[key]; }
}
const safe = value => assert.equal(inspect(value).includes(marker), false);

test('target selection retains crew SQL scope and rows while verbose logs conceal identifying filters', async () => {
  const calls = [], rows = [{ student_id: marker, name: marker }];
  const f = await fixture({ query: async (...args) => { calls.push(args); return { rows }; } });
  assert.equal(await f.module.getTargetStudents('fixture', marker, marker, 'crew'), rows);
  assert.deepEqual(calls[0][1], ['fixture', marker]);
  assert.match(calls[0][0], /AND t.email = \$2/);
  safe(f.logs);
});

test('database operation failures become fixed errors without provider metadata', async () => {
  const f = await fixture({ query: async () => { throw rawError(); } });
  for (const invoke of [() => f.module.getTargetStudents('fixture', null, marker, 'crew'), () => f.module.getTemplates(marker, 'crew'),
    () => f.module.saveTemplate({ name: marker }, marker), () => f.module.deleteTemplate(marker, marker, 'crew'), () => f.module.getBroadcastLogs(null, 100, { email: 'fixture@example.invalid', role: 'crew' })]) {
    await assert.rejects(invoke, error => { assert.equal(error.message, 'Broadcast operation failed'); safe(error); assert.equal(Object.hasOwn(error, 'cause'), false); return true; });
  }
  safe(f.logs);
});

test('enqueue rolls back and releases raw clients without leaking SQL exception contents', async () => {
  const queries = []; let released = 0;
  const f = await fixture();
  await assert.rejects(() => f.module.enqueueBroadcast({ content: marker, channelType: 'notice' }, [], marker, {
    getClient: async () => ({ query: async sql => { queries.push(sql); if (sql !== 'ROLLBACK') throw rawError(); return { rows: [] }; }, release: () => released++ }),
    runBroadcastJob: async () => { throw new Error('Unexpected dispatch'); }
  }), error => { assert.equal(error.message, 'Broadcast operation failed'); safe(error); return true; });
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK']); assert.equal(released, 1);
});

test('webhook success preserves payload and destination without verbose identifiers', async () => {
  const calls = [];
  const f = await fixture({ axios: { post: async (...args) => { calls.push(args); return { status: 204 }; } } });
  assert.deepEqual(await f.module.sendViaWebhook(marker, marker, marker, null), { success: true });
  assert.equal(calls[0][0], marker); assert.equal(calls[0][1].embeds[0].description, marker);
  assert.equal(calls[0][1].content, `<@${marker}>`); assert.equal(calls[0][2].timeout, 15000);
  safe(f.logs);
});

test('webhook network uncertainty and HTTP failures conceal axios metadata and retain retry classification', async () => {
  for (const status of [undefined, 400, 429]) {
    let calls = 0;
    const f = await fixture({ axios: { post: async () => { calls++; throw rawError(status ? { status, headers: { 'retry-after': '0.5' }, data: marker } : undefined); } } });
    await assert.rejects(() => f.module.sendViaWebhook(marker, marker, marker, null), error => {
      assert.equal(Boolean(error.deliveryUncertain), status === undefined);
      assert.equal(Object.hasOwn(error, 'cause'), false); safe(error); return true;
    });
    assert.equal(calls, status === 429 ? 3 : 1);
    assert.equal(f.waits.filter(ms => ms === 700).length, status === 429 ? 3 : 0);
    safe(f.logs);
  }
});

test('bot validation and timeout uncertainty retain business messages without provider error objects', async () => {
  const f = await fixture({ discordClient: { channels: { fetch: async () => ({ send: async () => { throw new Error(marker + ' timed out'); } }) } } });
  await assert.rejects(() => f.module.sendViaBot('invalid', marker, marker), { message: 'Invalid chat URL format' });
  await assert.rejects(() => f.module.sendViaBot('https://discord.com/channels/123/456', marker, marker), error => {
    assert.equal(error.deliveryUncertain, true); safe(error); assert.equal(Object.hasOwn(error, 'cause'), false); return true;
  });
});

test('worker stores fixed delivery errors and retains failed versus unknown progress', async () => {
  for (const network of [false, true]) {
    const calls = [];
    const f = await fixture({ axios: { post: async () => { throw rawError(network ? undefined : { status: 400 }); } },
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('bm.name AS message_name')) return { rows: [{ is_test: true, created_by: 'fixture@example.invalid', creator_email: 'fixture@example.invalid', creator_role: 'leader' }] };
        if (sql.includes('RETURNING broadcast_jobs.*')) return { rows: [{ sent: 0, failed: network ? 0 : 1, unknown_count: network ? 1 : 0 }] };
        if (sql.includes('AS pending,') && sql.includes('AS unknown_count')) return { rows: [{ pending: 0, unknown_count: network ? 1 : 0 }] };
        if (sql.includes('SELECT bj.broadcast_id')) return { rows: [{ broadcast_id: 1, is_test: true, content: marker, channel_type: 'notice' }] };
        if (sql.includes('SELECT student_id, student_name')) return { rows: [{ student_id: marker, student_name: marker }] };
        if (sql.includes('RETURNING *')) return { rows: [{}] };
        return { rows: [] };
      } });
    await f.module.dispatchBroadcastJob(marker);
    const update = calls.find(call => call.sql.includes('SET status = $3'));
    assert.equal(update.params[2], network ? 'unknown' : 'failed');
    assert.equal(update.params[3], 'Broadcast delivery failed');
    const log = calls.find(call => call.sql.includes('INSERT INTO broadcast_logs'));
    assert.equal(log.params[4], marker); // Dedicated destination history is preserved.
    assert.equal(log.params[6], 'Broadcast delivery failed');
    const final = calls.filter(call => call.sql.includes('RETURNING broadcast_jobs.*')).at(-1);
    assert.equal(final.params[1], network ? 'needs_review' : 'completed');
    safe(f.logs);
  }
});

test('fatal worker errors persist a fixed reason while preserving interrupted progress', async () => {
  let count = 0; const calls = [];
  const f = await fixture({ query: async (sql, params) => { calls.push({ sql, params }); if (count++ === 0) throw rawError(); return { rows: [] }; } });
  await f.module.dispatchBroadcastJob(marker);
  assert.deepEqual(calls[1].params, [marker, 'Broadcast worker stopped']);
  assert.deepEqual(calls[2].params, [marker, 'interrupted']);
  safe(f.logs);
});

test('crew ownership and running state validation retain status and messages', async () => {
  const f = await fixture({ query: async sql => ({ rows: sql.includes('SELECT job_id') ? [] : [{ created_by: 'other', status: 'running', creator_email: 'other', creator_role: 'leader' }] }) });
  await assert.rejects(() => f.module.resumeBroadcastJob('fixture', marker, 'crew'), error => error.status === 403 && error.message === 'この送信ジョブを再開する権限がありません');
  await assert.rejects(() => f.module.resumeBroadcastJob('fixture', marker, 'leader'), error => error.status === 409 && error.message === 'この送信ジョブは現在実行中です');
});

test('template update requires ownership and template flag and returns 404 on zero matching rows',async()=>{const f=await fixture({query:async(sql,params)=>{f.calls.push({sql,params});return{rows:[]}}});await assert.rejects(f.module.saveTemplate({id:7,name:'Synthetic',content:'Synthetic'},'synthetic@example.invalid'),e=>e.status===404);assert.ok(f.calls[0].sql.includes('created_by = $7 AND is_template = true RETURNING id'));assert.equal(f.calls[0].params[6],'synthetic@example.invalid')});
test('template create/update and role-scoped delete retain parameterized identity contracts',async()=>{const f=await fixture({query:async(sql,params)=>{f.calls.push({sql,params});return{rows:[{id:7}]}}});assert.equal((await f.module.saveTemplate({name:'Synthetic',content:'Synthetic'},'synthetic@example.invalid')).id,7);assert.equal((await f.module.saveTemplate({id:7,name:'Synthetic',content:'Synthetic'},'synthetic@example.invalid')).id,7);for(const role of['crew','leader','admin'])await f.module.deleteTemplate(7,'synthetic@example.invalid',role);assert.ok(f.calls[2].sql.includes('created_by = $2'));assert.equal(f.calls[3].sql.includes('created_by'),false);assert.equal(f.calls[4].sql.includes('created_by'),false);assert.ok(f.calls.slice(2).every(x=>x.sql.includes('is_template = true')&&x.sql.includes('RETURNING id')))});
test('nonexistent or unauthorized template delete no longer reports success',async()=>{const f=await fixture();await assert.rejects(f.module.deleteTemplate(7,'synthetic@example.invalid','crew'),e=>e.status===404)});
