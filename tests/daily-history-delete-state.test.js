import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fn(name) { let start = source.indexOf(`async function ${name}(`); if (start < 0) start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); }
function fixture(role = 'admin') {
  const requests = [], notices = [], logs = [], renders = [], confirms = [];
  const node = parent => ({parent, innerHTML:'', value:'', disabled:false, removed:false,
    classList:{hidden:false,add(){this.hidden=true},remove(){this.hidden=false},contains(){return this.hidden}},
    contains(other){for(let at=other;at;at=at.parent)if(at===this)return true;return false},
    remove(){this.removed=true;this.parent=null},querySelector(){return this.control},insertAdjacentHTML(_position, html){this.appended=html}});
  const elements = {content:node()};
  elements.dailyReportHistoryModal = node(elements.content);
  for(const id of ['drHistoryTitle','drHistoryBody','drHistoryPager'])elements[id]=node(elements.dailyReportHistoryModal);
  elements['drReport-1']=node(elements.drHistoryBody);elements['drReport-1'].control=node(elements['drReport-1']);
  elements['drComment-2']=node(elements['drReport-1']);elements['drComment-2'].control=node(elements['drComment-2']);
  elements['drCommentInput-1']=node(elements['drReport-1']);elements['drCommentInput-1'].value='Synthetic new';elements['drComments-1']=node(elements['drReport-1']);
  const report={id:1,content:'Synthetic',comments:[{id:2,content:'Synthetic comment'}]};
  const history={tutorId:7,reports:[report],total:2,offset:0};
  const c={currentUser:{id:7,role},sessionToken:'synthetic-session',currentPage:'daily-reports',dailyReportViewTutorId:7,dailyReportHistory:history,
    document:{getElementById:id=>elements[id]?.removed?null:elements[id]??null},
    dailyHistoryTutorAllowed:id=>role!=='crew'||Number(id)===7,
    escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    confirm:message=>{confirms.push(message);return true},showNotification:(...args)=>notices.push(args),console:{error:(...args)=>logs.push(args)},
    _renderDailyReportHistoryBody:()=>renders.push(['body',c.dailyReportHistory?.offset]),_renderDailyReportHistoryPager:()=>renders.push(['pager']),
    axios:{get:(url,options)=>new Promise((resolve,reject)=>requests.push({method:'GET',url,options,resolve,reject})),delete:(url,options)=>new Promise((resolve,reject)=>requests.push({method:'DELETE',url,options,resolve,reject})),post:(url,body,options)=>new Promise((resolve,reject)=>requests.push({method:'POST',url,body,options,resolve,reject}))}};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('let dailyReportModalGeneration ='),source.indexOf('function openDailyReportModal(')),c);
  vm.runInContext(source.slice(source.indexOf('const DR_PAGE_SIZE = 5;'),source.indexOf('function _renderDailyReportHistoryBody()')),c);
  for(const name of ['dailyReportDeleteContext','deleteDailyReport','deleteDailyReportComment','submitDailyReportComment'])vm.runInContext(fn(name),c);
  const resolveRead=(index,offset=0)=>requests[index].resolve({data:{success:true,data:[{id:offset+1}],total:20,offset}});
  const resolveDelete=index=>requests[index].resolve({data:{success:true}});
  return {c,elements,requests,notices,logs,renders,confirms,report,history,node,resolveRead,resolveDelete};
}

test('daily history captures credentials and only newest page can update data or rendering',async()=>{
  const f=fixture();const old=f.c.loadDailyReportHistory(7,0),latest=f.c.loadDailyReportHistory(7,5);
  assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');assert.equal(f.requests[1].options.params.limit,5);
  f.resolveRead(1,5);await latest;f.resolveRead(0,0);await old;
  assert.equal(f.c.dailyReportHistory.offset,5);assert.equal(f.renders.filter(x=>x[0]==='body').length,1);
});

test('daily history old success/failure after close, auth or replaced target never changes cache/DOM/logs',async()=>{
  for(const fail of [false,true])for(const change of [f=>f.c.closeDailyReportHistory(),f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'admin'},f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.elements.content=f.node(),f=>f.elements.drHistoryBody=f.node(f.elements.dailyReportHistoryModal),f=>f.c.dailyReportViewTutorId=8]){
    const f=fixture();const pending=f.c.loadDailyReportHistory(7,0);change(f);const history=f.c.dailyReportHistory;
    if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolveRead(0);
    await pending;assert.equal(f.c.dailyReportHistory,history);assert.equal(f.renders.length,0);assert.equal(f.logs.length,0);assert.equal(f.elements.drHistoryBody.innerHTML,'');
  }
});

test('history close/reopen and different tutor reads invalidate old responses and preserve current title',async()=>{
  const f=fixture();const old=f.c.openDailyReportHistory(7,'Old');f.c.closeDailyReportHistory();const latest=f.c.openDailyReportHistory(8,'New <Tutor>');
  f.resolveRead(1,0);await latest;f.resolveRead(0,5);await old;
  assert.equal(f.c.dailyReportHistory.tutorId,8);assert.ok(f.elements.drHistoryTitle.innerHTML.includes('New &lt;Tutor&gt;'));
  assert.equal(f.c.dailyReportHistory.offset,0);
});

test('history read rejects unauthenticated, unowned, hidden and invalid pages before requests',async()=>{
  for(const change of [f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentPage='students',f=>f.c.dailyHistoryTutorAllowed=()=>false,f=>f.elements.dailyReportHistoryModal.classList.hidden=true]){
    const f=fixture('crew');change(f);await f.c.loadDailyReportHistory(7,0);assert.equal(f.requests.length,0);
  }
  const f=fixture();for(const offset of [-1,1.5,'5',Infinity])await f.c.loadDailyReportHistory(7,offset);for(const id of [0,-1,2147483648])await f.c.openDailyReportHistory(id,'Synthetic');assert.equal(f.requests.length,0);
  const crew=fixture('crew');await crew.c.openDailyReportHistory(8,'Other');assert.equal(crew.requests.length,0);
});

