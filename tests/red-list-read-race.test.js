import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fn(name) {
  const start=app.indexOf(`async function ${name}(`);
  assert.ok(start>=0);
  return app.slice(start,app.indexOf('\n}',start)+2);
}
function fixture() {
  const requests=[],calls=[],logs=[];
  const node=root=>({root,innerHTML:'',value:'',dataset:{},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}},contains(other){for(let at=other;at;at=at.root)if(at===this)return true;return false}});
  const elements={content:node()};
  for(const id of ['redlist-current-content','redlist-current-loading','redlist-history-month','redlist-history-content','redlist-history-loading'])elements[id]=node(elements.content);
  elements['redlist-history-month'].value='2026-09';
  const cells=[Object.assign(node(elements.content),{dataset:{studentId:'SYNTHETIC'}})];
  elements.content.querySelectorAll=()=>cells;
  const selected=[{student_id:'SYNTHETIC'}];
  const c={getFilteredStudents:()=>selected,sessionToken:'synthetic-session',currentUser:{id:7,role:'crew'},currentPage:'red-list',API_BASE:'',
    currentRedListData:[],historyRedListData:[],redListDiscordLogs:{},
    document:{getElementById:id=>elements[id]??null,querySelectorAll:()=>cells},
    console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},
    getCurrentYearMonthStr:()=> '2026-10',
    renderRedListCurrentList:()=>calls.push('current-render'),renderRedListHistoryList:()=>calls.push('history-render'),updateRedListStats:()=>calls.push('stats'),updateRedListDisplay:(...args)=>calls.push(['cell',...args]),
    axios:{get:(url,options)=>new Promise((resolve,reject)=>requests.push({method:'GET',url,options,resolve,reject})),post:(url,body,options)=>new Promise((resolve,reject)=>requests.push({method:'POST',url,body,options,resolve,reject}))}};
  vm.createContext(c);vm.runInContext(app.slice(app.indexOf('const redListReadStates ='),app.indexOf('// Red List Page')),c);
  for(const name of ['loadRedListData','loadRedListCurrentData','loadRedListHistoryData','fetchRedListDiscordLogs'])vm.runInContext(fn(name),c);
  const resolve=(index,data)=>requests[index].resolve({data:{success:true,data}});
  return {c,elements,cells,requests,calls,logs,node,resolve};
}
const row=(id,month)=>({student_id:id,year_month:month,rank:'high',final_rank:'high'});
const log=(id,month)=>({student_id:id,year_month:month,sent_by:'synthetic@example.invalid'});

test('history month races discard old rows and logs without touching the newer loading state',async()=>{
  const f=fixture();const old=f.c.loadRedListHistoryData();
  f.elements['redlist-history-month'].value='2026-08';const latest=f.c.loadRedListHistoryData();
  f.resolve(2,[row('NEW','2026-08')]);f.resolve(3,[log('NEW','2026-08')]);await latest;
  f.elements['redlist-history-loading'].classList.hidden=false;
  f.resolve(0,[row('OLD','2026-09')]);f.resolve(1,[log('OLD','2026-09')]);await old;
  assert.deepEqual(Object.keys(f.c.redListDiscordLogs),['NEW_2026-08']);
  assert.equal(f.c.historyRedListData[0].student_id,'NEW');
  assert.equal(f.elements['redlist-history-loading'].classList.hidden,false);
  assert.deepEqual(f.calls,['history-render','stats']);
});

test('empty month invalidates pending history and clears the old cached export rows',async()=>{
  const f=fixture();f.c.historyRedListData=[row('OLD','2026-09')];const old=f.c.loadRedListHistoryData();
  f.elements['redlist-history-month'].value='';await f.c.loadRedListHistoryData();
  f.resolve(0,[row('STALE','2026-09')]);f.resolve(1,[log('STALE','2026-09')]);await old;
  assert.equal(f.c.historyRedListData.length,0);assert.equal(f.elements['redlist-history-content'].innerHTML,'');assert.equal(f.calls.length,0);
});

test('read completion after session, user, role, page or target replacement has no cache, DOM or log effects',async()=>{
  const changes=[f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'crew'},f=>f.c.currentUser=null,f=>f.c.currentUser.role='unknown',f=>f.c.currentPage='students',f=>f.elements.content=f.node(),f=>f.elements['redlist-current-content']=f.node(f.elements.content)];
  for(const change of changes){const f=fixture();const pending=f.c.loadRedListCurrentData();change(f);f.resolve(0,[row('STALE','2026-10')]);f.resolve(1,[log('STALE','2026-10')]);await pending;assert.equal(f.c.currentRedListData.length,0);assert.equal(Object.keys(f.c.redListDiscordLogs).length,0);assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);}
});

