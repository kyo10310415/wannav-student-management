import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDailyStatsReport } from '../src/services/statsReportService.js';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
import { configureInternalApi } from '../src/security/internalApi.js';

const mockGet = async url => ({ data: { success: true,
  data: url.endsWith('by-team') ? [] : url.includes('/extensions/') ? null : {} } });

test('report reads protected statistics internally while anonymous and forged requests stay blocked', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  const app = new Hono();
  const dispatch = installApiAccess(app, { db: async () => { throw new Error('Unexpected session lookup'); } });
  const reached = [];
  const paths = ['/api/tutors/satisfaction/all', '/api/extensions/stats', '/api/extensions/by-team'];
  const exam = { extensionRate: 50, extensionCount: 1, targetCount: 2 };
  for (const path of paths) {
    app.get(path, c => {
      reached.push(path);
      return c.json({ success: true, data: path.includes('satisfaction')
        ? { '1': { '2026/10': { average: 9, count: 1 } } }
        : path.endsWith('by-team') ? [] : { ...exam, exam1st: exam, exam2nd: exam } });
    });
  }
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-webhook';
    for (const path of paths) {
      assert.equal((await app.request(path)).status, 401);
      assert.equal((await app.request(path, { headers: { 'X-Internal-Request': 'forged' } })).status, 403);
    }
    await assert.rejects(() => dispatch('/api/extensions/unrelated'), /Internal route is not allowed/);
    assert.equal(reached.length, 0);
    configureInternalApi(dispatch);
    const f = fixtures();
    delete f.dependencies.api; // Exercise the real default internal API, not a get mock.
    f.dependencies.http.get = async () => { throw new Error('Loopback HTTP must not be used'); };
    assert.equal((await sendDailyStatsReport(f.dependencies)).success, true);
    assert.deepEqual(reached.sort(), paths.sort());
    const content = f.posts[0].payload.content;
    assert.match(content, /満足度スコア平均: \*\*90\.00\*\*/);
    assert.match(content, /満足度スコア平均: 90\.00/);
    assert.match(content, /全体延長率: \*\*50%\*\*/);
    assert.equal(f.logs.length, 0);
  } finally {
    configureInternalApi(undefined);
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
});

function fixtures() {
  const posts = [];
  const logs = [];
  let reads = 0;
  return {
    posts, logs, get reads() { return reads; },
    dependencies: {
      now: () => new Date('2026-10-13T00:00:00Z'),
      query: async sql => {
        reads++;
        return { rows: sql.includes('FROM tutors')
          ? [1, 2].map(id => ({ employee_id: String(id), tutor_name: `Tutor${id}`, notion_name: `Tutor${id}`, team: 'テストチーム' }))
          : [{ student_id: 'TEST', homeroom_tutor: 'Tutor1', status: 'アクティブ' }] };
      },
      fetchWanami: async () => ({ TEST: 5 }),
      api: { get: mockGet },
      fetchCompleted: async () => { throw new Error('Completion filter should not run before 26th'); },
      http: {
        get: async () => ({ data: { success: true, data: {} } }),
        post: async (url, payload) => { posts.push({ url, payload }); }
      },
      logger: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) }
    }
  };
}

test('configured webhook preserves the existing complete message and payload', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  const oldRole = process.env.DISCORD_STATS_ROLE_ID;
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-webhook';
    process.env.DISCORD_STATS_ROLE_ID = '123';
    const fixture = fixtures();
    // Team statistics API returns an array, unlike satisfaction data.
    fixture.dependencies.api.get = mockGet;
    const result = await sendDailyStatsReport(fixture.dependencies);
    const date = fixture.dependencies.now().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    assert.deepEqual(result, { success: true, message: 'Stats report sent' });
    assert.equal(fixture.reads, 2);
    assert.equal(fixture.posts.length, 1);
    assert.equal(fixture.posts[0].url, process.env.DISCORD_STATS_WEBHOOK_URL);
    assert.deepEqual(fixture.posts[0].payload, {
      content: `<@&123>\n\n📊 **WannaV 中央管理システム - 日次統計レポート**\n📅 ${date}\n\n**【全体統計】**\n📈 満足度スコア平均: **-**\n💬 わなみさん使用回数合計: **5回**\n\n**【チーム別統計】**\n\n**テストチーム** (Tutor: 2名)\n├ 満足度スコア平均: -\n├ わなみさん使用回数: 5回\n└ 延長率: 延長対象なし\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 詳細は管理システムをご確認ください\nhttps://wannav-student-management.onrender.com`,
      username: 'WannaV 統計Bot', avatar_url: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    });
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
    if (oldRole === undefined) delete process.env.DISCORD_STATS_ROLE_ID; else process.env.DISCORD_STATS_ROLE_ID = oldRole;
  }
});

