import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../public/redlist-update.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/redlist-update.js', import.meta.url), 'utf8');
function fixture(fetch) {
  const elements = Object.fromEntries(['updateBtn','status','result'].map(id => [id, {
    disabled: false, textContent: '', innerHTML: '',
    classList: { add() {}, remove() {} },
    addEventListener(event, callback) { this[event] = callback; }
  }]));
  vm.runInNewContext(script, { document: { getElementById: id => elements[id] }, fetch });
  return elements;
}
test('redlist page loads external script after its button without inline handlers', () => {
  assert.match(html, /<script src="\/redlist-update\.js"><\/script>/);
  assert.equal(/<script\s*>|\sonclick\s*=/i.test(html), false);
  assert.ok(html.indexOf('id="updateBtn"') < html.indexOf('src="/redlist-update.js"'));
});
test('redlist external listener preserves POST contract, pending state and success rendering', async () => {
  let resolveFetch, request;
  const elements = fixture((path, options) => { request = {path, options}; return new Promise(resolve => { resolveFetch = resolve; }); });
  assert.equal(request, undefined);
  const pending = elements.updateBtn.click();
  assert.equal(elements.updateBtn.disabled, true);
  assert.equal(request.path, '/api/red-list/update');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  resolveFetch({ json: async () => ({ success: true, data: { updated: 3, errors: 1 } }) });
  await pending;
  assert.match(elements.result.innerHTML, /3 名の生徒/);
  assert.match(elements.result.innerHTML, /エラー: 1 件/);
  assert.equal(elements.updateBtn.disabled, false);
  assert.equal(elements.updateBtn.textContent, '再計算を実行');
});
test('redlist application and transport failures preserve error display and re-enable button', async () => {
  for (const fetch of [async () => ({ json: async () => ({success:false,error:'synthetic failure'}) }), async () => { throw Error('synthetic failure'); }]) {
    const elements = fixture(fetch);
    await elements.updateBtn.click();
    assert.match(elements.result.innerHTML, /synthetic failure/);
    assert.equal(elements.updateBtn.disabled, false);
  }
});
