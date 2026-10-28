import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const eventSource=await readFile(new URL('../public/lesson-report-events.js',import.meta.url),'utf8');
const reportSource=appSource.slice(appSource.indexOf('let reportFilters ='),appSource.indexOf('// ===== Roulette Winners Page ====='));
function fixture(date='2026-10-28T12:00:00') {
  const calls=[],requests=[],listeners=[];
  const element=()=>({innerHTML:'',value:'',contains(node){return node.root===this},addEventListener(){},classList:{add(){},remove(){}}});
  const elements=Object.fromEntries(['content','loading','lesson-reports-results','filter-start-date','filter-end-date','filter-student-id','filter-tutor-name','filter-lesson-result'].map(id=>[id,element()]));
  const FixedDate=class extends Date {constructor(...args){super(...(args.length?args:[date]));}};
  const context={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'lesson-reports',API_BASE:'',Date:FixedDate,URLSearchParams,
    console:{error(){}},document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},
    axios:{get:async url=>{requests.push(url);return {data:{success:true,data:[],count:0,total:0,limit:50,offset:0}}}}};
  vm.createContext(context);vm.runInContext(reportSource,context);vm.runInContext(eventSource,context);
  const node=(action,data={},root=elements.content)=>{const n={dataset:{reportReadAction:action,...data},root,disabled:false};n.closest=selector=>selector==='button[data-report-read-action]'?n:null;return n};
  const click=(button,nested=false)=>listeners[0].callback({target:nested?{closest:()=>button}:button});
  const stub=()=>{context.searchLessonReports=(...args)=>calls.push(['search',...args]);context.setQuickFilter=period=>calls.push(['quick',period]);context.clearReportFilters=()=>calls.push(['clear'])};
  return {context,elements,calls,requests,listeners,element,node,click,stub,run:code=>vm.runInContext(code,context)};
}
test('report read markup migrates exactly seven controls and preserves existing input listeners',()=>{
  assert.equal((reportSource.match(/data-report-read-action=/g)||[]).length,7);
  assert.equal(/onclick="(?:searchLessonReports|setQuickFilter|clearReportFilters)/.test(reportSource),false);
  assert.equal((reportSource.match(/\.addEventListener\('(change|input)'/g)||[]).length,5);
  assert.ok(appSource.includes('data-report-prepare-action="open"'));
});
test('report read dispatcher allows only fixed search/filter/page actions and exact period values',async()=>{
  const f=fixture();f.stub();assert.equal(f.listeners.length,1);
  await f.click(f.node('search'),true);
  for(const reportPeriod of ['today','week','month'])await f.click(f.node('quick-filter',{reportPeriod}));
  await f.click(f.node('clear-filters'));
  for(const reportPage of ['0','1','3'])await f.click(f.node('page',{reportPage}));
  const expected=[['search'],['quick','today'],['quick','week'],['quick','month'],['clear'],['search',0],['search',1],['search',3]];
  assert.deepEqual(f.calls,expected);
  for(const action of ['__proto__','constructor','submit','delete','searchLessonReports'])await f.click(f.node(action));
  for(const reportPeriod of ['', 'year', '__proto__'])await f.click(f.node('quick-filter',{reportPeriod}));
  for(const reportPage of ['', '-1','1.5','2e2','Infinity','9007199254740992',' 1','1 '])await f.click(f.node('page',{reportPage}));
  assert.deepEqual(f.calls,expected);assert.equal(f.requests.length,0);
});
test('report read events reject stale roots, disabled, wrong page, missing session and non-managers',async()=>{
  const f=fixture();f.stub();
  for(const action of ['search','quick-filter','clear-filters','page']) {
    const data={reportPeriod:'today',reportPage:'1'};
    const old=f.node(action,data);f.elements.content=f.element();await f.click(old);
    const disabled=f.node(action,data);disabled.disabled=true;await f.click(disabled);
    await f.click(f.node(action,data,f.element()));
    for(const user of [null,{role:'crew'},{role:'unknown'}]){f.context.currentUser=user;await f.click(f.node(action,data));}
    f.context.currentUser={role:'admin'};f.context.sessionToken='';await f.click(f.node(action,data));
    f.context.sessionToken='synthetic-session';f.context.currentPage='today';await f.click(f.node(action,data));f.context.currentPage='lesson-reports';
  }
  await f.listeners[0].callback({target:{}});assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
  f.context.currentUser={role:'leader'};await f.click(f.node('search'));assert.deepEqual(f.calls,[['search']]);
});
test('real report search keeps filters, zero-based page size and read-only URL encoding',async()=>{
  const f=fixture();f.run("reportFilters={start_date:'2026-10-01',end_date:'2026-10-28',student_id:'S & synthetic',tutor_name:'Synthetic Tutor',lesson_result:'synthetic result'}");
  await f.click(f.node('page',{reportPage:'2'}));
  const params=new URL(f.requests[0],'https://fixture.invalid').searchParams;
  assert.equal(params.get('limit'),'50');assert.equal(params.get('offset'),'100');
  assert.equal(params.get('student_id'),'S & synthetic');assert.equal(params.get('tutor_name'),'Synthetic Tutor');assert.equal(params.get('start_date'),'2026-10-01');assert.equal(params.get('end_date'),'2026-10-28');assert.equal(params.get('lesson_result'),'synthetic result');assert.equal(f.run('reportCurrentPage'),2);
  assert.ok(f.elements['lesson-reports-results'].innerHTML.includes('該当するレッスン報告がありません'));
});
test('quick filters preserve local date boundaries including a Sunday week and reset page',()=>{
  for(const [date,period,start,end] of [['2026-10-28T12:00:00','today','2026-10-28','2026-10-28'],['2026-11-01T12:00:00','week','2026-10-26','2026-11-01'],['2026-11-01T12:00:00','month','2026-11-01','2026-11-01']]) {
    const f=fixture(date);let searches=0;f.context.searchLessonReports=()=>searches++;
    f.click(f.node('quick-filter',{reportPeriod:period}));
    assert.equal(f.run('reportFilters.start_date'),start);assert.equal(f.run('reportFilters.end_date'),end);assert.equal(f.elements['filter-start-date'].value,start);assert.equal(f.elements['filter-end-date'].value,end);assert.equal(searches,1);
  }
});
test('clearing report filters resets all five inputs and invokes one fresh search',()=>{
  const f=fixture();f.run("reportFilters={start_date:'synthetic',end_date:'synthetic',student_id:'synthetic',tutor_name:'synthetic',lesson_result:'synthetic'}");
  for(const element of Object.values(f.elements))element.value='synthetic';let searches=0;f.context.searchLessonReports=()=>searches++;
  f.click(f.node('clear-filters'));assert.equal(searches,1);
  assert.ok(Object.values(f.run('reportFilters')).every(value=>value===''));
  for(const id of ['filter-start-date','filter-end-date','filter-student-id','filter-tutor-name','filter-lesson-result'])assert.equal(f.elements[id].value,'');
});
test('pagination retains first/last disabled controls and next page index without write actions',()=>{
  const f=fixture();const report={student_id:'SYNTHETIC',lesson_result:'実施済み',lesson_date:'2026-10-28',reported_at:'2026-10-28T00:00:00Z'};
  f.context.renderLessonReportsTable({data:[report],count:1,total:101,limit:50,offset:0});
  assert.match(f.elements['lesson-reports-results'].innerHTML,/data-report-page="-1"\s+disabled/);assert.match(f.elements['lesson-reports-results'].innerHTML,/data-report-page="1"\s+class/);
  f.context.renderLessonReportsTable({data:[report],count:1,total:101,limit:50,offset:100});
  assert.match(f.elements['lesson-reports-results'].innerHTML,/data-report-page="1"\s+class/);assert.match(f.elements['lesson-reports-results'].innerHTML,/data-report-page="3"\s+disabled/);assert.equal(f.requests.length,0);
});