test('optional internal API failures preserve report delivery and do not log raw errors', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-webhook';
    const fixture = fixtures();
    fixture.dependencies.api.get = async () => { throw new Error('SENSITIVE_TEST_SENTINEL'); };
    const result = await sendDailyStatsReport(fixture.dependencies);
    assert.equal(result.success, true);
    assert.equal(fixture.posts.length, 1);
    assert.equal(JSON.stringify(fixture.logs).includes('SENSITIVE_TEST_SENTINEL'), false);
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
});

test('database generation failure is handled with a sanitized rejection', async () => {
  const fixture = fixtures();
  fixture.dependencies.api.get = mockGet;
  fixture.dependencies.query = async () => { throw new Error('SENSITIVE_TEST_SENTINEL'); };
  await assert.rejects(sendDailyStatsReport(fixture.dependencies), { message: 'Statistics report could not be generated or delivered' });
  assert.equal(fixture.posts.length, 0);
  assert.equal(JSON.stringify(fixture.logs).includes('SENSITIVE_TEST_SENTINEL'), false);
});

test('missing and whitespace webhook generate statistics but skip only delivery', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  try {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = value;
      const fixture = fixtures();
      fixture.dependencies.api.get = mockGet;
      const result = await sendDailyStatsReport(fixture.dependencies);
      assert.equal(result.skipped, true);
      assert.equal(fixture.reads, 2);
      assert.equal(fixture.posts.length, 0);
      assert.equal(fixture.logs.length, 1);
    }
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
});

test('failed delivery exposes neither Axios request data nor original error to callers', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-webhook';
    const fixture = fixtures();
    fixture.dependencies.api.get = mockGet;
    fixture.dependencies.http.post = async () => {
      throw Object.assign(new Error('SENSITIVE_TEST_SENTINEL'), { config: { url: process.env.DISCORD_STATS_WEBHOOK_URL } });
    };
    await assert.rejects(sendDailyStatsReport(fixture.dependencies), { message: 'Statistics report could not be generated or delivered' });
    assert.equal(JSON.stringify(fixture.logs).includes('SENSITIVE_TEST_SENTINEL'), false);
    assert.equal(JSON.stringify(fixture.logs).includes('example.invalid'), false);
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
});

test('team identity and satisfaction aggregates stay in the intended report but not operational logs', async t => {
  const consoleLogs = [];
  t.mock.method(console, 'log', (...args) => consoleLogs.push(args));
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-webhook';
    const fixture = fixtures();
    const query = fixture.dependencies.query;
    fixture.dependencies.query = async sql => {
      const result = await query(sql);
      if (sql.includes('FROM tutors')) result.rows.forEach(row => { row.team = 'SYNTHETIC_TEAM_PRIVATE'; });
      return result;
    };
    fixture.dependencies.api.get = mockGet;
    assert.equal((await sendDailyStatsReport(fixture.dependencies)).success, true);
    assert.equal(fixture.posts[0].payload.content.includes('SYNTHETIC_TEAM_PRIVATE'), true);
    assert.equal(JSON.stringify(consoleLogs).includes('SYNTHETIC_TEAM_PRIVATE'), false);
    assert.equal(JSON.stringify(consoleLogs).includes('avg='), false);
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
});
