import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fn(name){const a=source.indexOf(`async function ${name}(`)>=0?source.indexOf(`async function ${name}(`):source.indexOf(`function ${name}(`);assert.ok(a>=0);return source.slice(a,source.indexOf('\n}',a)+2)}
function fixture(){
 const requests=[],calls=[],logs=[];
 const node=parent=>({parent,value:'',innerHTML:'',textContent:'',dataset:{},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}},contains(n){for(;n;n=n.parent)if(n===this)return true;return false}});
 const elements={content:node()};
 for(const id of ['redlist-messages-loading','redlist-messages-content','redlist-senders-loading','redlist-senders-content','redlist-discord-modal','redlist-discord-modal-img','redlist-discord-modal-img-wrap','redlist-discord-modal-student','redlist-discord-modal-content','redlist-discord-sender-select','redlist-discord-booking-url-wrap'])elements[id]=node(elements.content);
 const c={sessionToken:'synthetic-session',currentUser:{id:7,role:'admin'},currentPage:'red-list',currentRedListTab:'current',API_BASE:'',redListMessages:[],redListSenders:[],
 document:{getElementById:id=>elements[id]},console:{error:(...args)=>logs.push(args)},
 clearRedListAuthenticatedImage:()=>calls.push('clear-image'),populateRedListDiscordSelect:()=>calls.push('message-select'),populateRedListSenderSelect:()=>calls.push('sender-select'),renderRedListMessages:()=>calls.push('messages-render'),renderRedListSenders:()=>calls.push('senders-render'),
 axios:{get:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const redListReadStates ='),source.indexOf('// Red List Page')),c);vm.runInContext('let _rlDiscordTarget={studentId:null,studentName:null,yearMonth:null};',c);
 for(const name of ['loadRedListMessages','loadRedListSenders','openRedListDiscordModal','closeRedListDiscordModal'])vm.runInContext(fn(name),c);
 const resolve=(i,data)=>requests[i].resolve({data:{success:true,data}});
 return {c,elements,requests,calls,logs,node,resolve};
}
const tick=()=>new Promise(setImmediate);

test('message and sender readers capture credentials and newest response wins, including late errors',async()=>{
 for(const kind of ['Messages','Senders'])for(const fail of [false,true]){
  const f=fixture(),method='loadRedList'+kind;const old=f.c[method]();const latest=f.c[method]();
  f.resolve(1,[{id:2,name:'LATEST',title:'LATEST'}]);assert.equal(await latest,true);
  if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve(0,[{id:1,name:'OLD',title:'OLD'}]);
  assert.equal(await old,false);assert.equal(f.c['redList'+kind][0].id,2);assert.equal(f.calls.length,1);assert.equal(f.logs.length,0);
  for(const request of f.requests)assert.equal(request.options.headers.Authorization,'Bearer synthetic-session');
 }
});

test('session, role, page and target replacement discard stale cache, rendering and loading changes',async()=>{
 const changes=[f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'admin'},f=>f.c.currentUser=null,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.elements.content=f.node(),f=>f.elements['redlist-messages-content']=f.node(f.elements.content)];
 for(const change of changes){const f=fixture();const pending=f.c.loadRedListMessages();change(f);f.resolve(0,[{id:1}]);assert.equal(await pending,false);assert.equal(f.c.redListMessages.length,0);assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);assert.equal(f.elements['redlist-messages-loading'].classList.hidden,false);}
});

test('current failures show fixed diagnostic without private values; silent refresh finishes active panel',async()=>{
 const f=fixture();const pending=f.c.loadRedListMessages();f.requests[0].reject(Error('PRIVATE_SENTINEL'));assert.equal(await pending,false);assert.deepEqual(f.logs,[['Red list messages load failed']]);assert.ok(f.elements['redlist-messages-content'].innerHTML.includes('読み込みに失敗'));
 const g=fixture();g.c.currentRedListTab='messages';const old=g.c.loadRedListMessages();const silent=g.c.loadRedListMessages(true);g.resolve(1,[{id:2}]);await silent;g.resolve(0,[{id:1}]);await old;
 assert.deepEqual(g.calls,['messages-render']);assert.equal(g.elements['redlist-messages-loading'].classList.hidden,true);
});

