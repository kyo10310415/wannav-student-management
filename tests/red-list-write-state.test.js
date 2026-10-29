import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const writes=source.slice(source.indexOf('const redListPendingWrites ='),source.indexOf('function populateRedListHistoryMonths()'));
function fixture(tab='current') {
  const requests=[],notices=[],logs=[],calls=[],timers=[];
  const node=parent=>({parent,value:'',disabled:false,dataset:{},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}},focus(){calls.push('focus')},contains(other){for(let at=other;at;at=at.parent)if(at===this)return true;return false},querySelectorAll(){return controls.filter(control=>this.contains(control))}});
  const elements={content:node()};
  for(const id of ['redlist-current-content','redlist-history-content','redlist-history-month','ex-reason-modal','ex-reason-student-id','ex-reason-year-month','ex-reason-input'])elements[id]=node(elements.content);
  elements['redlist-history-month'].value='2026-09';
  const current={student_id:`S/'"`,year_month:'2026-10',correspondence_status:'未対応',assigned_to:'Original',ex_rank:false};
  const history={student_id:current.student_id,year_month:'2026-09',correspondence_status:'対応中',assigned_to:'History',final_ex_rank:false};
  const controls=[];
  for(const [name,row] of [['current',current],['history',history]])for(const action of ['status','assigned','ex'])controls.push(Object.assign(node(elements['redlist-'+name+'-content']),{dataset:{redListCardAction:action,redListStudentId:row.student_id,redListYearMonth:row.year_month},value:action==='status'?row.correspondence_status:row.assigned_to}));
  const c={API_BASE:'',currentPage:'red-list',currentRedListTab:tab,sessionToken:'synthetic-session',currentUser:{id:7,role:'admin'},currentRedListData:[current],historyRedListData:[history],document:{getElementById:id=>elements[id]},console:{error:(...args)=>logs.push(args)},showNotification:(...args)=>notices.push(args),updateRedListStats:()=>calls.push('stats'),renderRedListCurrentList:()=>calls.push('render'),setTimeout:fn=>timers.push(fn),axios:{patch:(url,body,options)=>new Promise((resolve,reject)=>requests.push({url,body,options,resolve,reject}))}};
  vm.createContext(c);vm.runInContext(writes,c);
  const control=(action,where=tab)=>controls.find(n=>n.dataset.redListCardAction===action&&n.parent===elements['redlist-'+where+'-content']);
  const resolve=(i,success=true)=>requests[i].resolve({data:{success,error:'PRIVATE_SENTINEL'}});
  return {c,elements,controls,current,history,requests,notices,logs,calls,timers,node,control,resolve};
}

test('history status and assignment update the exact month, encode IDs and capture trusted session',async()=>{
  const f=fixture('history');const id=f.current.student_id;
  const status=f.c.updateRedListStatus(id,'2026-09','対応済み');f.resolve(0);await status;
  const assigned=f.c.updateRedListAssigned(id,'2026-09','Synthetic <Tutor>');f.resolve(1);await assigned;
  assert.equal(f.current.correspondence_status,'未対応');assert.equal(f.current.assigned_to,'Original');
  assert.equal(f.history.correspondence_status,'対応済み');assert.equal(f.history.assigned_to,'Synthetic <Tutor>');
  assert.equal(f.requests[0].url,'/api/red-list/'+encodeURIComponent(id)+'/status');assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');
});

test('writes reject missing auth, non-manager, stale DOM, incorrect target and invalid values before requests',async()=>{
  for(const change of [f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.currentRedListData=[],f=>f.control('status').disabled=true,f=>f.control('status').parent=null]) {
    const f=fixture();change(f);await f.c.updateRedListStatus(f.current.student_id,'2026-10','対応中');assert.equal(f.requests.length,0);
  }
  const f=fixture();await f.c.updateRedListStatus(f.current.student_id,'2026-10','invalid');await f.c.updateRedListStatus(f.current.student_id,'2026-09','対応中');await f.c.updateRedListAssigned(f.current.student_id,'2026-10',{});await f.c.confirmClearExRank('unknown','2026-10');assert.equal(f.requests.length,0);
});