test('current history failure clears stale cache and pager with fixed private diagnostic',async()=>{
  const f=fixture();const pending=f.c.loadDailyReportHistory(7,5);f.requests[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'PRIVATE_SENTINEL'}}}));await pending;
  assert.equal(f.c.dailyReportHistory,null);assert.equal(f.elements.drHistoryPager.innerHTML,'');assert.ok(f.elements.drHistoryBody.innerHTML.includes('読み込みに失敗'));
  assert.deepEqual(f.logs,[['[DailyReports] load history error']]);
});

test('manager report/comment deletion preserves payloads and updates exact displayed cache',async()=>{
  const f=fixture('leader');const pending=f.c.deleteDailyReport(1);assert.equal(f.requests[0].url,'/api/daily-reports/1');assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');f.resolveDelete(0);await pending;
  assert.equal(f.elements['drReport-1'].removed,true);assert.equal(f.history.reports.length,0);assert.equal(f.history.total,1);assert.equal(f.notices.length,1);
  const g=fixture();const comment=g.c.deleteDailyReportComment(2,1);g.resolveDelete(0);await comment;assert.equal(g.elements['drComment-2'].removed,true);assert.equal(g.report.comments.length,0);assert.equal(g.history.total,2);
});

test('deletions deny crew/non-displayed/foreign DOM and recheck state after confirmation',async()=>{
  for(const comment of [false,true])for(const change of [f=>f.c.currentUser.role='crew',f=>f.c.sessionToken='',f=>f.c.currentPage='students',f=>f.c.dailyReportHistory={tutorId:8,reports:[{id:1}]},f=>f.elements['drReport-1'].parent=null,f=>f.elements.dailyReportHistoryModal.classList.hidden=true]){
    const f=fixture();change(f);await (comment?f.c.deleteDailyReportComment(2,1):f.c.deleteDailyReport(1));assert.equal(f.requests.length,0);assert.equal(f.confirms.length,0);
  }
  const f=fixture();f.c.confirm=()=>{f.c.sessionToken='other';return true};await f.c.deleteDailyReport(1);assert.equal(f.requests.length,0);
});

test('report/comment deletion shares per-report lock with comments and does not double-confirm',async()=>{
  const f=fixture();const pending=f.c.deleteDailyReportComment(2,1);await f.c.deleteDailyReport(1);await f.c.deleteDailyReportComment(2,1);assert.equal(f.requests.length,1);assert.equal(f.confirms.length,1);f.resolveDelete(0);await pending;
  const g=fixture();vm.runInContext("dailyReportPendingWrites.add(JSON.stringify(['comment',7,1]));",g.c);await g.c.deleteDailyReport(1);assert.equal(g.requests.length,0);assert.equal(g.confirms.length,0);
});

test('old delete success or failure cannot remove/notify/count a new history',async()=>{
  for(const comment of [false,true])for(const fail of [false,true])for(const change of [f=>f.c.closeDailyReportHistory(),f=>f.c.sessionToken='other',f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.dailyReportHistory={tutorId:7,reports:[{id:1}],total:9},f=>f.elements['drReport-1']=f.node(f.elements.drHistoryBody)]){
    const f=fixture();const pending=comment?f.c.deleteDailyReportComment(2,1):f.c.deleteDailyReport(1);change(f);
    if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolveDelete(0);await pending;
    assert.equal(f.notices.length,0);assert.equal(f.logs.length,0);assert.equal(f.renders.length,0);assert.equal(f.history.total,2);
  }
});

test('current delete failure retains DOM/cache and releases the existing control privately',async()=>{
  for(const comment of [false,true]){
    const f=fixture();const pending=comment?f.c.deleteDailyReportComment(2,1):f.c.deleteDailyReport(1);f.requests[0].reject(Error('PRIVATE_SENTINEL'));await pending;
    const target=f.elements[comment?'drComment-2':'drReport-1'];assert.equal(target.removed,false);assert.equal(target.control.disabled,false);assert.equal(f.history.total,2);assert.equal(f.notices.length,1);assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_SENTINEL'));
  }
});

test('newly appended comment without a cache entry can still be deleted from its exact visible report',async()=>{
  const f=fixture();f.report.comments=[];const pending=f.c.deleteDailyReportComment(2,1);assert.equal(f.requests.length,1);f.resolveDelete(0);await pending;assert.equal(f.elements['drComment-2'].removed,true);
});

test('completed comment writes and deletions invalidate earlier pending history responses',async()=>{
  for(const operation of ['report-delete','comment-delete','comment-post']){
    const f=fixture();const oldRead=f.c.loadDailyReportHistory(7,0);
    const write=operation==='report-delete'?f.c.deleteDailyReport(1):operation==='comment-delete'?f.c.deleteDailyReportComment(2,1):f.c.submitDailyReportComment(1);
    f.requests[1].resolve({data:{success:true,data:{id:3,content:'Synthetic new',commenter_name:'Synthetic author',created_at:'2026-10-29'}}});await write;
    const history=f.c.dailyReportHistory;const renders=f.renders.length;f.resolveRead(0,0);await oldRead;
    assert.equal(f.c.dailyReportHistory,history);assert.equal(f.renders.length,renders);assert.equal(f.notices.length,1);
  }
});
