import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../public/vq-resend.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/vq-resend.js', import.meta.url), 'utf8');
function fixture({ fetch = async () => { throw Error('unexpected fixture fetch'); }, confirmed = true } = {}) {
  const requests = [], confirmations = [], timers = [];
  const elements = Object.fromEntries(['singleRow','startRow','searchStudentId','status','result','historyList','resendSingleRowBtn','resendFromRowBtn','loadHistoryBtn'].map(id => [id, {
    value: '', innerHTML: '', contains: () => true,
    addEventListener(event, callback) { this[event] = callback; }
  }]));
  const context = {
    document: { getElementById: id => elements[id] },
    fetch: async (path, options) => { requests.push({path,options}); return fetch(path, options); },
    confirm: message => { confirmations.push(message); return confirmed; },
    setTimeout: (callback, delay) => { timers.push({callback,delay}); },
    console: { error() {} }
  };
  vm.runInNewContext(script, context);
  return {elements,requests,confirmations,timers};
}
const response = value => ({json: async () => value});
const history = [{id:17,student_name_current:"Synthetic O'Name",diagnosis_type:'synthetic',sheet_row_number:2,sent_at:'2026-01-01T00:00:00Z'}];
function deletionEvent(f, index = '0', inside = true) {
  const button = {dataset:{historyIndex:index}};
  f.elements.historyList.contains = () => inside;
  return {target:{closest: () => button},currentTarget:f.elements.historyList};
}
test('VQ page preserves script position and replaces static and generated inline handlers', () => {
  assert.match(html, /<script src="\/vq-resend\.js"><\/script>/);
  assert.equal(/<script\s*>|\sonclick\s*=/i.test(html), false);
  assert.equal(/onclick\s*=/.test(script), false);
  for (const id of ['resendSingleRowBtn','resendFromRowBtn','loadHistoryBtn']) assert.ok(html.indexOf(`id="${id}"`) < html.indexOf('src="/vq-resend.js"'));
});
test('VQ invalid single and range rows do not call the API', async () => {
  for (const [input,button] of [['singleRow','resendSingleRowBtn'],['startRow','resendFromRowBtn']]) {
    for (const value of ['', '1']) {
      const f = fixture(); f.elements[input].value = value;
      await f.elements[button].click();
      assert.equal(f.requests.length, 0);
      assert.match(f.elements.status.innerHTML, /2以上/);
    }
  }
});
test('VQ single and range listeners preserve POST payloads and success output', async () => {
  for (const [input,button,path,key,data] of [
    ['singleRow','resendSingleRowBtn','/api/vq-diagnosis/resend-single-row','rowNumber',{rowNumber:2,studentId:'synthetic',studentName:'Synthetic',diagnosisType:'synthetic'}],
    ['startRow','resendFromRowBtn','/api/vq-diagnosis/resend-from-row','startRow',{processed:3,errors:1}]
  ]) {
    const f=fixture({fetch:async()=>response({success:true,message:'synthetic success',data})});
    assert.equal(f.requests.length,0);f.elements[input].value='2';await f.elements[button].click();
    assert.equal(f.requests[0].path,path);assert.equal(f.requests[0].options.method,'POST');
    assert.deepEqual(JSON.parse(f.requests[0].options.body),{[key]:2});
    assert.equal(f.requests[0].options.headers['Content-Type'],'application/json');
    assert.match(f.elements.status.innerHTML,/synthetic success/);assert.ok(f.elements.result.innerHTML.length>0);
  }
});
test('VQ resend application and network failures preserve error display and timer', async () => {
  for (const button of ['resendSingleRowBtn','resendFromRowBtn']) {
    for (const fetch of [async()=>response({success:false,error:'synthetic failure'}),async()=>{throw Error('synthetic failure');}]) {
      const f=fixture({fetch});f.elements.singleRow.value='2';f.elements.startRow.value='2';await f.elements[button].click();
      assert.match(f.elements.status.innerHTML,/synthetic failure/);assert.equal(f.timers[0].delay,5000);
      f.timers[0].callback();assert.equal(f.elements.status.innerHTML,'');
    }
  }
});
test('VQ history encodes the filter and renders indexed delete buttons without name attributes', async () => {
  const f=fixture({fetch:async()=>response({success:true,history})});f.elements.searchStudentId.value=' SYN &TEST ';
  await f.elements.loadHistoryBtn.click();
  assert.equal(f.requests[0].path,'/api/vq-diagnosis/history?limit=50&student_id=SYN%20%26TEST');
  assert.match(f.elements.historyList.innerHTML,/data-history-index="0"/);
  assert.equal(/onclick=|data-student-name=/.test(f.elements.historyList.innerHTML),false);
});
test('VQ history deletion cancellation and invalid delegation targets do not delete', async () => {
  const f=fixture({fetch:async()=>response({success:true,history}),confirmed:false});await f.elements.loadHistoryBtn.click();
  await f.elements.historyList.click(deletionEvent(f));assert.equal(f.requests.length,1);assert.match(f.confirmations[0],/Synthetic O'Name/);
  for (const [index,inside] of [['-1',true],['99',true],['not-a-number',true],['0',false]]) await f.elements.historyList.click(deletionEvent(f,index,inside));
  assert.equal(f.requests.length,1);assert.equal(f.confirmations.length,1);
});
test('VQ delegated delete preserves ID, confirmation, success reload and failure contracts', async () => {
  for (const mode of ['success','application-error','network-error']) {
    const f=fixture({fetch:async(path,options)=>{
      if(options?.method!=='DELETE')return response({success:true,history});
      if(mode==='network-error')throw Error('synthetic failure');
      return response(mode==='success'?{success:true}:{success:false,error:'synthetic failure'});
    }});
    await f.elements.loadHistoryBtn.click();await f.elements.historyList.click(deletionEvent(f));
    assert.equal(f.requests[1].path,'/api/vq-diagnosis/history/17');assert.equal(f.requests[1].options.method,'DELETE');
    assert.equal(f.confirmations.length,1);
    if(mode==='success'){assert.match(f.elements.status.innerHTML,/履歴を削除しました: Synthetic O'Name/);assert.equal(f.requests.length,3);assert.equal(f.timers[0].delay,3000);}
    else{assert.match(f.elements.status.innerHTML,/synthetic failure/);assert.equal(f.requests.length,2);}
  }
});
test('VQ empty and failed history requests preserve existing fallback output', async () => {
  for(const fetch of [async()=>response({success:true,history:[]}),async()=>response({success:false})]){
    const f=fixture({fetch});await f.elements.loadHistoryBtn.click();assert.match(f.elements.historyList.innerHTML,/履歴がありません/);
  }
  const f=fixture({fetch:async()=>{throw Error('synthetic failure');}});await f.elements.loadHistoryBtn.click();assert.match(f.elements.historyList.innerHTML,/エラーが発生/);
});
