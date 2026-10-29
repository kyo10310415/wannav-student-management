import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const redListPendingSends ='),source.indexOf('// ═',source.indexOf('const redListPendingSends =')));
function fn(name){let a=source.indexOf(`async function ${name}(`);if(a<0)a=source.indexOf(`function ${name}(`);return source.slice(a,source.indexOf('\n}',a)+2)}
function fixture(testSend=false){
 const requests=[],notices=[],logs=[],renders=[],refreshes=[];
 const node=(id,parent)=>({id,parent,value:'',innerHTML:'Original button',textContent:'',disabled:false,dataset:{},options:[],classList:{hidden:false,contains(){return this.hidden},add(){this.hidden=true},remove(){this.hidden=false}},contains(n){for(;n;n=n.parent)if(n===this)return true;return false},appendChild(n){this.options.push(n)}});
 const elements={content:node('content')};
 for(const suffix of ['discord-modal','test-send-modal'])elements['redlist-'+suffix]=node('redlist-'+suffix,elements.content);
 const normal=elements['redlist-discord-modal'],testing=elements['redlist-test-send-modal'];
 for(const suffix of ['modal-select','sender-select','modal-content','send-btn','modal-img','modal-img-wrap'])elements['redlist-discord-'+suffix]=node('redlist-discord-'+suffix,normal);
 for(const suffix of ['message-id','sender-select','btn','title','booking-url-wrap','booking-url-preview'])elements['redlist-test-send-'+suffix]=node('redlist-test-send-'+suffix,testing);
 elements['redlist-discord-modal-content'].value='Synthetic draft';elements['redlist-test-send-message-id'].value='1';testing.dataset.redListSendGeneration='1';
 const current={student_id:'OWN',year_month:'2026-10',assigned_to:'Current'},history={student_id:'OWN',year_month:'2026-09',assigned_to:'Historical'};
 const c={sessionToken:'synthetic-session',currentUser:{id:7,role:'admin'},currentPage:'red-list',currentRedListTab:testSend?'messages':'current',API_BASE:'',_rlDiscordTarget:{studentId:'OWN',studentName:'<b>Synthetic</b>',yearMonth:'2026-10'},currentRedListData:[current],historyRedListData:[history],redListMessages:[{id:1,title:'Synthetic'}],redListSenders:[{id:7,name:'Synthetic Sender'}],
  document:{getElementById:id=>elements[id],createElement:()=>node('option')},escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),showNotification:(...args)=>notices.push(args),console:{error:(...args)=>logs.push(args)},clearRedListAuthenticatedImage(){},
  renderRedListCurrentList:()=>renders.push('current'),renderRedListHistoryList:()=>renders.push('history'),fetchRedListDiscordLogs:async(...args)=>refreshes.push(args),
  axios:{post:(url,body,options)=>new Promise((resolve,reject)=>requests.push({url,body,options,resolve,reject}))}};
 vm.createContext(c);vm.runInContext(block,c);for(const name of ['executeRedListTestSend','closeRedListDiscordModal','openRedListTestSendModal','closeRedListTestSendModal'])vm.runInContext(fn(name),c);
 const send=()=>testSend?c.executeRedListTestSend():c.sendRedListDiscordMessage();
 const resolve=(i=0,success=true)=>requests[i].resolve({data:{success,assignedTo:'Synthetic Assigned'}});
 return {c,elements,node,current,history,requests,notices,logs,renders,refreshes,send,resolve};
}

test('normal and test sends preserve payloads, captured auth and successful local completion',async()=>{
 const f=fixture();const pending=f.send();assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');
 assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].body)),{studentId:'OWN',yearMonth:'2026-10',studentName:'<b>Synthetic</b>',messageId:null,messageContent:'Synthetic draft',senderId:null});
 f.resolve();await pending;assert.equal(f.current.assigned_to,'Synthetic Assigned');assert.equal(f.refreshes.length,1);assert.deepEqual(f.renders,['current']);assert.ok(f.notices[0][0].includes('&lt;b&gt;'));assert.ok(!f.notices[0][0].includes('<b>'));assert.equal(f.elements['redlist-discord-send-btn'].disabled,false);
 const g=fixture(true);g.elements['redlist-test-send-sender-select'].value='7';const test=g.send();assert.deepEqual(JSON.parse(JSON.stringify(g.requests[0].body)),{messageId:1,senderId:7});g.resolve();await test;assert.equal(g.elements['redlist-test-send-modal'].classList.hidden,true);assert.equal(g.elements['redlist-test-send-btn'].disabled,false);
});

