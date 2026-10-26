import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_DAILY_REMINDER_PRIVATE';
let sequence = 0;
const tutor = { tutor_id: 1, tutor_name: marker, team: marker, email: marker, discord_webhook_url: marker, discord_user_id: marker };
const leader = { team: marker, discord_webhook_url: marker + '-leader', discord_user_id: marker + '-leader' };
const rawError = () => Object.assign(new Error(marker), { config: { url: marker }, response: { data: marker } });
async function fixture({ enabled = true, lessonIds = [1], submittedIds = [], tutors = [tutor], leaders = [leader], queryFail = false, sendFail = false } = {}) {
  const logs = [], queries = [], posts = [], waits = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-26T03:00:00Z'])); }
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getDate() { return this.getUTCDate(); }
    setDate(day) { return this.setUTCDate(day); }
  }
  const deps = { Date: FixedDate, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    setTimeout: (resolve, ms) => { waits.push(ms); resolve(); },
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryFail) throw rawError();
      if (sql.includes('FROM system_settings')) return { rows: [{ setting_value: String(enabled) }] };
      if (sql.includes('FROM lessons l')) return { rows: lessonIds.map(tutor_id => ({ tutor_id })) };
      if (sql.includes('FROM daily_reports')) return { rows: submittedIds.map(tutor_id => ({ tutor_id })) };
      if (sql.includes('FROM tutors t')) return { rows: tutors };
      if (sql.includes('FROM users u')) return { rows: leaders };
      throw new Error('Unexpected fixture query');
    }, axios: { post: async (url, body) => { posts.push({ url, body }); if (sendFail) throw rawError(); return {}; } } };
  const source = (await readFile(new URL('../src/jobs/dailyReportReminder.js', import.meta.url), 'utf8'))
    .replace("import { query } from '../db/connection.js';", 'const { query } = deps;')
    .replace("import axios from 'axios';", 'const { axios } = deps;');
  const key = 'dailyReminderPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let run;
  try { run = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, Date, setTimeout } = deps;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { run, logs, queries, posts, waits };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('daily reminder preserves tutor and team-leader payloads, previous-day SQL and pacing', async () => {
  const f = await fixture({ lessonIds: [1, 2], submittedIds: [2] });
  assert.equal(await f.run(), undefined);
  assert.deepEqual(f.queries[1].params, ['2026-10-25']);
  assert.deepEqual(f.queries[3].params, [[1]]);
  assert.match(f.queries[3].sql, /u.job_title = 'クルー'/);
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0].url, marker);
  assert.equal(f.posts[0].body.content, `<@${marker}>`);
  assert.equal(f.posts[0].body.embeds[0].title, '日報未提出のお知らせ');
  assert.match(f.posts[0].body.embeds[0].description, /2026\/10\/25/);
  assert.equal(f.posts[0].body.embeds[0].fields[1].value, marker);
  assert.equal(f.posts[1].url, marker + '-leader');
  assert.equal(f.posts[1].body.embeds[0].title, '【チームリーダー通知】日報未提出のお知らせ');
  assert.deepEqual(f.waits, [300]);
  safe(f);
});

test('disabled, no-lesson, submitted and no-crew cases retain early skips without delivery', async () => {
  for (const options of [{ enabled: false }, { lessonIds: [] }, { submittedIds: [1] }, { tutors: [] }]) {
    const f = await fixture(options);
    await f.run();
    assert.equal(f.posts.length, 0);
    assert.deepEqual(f.waits, []);
    safe(f);
  }
});

test('missing tutor webhook and duplicate or different-team leaders preserve recipient rules privately', async () => {
  const missing = await fixture({ tutors: [{ ...tutor, discord_webhook_url: null }] });
  await missing.run();
  assert.equal(missing.posts.length, 1);
  assert.equal(missing.posts[0].url, leader.discord_webhook_url);
  safe(missing);
  const duplicate = await fixture({ leaders: [{ ...leader, discord_webhook_url: marker }, { ...leader, team: 'other' }] });
  await duplicate.run();
  assert.equal(duplicate.posts.length, 1);
  safe(duplicate);
});

test('upstream notification failures remain swallowed and allow later recipients without exposing secrets', async () => {
  const f = await fixture({ sendFail: true });
  assert.equal(await f.run(), undefined);
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.waits, [300]);
  safe(f);
});

test('top-level database failures remain private and do not send', async () => {
  const f = await fixture({ queryFail: true });
  assert.equal(await f.run(), undefined);
  assert.equal(f.posts.length, 0);
  safe(f);
});
