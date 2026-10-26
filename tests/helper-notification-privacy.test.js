import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

const marker = 'SYNTHETIC_HELPER_NOTIFICATION_PRIVATE';
const data = { id: marker, student_name: marker, student_id: marker, requesting_tutor_name: marker, accepted_by_tutor_name: marker,
  lesson_date: '2026-10-27', lesson_time: '17:30', deadline: '2026-10-26T03:00:00Z', accepted_at: '2026-10-26T02:00:00Z',
  lesson_progress: 3, reason: marker.repeat(100), notes: marker.repeat(100), notion_url: 'https://fixture.example.test/' + marker };
let sequence = 0;
async function fixture({ configured = true, fail = false } = {}) {
  const logs = [], posts = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-27T00:00:00Z'])); } }
  const deps = { Date: FixedDate, process: { env: { APP_URL: 'https://fixture.example.test', ...(configured ? { DISCORD_HELPER_WEBHOOK_URL: marker } : {}) } },
    console: Object.fromEntries(['log', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    axios: { post: async (...args) => { posts.push(args); if (fail) throw Object.assign(new Error(marker), { response: { data: marker }, config: { url: marker } }); return { status: 204 }; } } };
  const source = (await readFile(new URL('../src/services/helperNotificationService.js', import.meta.url), 'utf8'))
    .replace("import axios from 'axios';", 'const { axios } = deps;');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'helperNotificationPrivacy' + sequence++;
  globalThis[key] = deps;
  let api;
  try { api = await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process, Date } = deps;\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
  return { api, posts, logs };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
const methods = ['notifyHelperRequestCreated', 'notifyHelperRequestAccepted', 'notifyHelperRequestsRescheduled'];

test('missing webhook and empty reschedule inputs preserve no-send undefined returns', async () => {
  const f = await fixture({ configured: false });
  for (const name of methods) assert.equal(await f.api[name](name.endsWith('Rescheduled') ? [data] : data), undefined);
  assert.equal(f.posts.length, 0); safe(f);
  const empty = await fixture(); assert.equal(await empty.api.notifyHelperRequestsRescheduled([]), undefined); assert.equal(empty.posts.length, 0); safe(empty);
});

test('created notification preserves destination, mentions, fields, truncation and timestamp', async () => {
  const f = await fixture(); assert.equal(await f.api.notifyHelperRequestCreated(data), undefined);
  const [url, body] = f.posts[0]; assert.equal(url, marker); assert.equal(body.content, '@everyone');
  const embed = body.embeds[0]; assert.equal(embed.timestamp, '2026-10-27T00:00:00.000Z');
  assert.equal(embed.fields[1].value, '17時～'); assert.equal(embed.fields[2].value, `${marker} (${marker})`);
  assert.equal(embed.fields[3].value, marker); assert.equal(embed.fields[4].value, '3回');
  assert.equal(embed.fields[5].value, data.reason.slice(0, 1000)); assert.equal(embed.fields[6].value, data.notes.slice(0, 1000));
  assert.equal(embed.fields.at(-2).value, 'https://fixture.example.test/#helpers'); assert.equal(embed.fields.at(-1).value, data.notion_url);
  assert.equal(embed.footer.text, `依頼ID: #${marker}`); safe(f);
});

test('created notification keeps PRO, missing-time and optional-notes behavior', async () => {
  const f = await fixture(); await f.api.notifyHelperRequestCreated({ ...data, lesson_progress: null, lesson_time: null, notes: '' });
  const fields = f.posts[0][1].embeds[0].fields;
  assert.equal(fields[1].value, '未設定'); assert.equal(fields[4].value, 'Proプラン'); assert.equal(fields.some(field => field.name === '備考'), false); safe(f);
});

test('accepted notification preserves content contract and recipient details without identifying logs', async () => {
  const f = await fixture(); assert.equal(await f.api.notifyHelperRequestAccepted(data), undefined);
  const [url, body] = f.posts[0]; assert.equal(url, marker); assert.equal(Object.hasOwn(body, 'content'), false);
  const embed = body.embeds[0]; assert.equal(embed.fields[1].value, '17:30'); assert.equal(embed.fields[2].value, marker);
  assert.equal(embed.fields[3].value, marker); assert.equal(embed.fields[5].value, `**${marker}**`);
  assert.equal(embed.fields[6].value, data.reason.slice(0, 1000)); assert.equal(embed.fields.at(-1).value, data.notion_url); safe(f);
});

test('reschedule notifications preserve ten-item limit, total count, mentions and remaining footer', async () => {
  const f = await fixture(); const rows = Array.from({ length: 12 }, (_, index) => ({ ...data, id: marker + index }));
  assert.equal(await f.api.notifyHelperRequestsRescheduled(rows), undefined);
  const [url, body] = f.posts[0]; assert.equal(url, marker); assert.equal(body.content, '@everyone');
  const embed = body.embeds[0]; assert.equal(embed.fields.length, 10); assert.equal(embed.footer.text, '他2件');
  assert.equal(embed.fields[0].name, `#${marker}0 - ${marker}`); assert.ok(embed.description.includes('12件')); safe(f);
});

test('upstream failures and request-format exceptions stay swallowed with fixed private logs', async () => {
  const f = await fixture({ fail: true });
  for (const name of methods) assert.equal(await f.api[name](name.endsWith('Rescheduled') ? [data] : data), undefined);
  assert.equal(f.posts.length, 3); assert.equal(f.logs.length, 3); safe(f);
  const malformed = await fixture(); const bad = { ...data }; Object.defineProperty(bad, 'reason', { get() { throw new Error(marker); } });
  assert.equal(await malformed.api.notifyHelperRequestCreated(bad), undefined); assert.equal(malformed.posts.length, 0); safe(malformed);
});