test('template choice keeps content selection and history send never mutates a different current month',async()=>{
 const f=fixture();f.c.currentRedListTab='history';f.c._rlDiscordTarget={studentId:'OWN',studentName:'Synthetic',yearMonth:'2026-09'};f.elements['redlist-discord-modal-select'].value='1';
 const pending=f.send();assert.equal(f.requests[0].body.messageId,1);assert.equal(f.requests[0].body.messageContent,undefined);f.resolve();await pending;
 assert.equal(f.current.assigned_to,'Current');assert.equal(f.history.assigned_to,'Historical');assert.deepEqual(f.renders,['history']);
});

test('non-managers, missing sessions, closed/foreign DOM, invalid cached choices and disabled buttons never send',async()=>{
 for(const testing of [false,true])for(const change of [f=>f.c.currentUser={id:7,role:'crew'},f=>f.c.currentUser=null,f=>f.c.sessionToken='',f=>f.c.currentPage='students',f=>f.elements[testing?'redlist-test-send-modal':'redlist-discord-modal'].classList.hidden=true,f=>f.elements[testing?'redlist-test-send-btn':'redlist-discord-send-btn'].disabled=true,f=>f.elements[testing?'redlist-test-send-modal':'redlist-discord-modal'].parent=null,f=>f.elements[testing?'redlist-test-send-message-id':'redlist-discord-modal-select'].value='1junk',f=>f.elements[testing?'redlist-test-send-sender-select':'redlist-discord-sender-select'].value='8']){
  const f=fixture(testing);change(f);await f.send();assert.equal(f.requests.length,0);
 }
});

test('same-target pending guard prevents duplicate sends even if a fresh button becomes available',async()=>{
 for(const testing of [false,true]){
  const f=fixture(testing);const pending=f.send();await f.send();assert.equal(f.requests.length,1);
  const id=testing?'redlist-test-send-btn':'redlist-discord-send-btn';f.elements[id]=f.node(id,f.elements[testing?'redlist-test-send-modal':'redlist-discord-modal']);await f.send();assert.equal(f.requests.length,1);
  f.resolve();await pending;assert.equal(f.elements[id].disabled,false);assert.equal(f.notices.length,0);
 }
});

test('stale auth, target, draft and DOM responses never close, notify, cache-update or refresh',async()=>{
 for(const testing of [false,true])for(const change of [f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'admin'},f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.currentRedListTab='senders',f=>f.elements.content=f.node('content'),f=>f.elements[testing?'redlist-test-send-sender-select':'redlist-discord-modal-content'].value='Changed']){
  const f=fixture(testing);const pending=f.send();change(f);f.resolve();await pending;assert.equal(f.notices.length,0);assert.equal(f.refreshes.length,0);assert.equal(f.current.assigned_to,'Current');assert.equal(f.renders.length,0);
 }
 const f=fixture();const pending=f.send();f.c._rlDiscordTarget={studentId:'OTHER',studentName:'New',yearMonth:'2026-10'};f.resolve();await pending;assert.equal(f.notices.length,0);assert.equal(f.elements['redlist-discord-modal'].classList.hidden,false);
});

test('same-template test close/reopen has a new generation and old success cannot close it',async()=>{
 const f=fixture(true);const pending=f.send();f.c.closeRedListTestSendModal();f.c.openRedListTestSendModal(1,'New preparation');f.elements['redlist-test-send-message-id'].value='1';f.resolve();await pending;
 assert.equal(f.elements['redlist-test-send-modal'].classList.hidden,false);assert.equal(f.elements['redlist-test-send-title'].textContent,'New preparation');assert.equal(f.notices.length,0);
});

test('new modal during log refresh is not rerendered by the old successful send',async()=>{
 const f=fixture();let finish;f.c.fetchRedListDiscordLogs=(month,parent)=>{f.refreshes.push([month,parent]);return new Promise(resolve=>finish=resolve)};
 const pending=f.send();f.resolve();await new Promise(setImmediate);assert.equal(f.refreshes.length,1);f.c._rlDiscordTarget={studentId:'NEW',yearMonth:'2026-10'};assert.equal(f.refreshes[0][1].current(),false);finish();await pending;assert.equal(f.renders.length,0);
});

test('current failures use fixed private errors and release locks; stale errors stay silent',async()=>{
 for(const testing of [false,true])for(const stale of [false,true]){
  const f=fixture(testing);const pending=f.send();if(stale)f.c.currentPage='students';f.requests[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'<b>PRIVATE_SENTINEL</b>'}}}));await pending;
  assert.equal(f.notices.length,stale?0:1);assert.ok(!JSON.stringify([f.logs,f.notices]).includes('PRIVATE_SENTINEL'));
  assert.equal(f.elements[testing?'redlist-test-send-btn':'redlist-discord-send-btn'].disabled,false);
 }
});
