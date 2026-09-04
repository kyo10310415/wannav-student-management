import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  createGasBroadcastRoutes,
  extractDiscordChannelId,
  validateAndNormalizeSendRequest
} from '../src/routes/gasBroadcast.js';
import {
  buildBotMessageContent,
  enqueueBroadcast,
  GAS_BROADCAST_CREATED_BY,
  resolveBroadcastInfo
} from '../src/services/broadcastService.js';
import { client as importedDiscordClient } from '../src/services/discordService.js';

after(() => importedDiscordClient.destroy());

const API_KEY = 'test-api-key';
const CHANNEL_URL_1 = 'https://discord.com/channels/123456789012345678/223456789012345678';
const CHANNEL_URL_2 = 'https://discord.com/channels/123456789012345678/323456789012345678';

function validBody(overrides = {}) {
  return {
    campaignKey: 'campaign-1',
    content: 'お知らせです',
    targets: [{
      studentId: 'S001',
      studentName: '生徒一郎',
      chatUrl: CHANNEL_URL_1
    }],
    ...overrides
  };
}

function createTestApp(overrides = {}) {
  return createGasBroadcastRoutes({
    getApiKey: () => API_KEY,
    discordClient: { isReady: () => true },
    query: async () => ({ rows: [] }),
    enqueueBroadcast: async () => ({
      jobId: 'job-1',
      broadcastId: 1,
      total: 1,
      reused: false
    }),
    getBroadcastJobStatus: async () => null,
    getBroadcastLogs: async () => [],
    ...overrides
  });
}

function jsonRequest(body, apiKey = API_KEY) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {})
    },
    body: JSON.stringify(body)
  };
}

test('GAS API authentication returns 401 for a missing or incorrect key', async () => {
  const app = createTestApp();

  const missing = await app.request('/health');
  assert.equal(missing.status, 401);

  const incorrect = await app.request('/health', {
    headers: { 'X-API-Key': 'incorrect' }
  });
  assert.equal(incorrect.status, 401);
});

test('GAS API authentication returns 503 when the server key is not configured', async () => {
  const app = createTestApp({ getApiKey: () => undefined });
  const response = await app.request('/health', {
    headers: { 'X-API-Key': API_KEY }
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'GAS broadcast API is not configured'
  });
});

test('health and send return 503 when the Discord bot is not ready', async () => {
  const app = createTestApp({ discordClient: { isReady: () => false } });
  const headers = { 'X-API-Key': API_KEY };

  const health = await app.request('/health', { headers });
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), {
    success: false,
    botReady: false,
    error: 'Discord bot is not ready'
  });

  const send = await app.request('/send', jsonRequest(validBody()));
  assert.equal(send.status, 503);
});

test('send validates missing targets, invalid URLs, message length, and target limit', async () => {
  const app = createTestApp();

  const missingTargets = await app.request('/send', jsonRequest(validBody({ targets: [] })));
  assert.equal(missingTargets.status, 400);

  const invalidUrl = await app.request('/send', jsonRequest(validBody({
    targets: [{ studentId: 'S001', studentName: '生徒一郎', chatUrl: 'https://example.com/channel' }]
  })));
  assert.equal(invalidUrl.status, 400);

  const tooLong = await app.request('/send', jsonRequest(validBody({ content: 'a'.repeat(2001) })));
  assert.equal(tooLong.status, 400);

  const tooManyTargets = Array.from({ length: 501 }, (_, index) => ({
    studentId: `S${index}`,
    studentName: `Student ${index}`,
    chatUrl: CHANNEL_URL_1
  }));
  const tooMany = await app.request('/send', jsonRequest(validBody({ targets: tooManyTargets })));
  assert.equal(tooMany.status, 400);
});

test('send validates all required campaign, content, and target fields', () => {
  const invalidBodies = [
    validBody({ campaignKey: '' }),
    validBody({ content: '' }),
    validBody({ targets: [{ studentId: '', studentName: '生徒一郎', chatUrl: CHANNEL_URL_1 }] }),
    validBody({ targets: [{ studentId: 'S001', studentName: '', chatUrl: CHANNEL_URL_1 }] }),
    validBody({ targets: [{ studentId: 'S001', studentName: '生徒一郎', chatUrl: '' }] })
  ];

  for (const body of invalidBodies) {
    assert.ok(validateAndNormalizeSendRequest(body).error);
  }
});