test('current panel newest response wins and late failure cannot replace it',async()=>{
  for(const fail of [false,true]){
    const f=fixture();const old=f.c.loadRedListCurrentData();const latest=f.c.loadRedListCurrentData();
    f.resolve(2,[row('NEW','2026-10')]);f.resolve(3,[log('NEW','2026-10')]);await latest;
    if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve(0,[row('OLD','2026-10')]);
    f.resolve(1,[log('OLD','2026-10')]);await old;
    assert.equal(f.c.currentRedListData[0].student_id,'NEW');assert.deepEqual(Object.keys(f.c.redListDiscordLogs),['NEW_2026-10']);assert.equal(f.logs.length,0);
  }
});

test('current and history logs can complete in either order and replace only their own month',async()=>{
  for(const order of [[0,1],[1,0]]){
    const f=fixture();f.c.redListDiscordLogs={'OLD_2026-10':[log('OLD','2026-10')],'KEEP_2026-07':[log('KEEP','2026-07')]};
    const pending=[f.c.fetchRedListDiscordLogs('2026-10'),f.c.fetchRedListDiscordLogs('2026-09')];
    for(const i of order){f.resolve(i,[log(i===0?'CURRENT':'HISTORY',i===0?'2026-10':'2026-09')]);await pending[i];}
    assert.deepEqual(Object.keys(f.c.redListDiscordLogs).sort(),['CURRENT_2026-10','HISTORY_2026-09','KEEP_2026-07']);
    for(const request of f.requests)assert.equal(request.options.headers.Authorization,'Bearer synthetic-session');
    const refresh=f.c.fetchRedListDiscordLogs('2026-10');f.resolve(2,[]);await refresh;
    assert.deepEqual(Object.keys(f.c.redListDiscordLogs).sort(),['HISTORY_2026-09','KEEP_2026-07']);
  }
});

test('invalid month and unauthenticated reads do not start requests or automatic writes',async()=>{
  const f=fixture();for(const value of ['2026-13','2026-1','not-month']){f.elements['redlist-history-month'].value=value;await f.c.loadRedListHistoryData();await f.c.fetchRedListDiscordLogs(value);}
  f.c.sessionToken='';await f.c.loadRedListCurrentData();await f.c.loadRedListData();assert.equal(f.requests.length,0);
});

test('student table crew shared reads and manager automatic calculation retain their existing roles',async()=>{
  const crew=fixture();crew.c.currentPage='students';const read=crew.c.loadRedListData();crew.resolve(0,[]);await read;assert.equal(crew.requests.length,1);assert.ok(crew.cells[0].innerHTML.includes('>-</span>'));
  for(const role of ['admin','leader']){
    const f=fixture();f.c.currentUser.role=role;f.c.currentPage='students';const pending=f.c.loadRedListData();f.resolve(0,[]);await new Promise(setImmediate);
    assert.equal(f.requests[1].method,'POST');f.resolve(1,{});await new Promise(setImmediate);f.resolve(2,[row('SYNTHETIC','2026-10')]);await pending;
    assert.equal(f.calls[0][0],'cell');assert.equal(f.requests[2].options.headers.Authorization,'Bearer synthetic-session');
  }
});

test('table rerender and logout stop old cells, error logs, retry GET and automatic POST',async()=>{
  const f=fixture();f.c.currentUser.role='admin';f.c.currentPage='students';const pending=f.c.loadRedListData();f.cells[0].root=null;f.resolve(0,[]);await pending;assert.equal(f.requests.length,1);assert.equal(f.calls.length,0);
  const g=fixture();g.c.currentUser.role='admin';g.c.currentPage='students';const refresh=g.c.loadRedListData();g.resolve(0,[]);await new Promise(setImmediate);g.c.sessionToken='';g.resolve(1,{});await refresh;assert.equal(g.requests.length,2);assert.equal(g.calls.length,0);
  const h=fixture();h.c.currentPage='students';const failed=h.c.loadRedListData();h.c.currentUser=null;h.requests[0].reject(Error('PRIVATE_SENTINEL'));await failed;assert.equal(h.logs.length,0);assert.equal(h.cells[0].innerHTML,'');
});