test('close while modal preparation waits never reopens or resets fields',async()=>{
 const f=fixture();const pending=f.c.openRedListDiscordModal('A','Synthetic A','2026-10');f.c.closeRedListDiscordModal();f.elements['redlist-discord-modal-content'].value='KEEP';f.resolve(0,[{id:1}]);await pending;
 assert.equal(f.requests.length,1);assert.equal(f.elements['redlist-discord-modal'].classList.hidden,true);assert.equal(f.elements['redlist-discord-modal-content'].value,'KEEP');assert.ok(!f.calls.includes('message-select'));
});

test('latest student preparation wins across two awaits and old opener cannot reset it',async()=>{
 const f=fixture();f.elements['redlist-discord-modal'].classList.hidden=false;
 const old=f.c.openRedListDiscordModal('A','Synthetic A','2026-09');assert.equal(f.elements['redlist-discord-modal'].classList.hidden,true);
 const latest=f.c.openRedListDiscordModal('B','Synthetic B','2026-10');f.resolve(1,[{id:2}]);await tick();assert.equal(f.requests.length,3);f.resolve(2,[{id:3}]);await latest;
 f.elements['redlist-discord-modal-content'].value='KEEP LATEST';f.resolve(0,[{id:1}]);await old;
 assert.equal(f.elements['redlist-discord-modal'].classList.hidden,false);assert.equal(f.elements['redlist-discord-modal-student'].textContent,'B Synthetic B');assert.equal(f.elements['redlist-discord-modal-content'].value,'KEEP LATEST');
 assert.deepEqual(f.calls.filter(x=>x.endsWith('select')),['message-select','sender-select']);
});

test('modal preparation after logout, page or modal replacement has no visibility or field effects',async()=>{
 for(const change of [f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentPage='students',f=>f.elements['redlist-discord-modal']=f.node(f.elements.content)]){
  const f=fixture();f.c.redListMessages=[{id:1}];const pending=f.c.openRedListDiscordModal('A','Synthetic','2026-10');change(f);f.elements['redlist-discord-modal-content'].value='KEEP';f.resolve(0,[{id:3}]);await pending;
  assert.equal(f.elements['redlist-discord-modal'].classList.hidden,true);assert.equal(f.elements['redlist-discord-modal-content'].value,'KEEP');assert.ok(!f.calls.includes('sender-select'));
 }
});

test('shared crew reads remain available but modal preparation requires manager and no request without session',async()=>{
 const f=fixture();f.c.currentUser.role='crew';const read=f.c.loadRedListSenders();f.resolve(0,[{id:1}]);assert.equal(await read,true);
 await f.c.openRedListDiscordModal('A','Synthetic','2026-10');assert.equal(f.requests.length,1);
 f.c.sessionToken='';assert.equal(await f.c.loadRedListMessages(),false);assert.equal(f.requests.length,1);
});

test('message and sender creator display treats stored values as text',()=>{
 for(const kind of ['Messages','Senders']){
  const f=fixture();const marker='<b data-synthetic="creator">creator</b>';f.c['redList'+kind]=[{id:1,title:'Synthetic',name:'Synthetic',booking_url:'https://example.invalid/',content:'Synthetic',created_by:marker,created_at:'2026-10-29',updated_at:'2026-10-29'}];f.c.Date=Date;f.c.redListSafeBookingUrl=()=>true;f.c.escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');vm.runInContext(fn('renderRedList'+kind),f.c);f.c['renderRedList'+kind]();const html=f.elements['redlist-'+kind.toLowerCase()+'-content'].innerHTML;assert.ok(html.includes('&lt;b data-synthetic='));assert.ok(!html.includes(marker));
 }
});
