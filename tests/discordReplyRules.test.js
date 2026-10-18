import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReplyMessage, buildReplyAlert, REPLY_ALERT_DELAY_MS, fetchReplyRecoveryMessages, replyChatbotIds, isReplyChatbotQuestion } from '../src/services/discordReplyRules.js';

test('only configured AI bot mentions and replies are excluded; ordinary posts remain eligible', async()=>{
  const id='123456789012345678', other='223456789012345678';
  const ids=replyChatbotIds(id+', '+other+' invalid');
  assert.equal(ids.size,2);
  assert.equal(await isReplyChatbotQuestion({mentions:{users:new Set([id])}},ids,()=>{throw new Error('Unexpected read');}),true);
  assert.equal(await isReplyChatbotQuestion({reference:{messageId:'reference'}},ids,async()=>({author:{id}})),true);
  assert.equal(await isReplyChatbotQuestion({reference:{messageId:'reference'}},ids,async()=>({author:{id:'staff'}})),false);
  assert.equal(await isReplyChatbotQuestion({mentions:{users:new Set(['staff'])}},ids),false);
  assert.equal(await isReplyChatbotQuestion({},ids),false);
  assert.equal(await isReplyChatbotQuestion({reference:{messageId:'reference'}},new Set(),()=>{throw new Error('Unexpected read');}),false);
  await assert.rejects(isReplyChatbotQuestion({reference:{messageId:'reference'}},ids,async()=>{throw new Error('Denied');}),/Denied/);
});

const staff = new Set(['200', '300']);
test('recovery paginates beyond 100 and processes oldest first without replaying the cursor', async () => {
  const calls = [];
  const makePage = (first, count) => new Map(Array.from({ length: count }, (_, index) => {
    const id = String(first - index);
    return [id, { id }];
  }));
  const pages = [makePage(210, 100), makePage(110, 100)];
  const result = await fetchReplyRecoveryMessages(async options => {
    calls.push(options);
    return pages.shift();
  }, '50');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].before, '111');
  assert.equal(calls[0].cache, false);
  assert.equal(result.length, 160);
  assert.equal(result[0].id, '51');
  assert.equal(result.at(-1).id, '210');
});
test('failed history reads are propagated, not interpreted as no reply', async () => {
  await assert.rejects(fetchReplyRecoveryMessages(async () => { throw new Error('Forbidden'); }, '50'), /Forbidden/);
});
test('student thanks and attachments also start reply waiting', () => {
  for (const content of ['ありがとう', '', '質問です']) {
    assert.equal(classifyReplyMessage({ author: { id: '100' }, content }, '100', staff), 'student');
  }
});
test('any registered staff reply counts, not only assigned tutor', () => {
  for (const id of staff) assert.equal(classifyReplyMessage({ author: { id } }, '100', staff), 'staff');
});
test('bot reminders and unrelated users do not clear waiting', () => {
  assert.equal(classifyReplyMessage({ author: { id: '200', bot: true } }, '100', staff), 'ignore');
  assert.equal(classifyReplyMessage({ author: { id: '400' } }, '100', staff), 'ignore');
});
test('12 hours means elapsed time, without business-hour exclusions', () => {
  assert.equal(REPLY_ALERT_DELAY_MS, 43200000);
});
test('notification contains requested fields and JST timestamp without unintended mentions', () => {
  const content = buildReplyAlert({
    student_name: '@everyone 生徒', tutor_name: '先生', posted_at: '2026-10-08T00:00:00Z',
    guild_id: '1', channel_id: '2', message_id: '3'
  });
  assert.ok(content.startsWith('以下の生徒様への返信が出来てない可能性があります。確認してください'));
  assert.ok(content.includes('生徒名：＠everyone 生徒'));
  assert.ok(content.includes('担当Tutor：先生'));
  assert.ok(content.includes('9:00:00'));
  assert.ok(content.includes('https://discord.com/channels/1/2/3'));
});