test('same-field duplicate requests are blocked and current failures restore values without raw errors',async()=>{
  const f=fixture();f.control('status').value='対応済み';
  const pending=f.c.updateRedListStatus(f.current.student_id,'2026-10','対応済み');
  assert.equal(f.control('status').disabled,true);
  await f.c.updateRedListStatus(f.current.student_id,'2026-10','対応中');assert.equal(f.requests.length,1);
  const assigned=f.c.updateRedListAssigned(f.current.student_id,'2026-10','New');assert.equal(f.requests.length,2);
  f.resolve(0,false);f.requests[1].reject(Error('PRIVATE_SENTINEL'));await pending;await assigned;
  assert.equal(f.control('status').value,'未対応');assert.equal(f.control('assigned').value,'Original');assert.equal(f.control('status').disabled,false);assert.equal(f.control('assigned').disabled,false);
  assert.ok(!JSON.stringify([f.notices,f.logs]).includes('PRIVATE_SENTINEL'));
  const retry=f.c.updateRedListStatus(f.current.student_id,'2026-10','対応中');f.resolve(2);await retry;assert.equal(f.current.correspondence_status,'対応中');
});

test('late success and failure after auth, tab, root, card or cache change cannot update new UI or cache',async()=>{
  const changes=[f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'admin'},f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.currentRedListTab='history',f=>f.elements.content=f.node(),f=>f.control('status').parent=null,f=>f.c.currentRedListData=[{...f.current}]];
  for(const change of changes)for(const fail of [false,true]) {
    const f=fixture();const pending=f.c.updateRedListStatus(f.current.student_id,'2026-10','対応済み');change(f);
    if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve(0);await pending;
    assert.equal(f.current.correspondence_status,'未対応');assert.equal(f.notices.length,0);assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);
  }
  const f=fixture('history');const pending=f.c.updateRedListAssigned(f.history.student_id,'2026-09','New');f.elements['redlist-history-month'].value='2026-08';f.resolve(0);await pending;assert.equal(f.history.assigned_to,'History');assert.equal(f.notices.length,0);
});

test('EX modal binds cached identity and refuses tampered or stale confirmations and delayed focus',async()=>{
  const f=fixture();f.c.openExReasonModal(f.current.student_id,'2026-10');
  f.elements['ex-reason-student-id'].value='OTHER';await f.c.confirmExRank();assert.equal(f.requests.length,0);
  f.c.closeExReasonModal();f.timers[0]();assert.equal(f.calls.length,0);
  f.c.openExReasonModal(f.current.student_id,'2026-10');f.c.currentUser.role='crew';await f.c.confirmExRank();assert.equal(f.requests.length,0);
  const g=fixture();g.c.openExReasonModal(g.current.student_id,'2026-10');g.elements['ex-reason-input'].value=' Synthetic reason ';
  const pending=g.c.confirmExRank();await g.c.confirmExRank();assert.equal(g.requests.length,1);assert.equal(g.requests[0].body.ex_reason,'Synthetic reason');
  g.resolve(0);await pending;assert.equal(g.current.ex_rank,true);assert.equal(g.current.ex_reason,'Synthetic reason');assert.ok(g.calls.includes('render'));
});

test('EX clear locks pending writes, discards stale completion and never edits a different current month',async()=>{
  const f=fixture();f.current.ex_rank=true;const pending=f.c.confirmClearExRank(f.current.student_id,'2026-10');await f.c.confirmClearExRank(f.current.student_id,'2026-10');assert.equal(f.requests.length,1);
  f.resolve(0);await pending;assert.equal(f.current.ex_rank,false);assert.equal(f.current.ex_reason,null);
  const stale=fixture();const old=stale.c.confirmClearExRank(stale.current.student_id,'2026-10');stale.c.currentUser=null;stale.resolve(0);await old;assert.equal(stale.notices.length,0);assert.equal(stale.calls.length,0);
  const history=fixture('history');history.current.ex_rank=true;history.history.final_ex_rank=true;
  const past=history.c.confirmClearExRank(history.history.student_id,'2026-09');history.resolve(0);await past;
  assert.equal(history.current.ex_rank,true);assert.equal(history.history.final_ex_rank,true);assert.ok(!history.calls.includes('render'));
});

test('an older EX response cannot redraw or notify over a newly opened target modal',async()=>{
  for(const fail of [false,true]) {
    const f=fixture();f.current.ex_rank=true;
    const other={student_id:'OTHER',year_month:'2026-10',ex_rank:false};f.c.currentRedListData.push(other);
    f.controls.push(Object.assign(f.node(f.elements['redlist-current-content']),{dataset:{redListCardAction:'ex',redListStudentId:'OTHER',redListYearMonth:'2026-10'}}));
    const old=f.c.confirmClearExRank(f.current.student_id,'2026-10');
    f.c.openExReasonModal('OTHER','2026-10');
    if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve(0);await old;
    assert.equal(f.current.ex_rank,true);assert.equal(f.notices.length,0);assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);
    assert.equal(f.elements['ex-reason-student-id'].value,'OTHER');assert.equal(f.elements['ex-reason-modal'].classList.hidden,false);
  }
});