test('send deduplicates the same student and channel before enqueueing', async () => {
  let enqueueArgs;
  const app = createTestApp({
    enqueueBroadcast: async (...args) => {
      enqueueArgs = args;
      return { jobId: 'job-1', broadcastId: 10, total: 1, reused: false };
    }
  });

  const response = await app.request('/send', jsonRequest(validBody({
    targets: [
      { studentId: 'S001', studentName: '生徒一郎', chatUrl: CHANNEL_URL_1 },
      { studentId: 'S001', studentName: '生徒一郎', chatUrl: CHANNEL_URL_1 }
    ]
  })));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(enqueueArgs[0].channelType, 'chat');
  assert.equal(enqueueArgs[0].explicitTargets, true);
  assert.equal(enqueueArgs[0].name, 'GAS::campaign-1');
  assert.deepEqual(enqueueArgs[1], [{
    student_id: 'S001',
    name: '生徒一郎',
    chat_url: CHANNEL_URL_1
  }]);
  assert.equal(enqueueArgs[2], GAS_BROADCAST_CREATED_BY);
});

test('send rejects one student assigned to different channels', async () => {
  const validation = validateAndNormalizeSendRequest(validBody({
    targets: [
      { studentId: 'S001', studentName: '生徒一郎', chatUrl: CHANNEL_URL_1 },
      { studentId: 'S001', studentName: '生徒一郎', chatUrl: CHANNEL_URL_2 }
    ]
  }));

  assert.match(validation.error, /multiple Discord channels/);
});

test('send rejects different students assigned to the same channel', async () => {
  const validation = validateAndNormalizeSendRequest(validBody({
    targets: [
      { studentId: 'S001', studentName: '生徒一郎', chatUrl: CHANNEL_URL_1 },
      { studentId: 'S002', studentName: '生徒二郎', chatUrl: CHANNEL_URL_1 }
    ]
  }));

  assert.match(validation.error, /assigned to multiple students/);
});

test('Discord channel URLs are strictly parsed', () => {
  assert.equal(extractDiscordChannelId(CHANNEL_URL_1), '223456789012345678');
  assert.equal(extractDiscordChannelId('http://discord.com/channels/123456789012345678/223456789012345678'), null);
  assert.equal(extractDiscordChannelId('https://example.com/channels/123456789012345678/223456789012345678'), null);
  assert.equal(extractDiscordChannelId('https://discord.com/channels/abc/223456789012345678'), null);
});

