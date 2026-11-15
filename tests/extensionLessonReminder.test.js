import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionLessonReminder, reminderPayload } from '../src/jobs/extensionLessonReminder.js';

const student = { student_id: 'TEST-01', name: 'テスト生徒', tutor_user_id: 1,
  discord_user_id: '123456789012345678', discord_webhook_url: 'https://discord.com/api/webhooks/123456789012345678/synthetic',
  notion_url: 'https://www.notion.so/0123456789abcdef0123456789abcdef' };
function fixture({ rows = [student], targetFail = false, failures = [] } = {}) {
  const states = new Map(), posts = [], queries = [];
  let clock = new Date('2026-11-15T01:00:00Z');
  const deps = { now: () => clock,
    db: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.startsWith('CREATE')) return { rows: [] };
      if (sql.startsWith('SELECT')) return { rows };
      const key = JSON.stringify(args.slice(0, 4));
      if (sql.startsWith('INSERT')) {
        if (states.has(key) && states.get(key) !== 'failed') return { rows: [] };
        states.set(key, 'sending'); return { rows: [{ student_id: args[0] }] };
      }
      states.set(key, sql.includes("status='sent'") ? 'sent' : args[4]);
      return { rows: [] };
    },
    targets: async () => {
      if (targetFail) throw new Error('synthetic private error');
      return { month: '2026-11', data: [{ studentId: 'TEST-01', examination: [2, 2], hearing: [4] }] };
    },
    post: async (url, body, options) => {
      posts.push({ url, body, options });
      const failure = failures.shift(); if (failure) throw failure;
    },
  };
  return { run: createExtensionLessonReminder(deps), restart: () => createExtensionLessonReminder(deps), posts, states, queries,
    setTime: value => { clock = new Date(value); } };
}

test('payload includes all requested fields and permits only the assigned Tutor mention', () => {
  const payload = reminderPayload(student, 'examination', 2);
  assert.match(payload.content, /<@123456789012345678>/);
  assert.deepEqual(payload.allowed_mentions, { parse: [], users: [student.discord_user_id] });
  assert.deepEqual(payload.embeds[0].fields.map(f => f.value), ['テスト生徒', 'TEST-01', student.notion_url, '延長審査', '2回目']);
  assert.equal(reminderPayload({ ...student, notion_url: 'javascript:bad' }, 'hearing', 4).embeds[0].fields[2].value, '未設定');
});
test('runs at 10 JST, sends both types once, and persists deduplication across restarts', async () => {
  const f = fixture();
  f.setTime('2026-11-15T00:59:00Z'); await f.run(); assert.equal(f.queries.length, 0);
  f.setTime('2026-11-15T01:00:00Z'); await Promise.all([f.run(), f.run()]);
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0].options.timeout, 15000);
  assert.equal(f.posts[0].options.maxRedirects, 0);
  await f.run(); await f.restart()(); assert.equal(f.posts.length, 2);
  f.setTime('2026-11-16T01:00:00Z'); await f.run(); assert.equal(f.posts.length, 4);
  const selected = f.queries.find(q => q.sql.startsWith('SELECT'));
  assert.match(selected.sql, /l.lesson_date::date=\$1::date/);
  assert.match(selected.sql, /s.homeroom_tutor/);
  assert.equal(selected.args[0], '2026-11-15');
});
test('ambiguous Tutor, missing settings, and target fetch errors send nothing', async () => {
  for (const options of [{ rows: [student, { ...student, tutor_user_id: 2 }] },
    { rows: [{ ...student, discord_user_id: '' }] }, { rows: [{ ...student, discord_webhook_url: 'https://other.example/private' }] },
    { rows: [] }, { targetFail: true }]) {
    const f = fixture(options); await f.run(); assert.equal(f.posts.length, 0);
    assert.equal(f.states.size, 0);
  }
});
test('confirmed rejection can retry; timeout remains unknown to avoid duplicate notifications', async () => {
  const f = fixture({ failures: [Object.assign(new Error('rejected'), { response: { status: 429 } })] });
  await f.run(); assert.equal(f.posts.length, 2);
  await f.run(); assert.equal(f.posts.length, 3);
  assert.ok([...f.states.values()].every(s => s === 'sent'));
  const g = fixture({ failures: [new Error('timeout')] });
  await g.run(); await g.restart()(); assert.equal(g.posts.length, 2);
  assert.ok([...g.states.values()].includes('unknown'));
});
