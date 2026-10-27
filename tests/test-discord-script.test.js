import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../public/test-discord.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/test-discord.js', import.meta.url), 'utf8');
function fixture(fetch, value = 'SYNTHETIC') {
  const elements = Object.fromEntries(['studentId','status','result','testDiscordButton'].map(id => [id, {
    value, innerHTML:'', addEventListener(event, callback) { this[event] = callback; }
  }]));
  vm.runInNewContext(script, { document: {getElementById:id=>elements[id]}, fetch, console:{error(){}} });
  return elements;
}
test('Discord test page loads external script after controls and has no inline script or handler', () => {
  assert.match(html, /<script src="\/test-discord\.js"><\/script>/);
  assert.equal(/<script\s*>|\sonclick\s*=/i.test(html), false);
  assert.ok(html.indexOf('id="testDiscordButton"') < html.indexOf('src="/test-discord.js"'));
});
test('Discord test listener validates blank input without sending and otherwise preserves POST contract', async () => {
  let requests=[];
  const fetch = async (path, options) => { requests.push({path, options}); return {json:async()=>({success:true,message:'synthetic success',discordStatus:200,discordData:{ok:true}})}; };
  const empty=fixture(fetch,'  '); await empty.testDiscordButton.click();
  assert.equal(requests.length,0); assert.match(empty.status.innerHTML,/学籍番号を入力/);
  const ok=fixture(fetch,' SYNTHETIC ');
  assert.equal(requests.length,0); await ok.testDiscordButton.click();
  assert.equal(requests[0].path,'/api/survey/test-discord-webhook');
  assert.equal(requests[0].options.method,'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body),{studentId:'SYNTHETIC'});
  assert.equal(requests[0].options.headers['Content-Type'],'application/json');
  assert.match(ok.status.innerHTML,/synthetic success/);assert.match(ok.result.innerHTML,/200/);
});
test('Discord test listener preserves application and transport error feedback', async () => {
  const failed=fixture(async()=>({json:async()=>({success:false,error:'synthetic rejection',discordError:{code:1}})}));
  await failed.testDiscordButton.click();assert.match(failed.status.innerHTML,/synthetic rejection/);assert.match(failed.result.innerHTML,/Discord APIエラー/);
  const thrown=fixture(async()=>{throw Error('synthetic transport')});
  await thrown.testDiscordButton.click();assert.match(thrown.status.innerHTML,/synthetic transport/);
});
