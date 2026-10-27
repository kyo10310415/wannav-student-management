import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../public/redlist.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/redlist.js', import.meta.url), 'utf8');
const currentRows = () => [
  {student_id:'LOW',rank:'low',total_score:2,year_month:'2026-10'},
  {student_id:'HIGH',rank:'high',total_score:8,year_month:'2026-10'},
  {student_id:'MID',rank:'middle',total_score:4,year_month:'2026-10'},
  {student_id:'NONE',rank:'none',total_score:0,year_month:'2026-10'}
];
function element(id='') {
  const hidden = new Set();
  return {id,value:'',textContent:'',innerHTML:'',className:'',children:[],listeners:{},
    classList:{add:v=>hidden.add(v),remove:v=>hidden.delete(v),contains:v=>hidden.has(v),toggle:(v,on)=>on?hidden.add(v):hidden.delete(v)},
    addEventListener(event,callback){this.listeners[event]=callback;},
    appendChild(child){this.children.push(child);},remove(){this.removed=true;},
    contains(child){return child.inside!==false;}
  };
}
async function fixture({rows=currentRows(),cacheFail=false,currentFail=false,history=[],historyFail=false,get}={}) {
  const ids=['refreshBtn','tab-current','tab-history','history-month','current-content','history-content','current-loading','history-loading','current-list','history-list','count-high','count-middle','count-low','count-resolved'];
  const elements=Object.fromEntries(ids.map(id=>[id,element(id)]));
  const requests=[],logs=[],timers=[],body=element('body');
  const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>element(),body},
    axios:{get:async path=>{
      requests.push(path);
      if(get)return get(path,elements);
      if(path==='/api/students/cache'){
        if(cacheFail)throw Error('synthetic cache failure');
        return {data:{success:true,data:[{student_id:'HIGH',name:'Synthetic cache name',youtube_channel_id:'@fixture',x_account_id:'@fixture'}],notionUrls:{}}};
      }
      if(path==='/api/red-list') {if(currentFail)throw Error('synthetic current failure');return {data:{success:true,data:rows}};}
      if(path.startsWith('/api/red-list/history?')) {if(historyFail)throw Error('synthetic history failure');return {data:{success:true,data:history}};}
      throw Error('Unexpected fixture path');
    }},
    console:{log:(...args)=>logs.push(args.join(' ')),error:()=>{}},
    setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;},
    Date:class extends Date {constructor(...args){super(...(args.length?args:['2026-10-27T12:00:00Z']));}}
  });
  vm.runInContext(source.replace(/init\(\);\s*$/, 'globalThis.initialized=init();'),context);
  await context.initialized;
  return {elements,requests,logs,timers,body,context};
}
test('redlist loads its external script after controls and contains no inline script or HTML handler',()=>{
  assert.match(html,/<script src="\/redlist\.js"><\/script>/);
  assert.ok(html.indexOf('id="current-content"')<html.indexOf('src="/redlist.js"'));
  assert.equal(/<script\s*>|\son(?:click|change)\s*=/i.test(html),false);
  assert.equal(/\sonchange\s*=/.test(source),false);
});
test('redlist initialization preserves cache-first ordering, filtering, sorting, summary and past-month options',async()=>{
  const f=await fixture();
  assert.deepEqual(f.requests,['/api/students/cache','/api/red-list']);
  const content=f.elements['current-content'].innerHTML;
  assert.ok(content.indexOf('Synthetic cache name')<content.indexOf('MID'));
  assert.ok(content.indexOf('MID')<content.indexOf('LOW'));
  assert.equal(content.includes('NONE'),false);
  for(const rank of ['high','middle','low'])assert.equal(f.elements['count-'+rank].textContent,1);
  assert.equal(f.elements['count-resolved'].textContent,0);
  assert.equal(f.elements['current-loading'].classList.contains('hidden'),true);
  assert.equal(f.elements['current-content'].classList.contains('hidden'),false);
  const options=f.elements['history-month'].children;
  assert.equal(options.length,12);assert.equal(options[0].value,'2026-09');assert.equal(options.at(-1).value,'2025-10');
});
test('redlist empty and current errors preserve feedback and finally visibility; cache failure still loads current',async()=>{
  const empty=await fixture({rows:[]});assert.match(empty.elements['current-content'].innerHTML,/該当する生徒はいません/);
  const failure=await fixture({cacheFail:true,currentFail:true});
  assert.deepEqual(failure.requests,['/api/students/cache','/api/red-list']);
  assert.match(failure.elements['current-content'].innerHTML,/データの読み込みに失敗/);
  assert.equal(failure.elements['current-loading'].classList.contains('hidden'),true);
  assert.equal(failure.elements['current-content'].classList.contains('hidden'),false);
  const cache=await fixture({cacheFail:true});assert.match(cache.elements['current-content'].innerHTML,/HIGH/);
});
test('redlist tab switches are local only and refresh loads the selected tab without refetching cache',async()=>{
  const f=await fixture();const initial=f.requests.length;
  f.elements['tab-history'].listeners.click();
  assert.equal(f.requests.length,initial);
  assert.equal(f.elements['current-list'].classList.contains('hidden'),true);
  assert.equal(f.elements['history-list'].classList.contains('hidden'),false);
  await f.elements.refreshBtn.listeners.click();assert.equal(f.requests.length,initial);
  f.elements['history-month'].value='2026-09';await f.elements.refreshBtn.listeners.click();
  assert.equal(f.requests.at(-1),'/api/red-list/history?yearMonth=2026-09');
  f.elements['tab-current'].listeners.click();await f.elements.refreshBtn.listeners.click();
  assert.equal(f.requests.at(-1),'/api/red-list');
  assert.equal(f.requests.filter(p=>p==='/api/students/cache').length,1);
});
test('redlist history filters final rank and final score, omits status controls and handles empty/error selections',async()=>{
  const history=[{student_id:'HLOW',final_rank:'low',final_score:2,year_month:'2026-09'},{student_id:'HHIGH',final_rank:'high',final_score:9,year_month:'2026-09'},{student_id:'OMIT',final_rank:'none',final_score:0}];
  const f=await fixture({history});f.elements['history-month'].value='2026-09';await f.elements['history-month'].listeners.change();
  const content=f.elements['history-content'].innerHTML;
  assert.ok(content.indexOf('HHIGH')<content.indexOf('HLOW'));assert.equal(content.includes('OMIT'),false);
  assert.equal(content.includes('status-dropdown'),false);assert.equal(f.elements['count-high'].textContent,1);
  const count=f.requests.length;f.elements['history-month'].value='';await f.elements['history-month'].listeners.change();
  assert.equal(f.requests.length,count);assert.equal(f.elements['history-content'].innerHTML,'');
  const empty=await fixture();empty.elements['history-month'].value='2026-08';await empty.elements['history-month'].listeners.change();assert.match(empty.elements['history-content'].innerHTML,/この月のレッドリストデータがありません/);
  const failed=await fixture({historyFail:true});failed.elements['history-month'].value='2026-09';await failed.elements['history-month'].listeners.change();assert.match(failed.elements['history-content'].innerHTML,/読み込みに失敗/);assert.equal(failed.elements['history-loading'].classList.contains('hidden'),true);
});
test('redlist requests expose their pending loading state before finally restoring visibility',async()=>{
  let resolveCurrent;
  const pending=fixture({get:async(path,elements)=>{
    if(path==='/api/students/cache')return {data:{success:true,data:[],notionUrls:{}}};
    assert.equal(elements['current-loading'].classList.contains('hidden'),false);
    assert.equal(elements['current-content'].classList.contains('hidden'),true);
    return new Promise(resolve=>{resolveCurrent=resolve;});
  }});
  await new Promise(resolve=>setImmediate(resolve));
  resolveCurrent({data:{success:true,data:[]}});
  const f=await pending;assert.equal(f.elements['current-loading'].classList.contains('hidden'),true);
});
test('redlist delegated status resolves the sorted current item and preserves no-save TODO and notification expiry',async()=>{
  const f=await fixture();const count=f.requests.length;
  const select={dataset:{statusIndex:'0'},value:'resolved',closest(){return this;}};
  await f.elements['current-content'].listeners.change({target:select,currentTarget:f.elements['current-content']});
  assert.equal(f.requests.length,count);assert.match(f.logs.at(-1),/HIGH 2026-10 -> resolved/);
  assert.equal(f.body.children.at(-1).textContent,'対応済みに変更しました');
  assert.equal(f.elements['count-resolved'].textContent,0);
  assert.equal(f.timers.at(-1).delay,3000);f.timers.at(-1).callback();assert.equal(f.body.children.at(-1).removed,true);
  select.value='pending';await f.elements['current-content'].listeners.change({target:select,currentTarget:f.elements['current-content']});assert.equal(f.body.children.at(-1).textContent,'未対応に変更しました');
});
test('redlist delegated status ignores missing, invalid, out-of-range and outside targets',async()=>{
  const f=await fixture(),initial=f.body.children.length,requests=f.requests.length;
  for(const index of ['-1','1.5','no','99']){
    const select={dataset:{statusIndex:index},value:'resolved',closest(){return this;}};
    await f.elements['current-content'].listeners.change({target:select,currentTarget:f.elements['current-content']});
  }
  await f.elements['current-content'].listeners.change({target:{closest:()=>null},currentTarget:f.elements['current-content']});
  const outside={inside:false,dataset:{statusIndex:'0'},closest(){return this;}};await f.elements['current-content'].listeners.change({target:outside,currentTarget:f.elements['current-content']});
  assert.equal(f.body.children.length,initial);assert.equal(f.requests.length,requests);
});
