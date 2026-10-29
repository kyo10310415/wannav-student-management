import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile}from'node:fs/promises';
const source=await readFile(new URL('../public/schedule-read-events.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];const root=()=>({innerHTML:'',contains(node){return node.root===this}});const elements={content:root()};
 const c={sessionToken:'synthetic',currentUser:{role:'admin'},currentPage:'schedules',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})}};
 for(const name of ['changeScheduleMonth','handleScheduleTabChange','toggleScheduleViewMode','renderSchedulesPage','clearScheduleFilters','handleKeywordFilterChange','handleDateRangeFilterChange','handleLeaderFilterChange','handleAttendeeFilterChange'])c[name]=(...args)=>calls.push([name,...args]);
 vm.createContext(c);vm.runInContext(source,c);
 const node=(selector,dataset={},at=elements.content)=>{const n={dataset,root:at,disabled:false,value:'all'};n.closest=s=>selector===s?n:null;return n};
 const button=(action,extra={},at=elements.content)=>node('button[data-schedule-read-action]',{scheduleReadAction:action,...extra},at);
 const select=(filter,value='all',at=elements.content)=>{const n=node('select[data-schedule-read-filter]',{scheduleReadFilter:filter},at);n.value=value;return n};
 return{c,calls,listeners,elements,root,node,button,select};
}
function real(f){
 Object.assign(f.c,{selectedScheduleYear:2026,selectedScheduleMonth:1,scheduleTab:'confirmed',selectedKeyword:'synthetic',selectedDateRange:'synthetic',selectedLeader:'synthetic',selectedAttendee:'synthetic',API_BASE:'',console:{error(){}}});
 f.c.renderSchedulesContent=()=>f.calls.push(['render-content']);f.c.axios={get:async url=>{f.calls.push(['get',url]);return{data:{success:true,data:{pendingRequests:[{id:'synthetic-request'}]}}}}};
 const start=appSource.indexOf('async function changeScheduleMonth(offset)'),end=appSource.indexOf('function renderLeaderFilterOptions()',start);vm.runInContext(appSource.slice(start,end),f.c);
}
test('twelve schedule controls migrate to fixed namespaces while mutation handlers remain',()=>{
 for(const name of ['changeScheduleMonth','handleScheduleTabChange','handleKeywordFilterChange','handleDateRangeFilterChange','handleLeaderFilterChange','handleAttendeeFilterChange','toggleScheduleViewMode','renderSchedulesPage','clearScheduleFilters'])assert.equal(new RegExp('on(?:click|change)="'+name+'\\(').test(appSource),false);
 assert.equal((appSource.match(/data-schedule-read-action=/g)||[]).length,8);assert.equal((appSource.match(/data-schedule-read-filter=/g)||[]).length,4);
 for(const marker of ['data-absence-prepare-action="open"','data-absence-action="approve"','onclick="submitAbsenceRequest()"'])assert.ok(appSource.includes(marker),marker);
 const f=fixture();assert.deepEqual(f.listeners.map(l=>l.type),['click','change']);
});
test('fixed click actions pass exact month/view values, and tabs stay manager-only',async()=>{
 for(const role of ['crew','leader','admin']){
  const f=fixture();f.c.currentUser={role};const click=(action,extra={})=>f.c.handleScheduleReadClick({target:f.button(action,extra)});
  await click('previous-month');await click('next-month');await click('tab',{scheduleTab:'confirmed'});await click('tab',{scheduleTab:'pending'});await click('view',{scheduleView:'list'});await click('view',{scheduleView:'calendar'});await click('reload');await click('clear');
  assert.deepEqual(f.calls,[['changeScheduleMonth',-1],['changeScheduleMonth',1],...(role==='crew'?[]:[['handleScheduleTabChange','confirmed'],['handleScheduleTabChange','pending']]),['toggleScheduleViewMode','list'],['toggleScheduleViewMode','calendar'],['renderSchedulesPage'],['clearScheduleFilters']]);
 }
});
test('filters preserve fixed keyword/date values and exact dynamic leader/attendee strings',()=>{
 const f=fixture(),change=n=>f.c.handleScheduleReadChange({target:n});
 for(const value of ['all','ロープレ','1on1','チームMTG','チーム研修','全Tutor MTG'])change(f.select('keyword',value));
 for(const value of ['all','this_week','next_week','this_month','next_month'])change(f.select('date-range',value));
 const special='Synthetic "<& leader';change(f.select('leader',special));change(f.select('attendee',special));
 assert.equal(f.calls.length,13);assert.deepEqual(f.calls.slice(-2),[['handleLeaderFilterChange',special],['handleAttendeeFilterChange',special]]);
 change(f.select('keyword','unknown'));change(f.select('date-range','tomorrow'));change(f.select('__proto__','all'));assert.equal(f.calls.length,13);
});
test('unknown actions/tabs/views and invalid auth, page, old roots and disabled inputs do not dispatch',()=>{
 const f=fixture();
 for(const action of ['constructor','__proto__','changeScheduleMonth(10)'])f.c.handleScheduleReadClick({target:f.button(action)});
 for(const tab of ['unknown','__proto__'])f.c.handleScheduleReadClick({target:f.button('tab',{scheduleTab:tab})});
 for(const view of ['unknown','__proto__'])f.c.handleScheduleReadClick({target:f.button('view',{scheduleView:view})});
 const click=f.button('next-month'),change=f.select('leader','synthetic');f.elements.content=f.root();f.c.handleScheduleReadClick({target:click});f.c.handleScheduleReadChange({target:change});
 const currentClick=f.button('next-month'),currentChange=f.select('leader','synthetic');
 for(const node of [currentClick,currentChange])node.disabled=true;
 f.c.handleScheduleReadClick({target:currentClick});f.c.handleScheduleReadChange({target:currentChange});for(const n of[currentClick,currentChange])n.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c.handleScheduleReadClick({target:currentClick});f.c.handleScheduleReadChange({target:currentChange});}
 f.c.currentUser={role:'admin'};f.c.sessionToken='';f.c.handleScheduleReadClick({target:currentClick});f.c.handleScheduleReadChange({target:currentChange});f.c.sessionToken='synthetic';f.c.currentPage='students';f.c.handleScheduleReadClick({target:currentClick});f.c.handleScheduleReadChange({target:currentChange});
 assert.equal(f.calls.length,0);
});
test('stable delegated listeners handle nested targets and recreated content without extra registration',async()=>{
 const f=fixture();let n=f.button('next-month');await f.c.handleScheduleReadClick({target:{closest:()=>n}});f.elements.content=f.root();n=f.button('previous-month');await f.c.handleScheduleReadClick({target:{closest:()=>n}});
 f.c.handleScheduleReadChange({target:f.select('leader','Synthetic leader')});assert.deepEqual(f.calls,[['changeScheduleMonth',1],['changeScheduleMonth',-1],['handleLeaderFilterChange','Synthetic leader']]);assert.equal(f.listeners.length,2);
});
test('real month rollover retains confirmed reload and pending read behavior',async()=>{
 const f=fixture();real(f);await f.c.handleScheduleReadClick({target:f.button('previous-month')});assert.equal(f.c.selectedScheduleYear,2025);assert.equal(f.c.selectedScheduleMonth,12);assert.deepEqual(f.calls,[['renderSchedulesPage']]);
 f.calls.length=0;f.c.scheduleTab='pending';await f.c.handleScheduleReadClick({target:f.button('next-month')});assert.equal(f.c.selectedScheduleYear,2026);assert.equal(f.c.selectedScheduleMonth,1);assert.deepEqual(f.calls,[['get','/api/schedules/absence-requests/pending?year=2026&month=1'],['render-content']]);assert.equal(f.c.pendingRequests[0].id,'synthetic-request');
});
test('real filters/view and clear retain local state values and one render each',()=>{
 const f=fixture();real(f);const change=(filter,value)=>f.c.handleScheduleReadChange({target:f.select(filter,value)});
 change('keyword','1on1');change('date-range','next_week');change('leader','Synthetic leader');change('attendee','Synthetic attendee');f.c.handleScheduleReadClick({target:f.button('view',{scheduleView:'calendar'})});
 assert.equal(f.c.selectedKeyword,'1on1');assert.equal(f.c.selectedDateRange,'next_week');assert.equal(f.c.selectedLeader,'Synthetic leader');assert.equal(f.c.selectedAttendee,'Synthetic attendee');assert.equal(f.c.scheduleViewMode,'calendar');assert.equal(f.calls.length,5);
 f.c.handleScheduleReadClick({target:f.button('clear')});for(const key of ['selectedKeyword','selectedDateRange','selectedLeader','selectedAttendee'])assert.equal(f.c[key],'all');assert.equal(f.calls.length,6);assert.ok(f.calls.every(c=>c[0]==='render-content'));
});