test('enqueueBroadcast reuses the existing GAS job for the same campaign key', async () => {
  const state = { broadcast: null, job: null, recipients: [], runCount: 0 };
  const dbClient = {
    async query(sql, params = []) {
      if (/^BEGIN|^COMMIT|^ROLLBACK|pg_advisory_xact_lock/.test(sql)) {
        return { rows: [] };
      }
      if (sql.includes('SELECT bj.job_id')) {
        return {
          rows: state.job ? [{
            job_id: state.job.jobId,
            broadcast_id: state.job.broadcastId,
            total: state.job.total
          }] : []
        };
      }
      if (sql.includes('INSERT INTO broadcast_messages')) {
        state.broadcast = { id: 99, name: params[0], createdBy: params[6] };
        return { rows: [{ id: 99 }] };
      }
      if (sql.includes('INSERT INTO broadcast_jobs')) {
        state.job = {
          jobId: params[0],
          broadcastId: params[1],
          total: params[2],
          createdBy: params[4]
        };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO broadcast_job_recipients')) {
        state.recipients = JSON.parse(params[1]);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {}
  };
  const dependencies = {
    getClient: async () => dbClient,
    runBroadcastJob: async () => { state.runCount++; }
  };
  const messageData = {
    campaignKey: 'same-key',
    name: 'caller-supplied-name-is-ignored',
    content: '本文',
    channelType: 'chat',
    explicitTargets: true
  };
  const targets = [{ student_id: 'S001', name: '生徒一郎', chat_url: CHANNEL_URL_1 }];

  const first = await enqueueBroadcast(messageData, targets, GAS_BROADCAST_CREATED_BY, dependencies);
  const second = await enqueueBroadcast(messageData, targets, GAS_BROADCAST_CREATED_BY, dependencies);

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.broadcastId, first.broadcastId);
  assert.equal(state.broadcast.name, 'GAS::same-key');
  assert.equal(state.broadcast.createdBy, GAS_BROADCAST_CREATED_BY);
  assert.equal(state.recipients[0].chat_url, CHANNEL_URL_1);
  assert.equal(state.runCount, 1);
});

test('send returns reused=true and the existing job identifiers', async () => {
  const app = createTestApp({
    enqueueBroadcast: async () => ({
      jobId: 'existing-job',
      broadcastId: 99,
      total: 130,
      reused: true
    })
  });

  const response = await app.request('/send', jsonRequest(validBody()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    reused: true,
    jobId: 'existing-job',
    broadcastId: 99,
    total: 130
  });
});

test('explicit targets omit mentions while normal broadcasts keep them', () => {
  const student = { student_id: 'S001', name: '生徒一郎', chat_url: CHANNEL_URL_1 };
  const explicit = resolveBroadcastInfo(student, null, true);
  assert.deepEqual(explicit, { chatUrl: CHANNEL_URL_1, discordId: null });
  assert.equal(buildBotMessageContent(explicit.discordId, '本文'), '本文');

  const normalMap = new Map([['S001', {
    chatUrl: CHANNEL_URL_2,
    discordId: '423456789012345678'
  }]]);
  const normal = resolveBroadcastInfo(student, normalMap, false);
  assert.equal(normal.chatUrl, CHANNEL_URL_2);
  assert.equal(buildBotMessageContent(normal.discordId, '本文'), '<@423456789012345678>\n本文');
});

test('normal enqueue persists the recipient snapshot in the same transaction', async () => {
  const calls = [];
  const runnerCalls = [];
  const dbClient = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO broadcast_messages')) {
        return { rows: [{ id: 77 }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const result = await enqueueBroadcast(
    { content: '本文', channelType: 'chat', name: '通常送信' },
    [{ student_id: 'S001', name: '生徒一郎' }],
    'user@example.com',
    {
      getClient: async () => dbClient,
      runBroadcastJob: async (...args) => { runnerCalls.push(args); }
    }
  );

  assert.equal(result.broadcastId, 77);
  assert.equal(result.total, 1);
  assert.ok(calls.some(call => call.sql === 'BEGIN'));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO broadcast_job_recipients')));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0][0], result.jobId);
});

test('jobs endpoint exposes only GAS-owned jobs', async () => {
  let getStatusCalls = 0;
  const deniedApp = createTestApp({
    query: async () => ({ rows: [] }),
    getBroadcastJobStatus: async () => { getStatusCalls++; }
  });
  const denied = await deniedApp.request('/jobs/normal-job', {
    headers: { 'X-API-Key': API_KEY }
  });
  assert.equal(denied.status, 404);
  assert.equal(getStatusCalls, 0);

  const allowedApp = createTestApp({
    query: async (sql, params) => {
      assert.match(sql, /bj\.created_by = \$2/);
      assert.match(sql, /bm\.created_by = \$2/);
      assert.deepEqual(params, ['gas-job', GAS_BROADCAST_CREATED_BY]);
      return { rows: [{ '?column?': 1 }] };
    },
    getBroadcastJobStatus: async () => ({
      job_id: 'gas-job',
      broadcast_id: 88,
      status: 'running',
      total: 130,
      sent: 80,
      failed: 1
    })
  });
  const allowed = await allowedApp.request('/jobs/gas-job', {
    headers: { 'X-API-Key': API_KEY }
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).job, {
    jobId: 'gas-job',
    broadcastId: 88,
    status: 'running',
    total: 130,
    sent: 80,
    failed: 1
  });
});

test('results endpoint exposes only GAS-owned broadcasts and maps up to 1000 logs', async () => {
  let logCalls = 0;
  const deniedApp = createTestApp({
    query: async () => ({ rows: [] }),
    getBroadcastLogs: async () => { logCalls++; return []; }
  });
  const denied = await deniedApp.request('/results/44', {
    headers: { 'X-API-Key': API_KEY }
  });
  assert.equal(denied.status, 404);
  assert.equal(logCalls, 0);

  const allowedApp = createTestApp({
    query: async (sql, params) => {
      assert.match(sql, /created_by = \$2/);
      assert.deepEqual(params, [44, GAS_BROADCAST_CREATED_BY]);
      return { rows: [{ '?column?': 1 }] };
    },
    getBroadcastLogs: async (broadcastId, limit) => {
      assert.equal(broadcastId, 44);
      assert.equal(limit, 1000);
      return [{
        student_id: 'S001',
        student_name: '生徒一郎',
        status: 'sent',
        error_message: null,
        sent_at: '2026-09-04T00:00:00.000Z'
      }];
    }
  });
  const allowed = await allowedApp.request('/results/44', {
    headers: { 'X-API-Key': API_KEY }
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).results, [{
    studentId: 'S001',
    studentName: '生徒一郎',
    status: 'sent',
    errorMessage: null,
    sentAt: '2026-09-04T00:00:00.000Z'
  }]);
});
