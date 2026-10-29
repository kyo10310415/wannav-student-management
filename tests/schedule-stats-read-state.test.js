import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{const a=source.indexOf('async function '+name+'(');return source.slice(a,source.indexOf('\n}',a)+2)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(page='schedules'){
 const calls=[],renders=[],errors=[],elements={content:{innerHTML:'old'},'absence-stats-container':{innerHTML:'stats old'}};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'admin'},currentPage:page,scheduleTab:'confirmed',selectedScheduleYear:2026,selectedScheduleMonth:10,selectedStatsYear:2026,selectedStatsMonth:10,schedules:['old schedules'],pendingRequests:['old pending'],absenceStats:'old stats',document:{getElementById:id=>elements[id]},API_BASE:'',console:{error:m=>errors.push(m)},renderSchedulesContent:()=>renders.push('schedules'),renderAbsenceStatsSection:()=>renders.push('stats'),axios:{get:url=>{const d=deferred();calls.push({url,...d});return d.promise;}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let scheduleReadGeneration ='),source.indexOf('async function renderSchedulesPage('))+'\n'+['renderSchedulesPage','changeScheduleMonth','handleScheduleTabChange'].map(extract).join('\n')+'\nlet absenceStatsReadGeneration=0;\n'+['fetchAbsenceStats','changeAbsenceStatsMonth'].map(extract).join('\n'),c);
 return{c,calls,renders,errors,elements};
}
const schedules=data=>({data:{success:true,data}}), absence={data:{success:true,data:{requests:{}}}},pending=data=>({data:{success:true,data:{pendingRequests:data}}});
const tick=()=>new Promise(r=>setImmediate(r));
test('schedule two-step reverse responses commit only latest data atomically',async()=>{
 const f=fixture();const old=f.c.renderSchedulesPage();f.calls[0].resolve(schedules([{event_id:'old'}]));await tick();assert.deepEqual(f.c.schedules,['old schedules']);
 const latest=f.c.renderSchedulesPage();f.calls[2].resolve(schedules([{event_id:'latest'}]));await tick();f.calls[3].resolve(absence);await latest;f.calls[1].resolve(absence);await old;assert.equal(f.c.schedules[0].event_id,'latest');assert.deepEqual(f.renders,['schedules']);
});
test('latest pending read defeats old success/error and a confirmed-tab switch invalidates pending',async()=>{
 for(const fail of [false,true]){const f=fixture();const old=f.c.handleScheduleTabChange('pending');const latest=f.c.handleScheduleTabChange('pending');f.calls[1].resolve(pending(['latest']));await latest;if(fail)f.calls[0].reject(new Error('private fixture'));else f.calls[0].resolve(pending(['old']));await old;assert.deepEqual(f.c.pendingRequests,['latest']);assert.equal(f.errors.length,0);assert.equal(f.renders.length,1);}
 const f=fixture();const p=f.c.handleScheduleTabChange('pending');await f.c.handleScheduleTabChange('confirmed');f.calls[0].resolve(pending(['old']));await p;assert.deepEqual(f.c.pendingRequests,['old pending']);assert.equal(f.renders.length,1);
});
test('schedule stale responses cannot write cache DOM or logs after state change',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='leader',f=>f.c.currentPage='students',f=>f.elements.content={innerHTML:'new'},f=>f.c.selectedScheduleMonth=11,f=>f.c.selectedScheduleYear=2027,f=>f.c.scheduleTab='pending'];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=f.c.renderSchedulesPage();change(f);f.elements.content.innerHTML='new';if(fail)f.calls[0].reject(new Error('private fixture'));else f.calls[0].resolve(schedules(['stale']));await p;assert.deepEqual(f.c.schedules,['old schedules']);assert.equal(f.elements.content.innerHTML,'new');assert.equal(f.renders.length,0);assert.equal(f.errors.length,0);}
});
test('month boundaries and parent callback remain effective without unauthorised navigation',async()=>{
 const f=fixture();f.c.selectedScheduleMonth=12;const p=f.c.changeScheduleMonth(1);assert.equal(f.c.selectedScheduleMonth,1);assert.equal(f.c.selectedScheduleYear,2027);f.calls[0].resolve(schedules([]));await tick();assert.match(f.calls[1].url,/year=2027&month=1/);f.calls[1].resolve(absence);await p;
 let current=true;const q=f.c.renderSchedulesPage(()=>current);current=false;f.calls[2].resolve(schedules(['old']));await q;assert.equal(f.renders.length,1);
 for(const mutate of [f=>f.c.sessionToken=null,f=>f.c.currentPage='students',f=>f.c.currentUser.role='unknown']){const g=fixture();mutate(g);await g.c.changeScheduleMonth(1);await g.c.renderSchedulesPage();await g.c.handleScheduleTabChange('pending');assert.equal(g.calls.length,0);assert.equal(g.c.selectedScheduleMonth,10);}
});
test('stats duplicate reads latest wins; stale success or failure never overwrites',async()=>{
 for(const fail of [false,true]){const f=fixture('tutors'),old=f.c.fetchAbsenceStats(2026,10),latest=f.c.fetchAbsenceStats(2026,10);f.calls[1].resolve(schedules({stats:['latest']}));await latest;if(fail)f.calls[0].reject(new Error('private fixture'));else f.calls[0].resolve(schedules({stats:['old']}));await old;assert.deepEqual(f.c.absenceStats,{stats:['latest']});assert.deepEqual(f.renders,['stats']);assert.equal(f.errors.length,0);}
});
test('stats stale read protects auth role page root container and selected month',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.elements.content={},f=>f.elements['absence-stats-container']={},f=>f.c.selectedStatsMonth=11,f=>f.c.selectedStatsYear=2027];
 for(const change of changes)for(const fail of [false,true]){const f=fixture('tutors'),p=f.c.fetchAbsenceStats(2026,10);change(f);f.elements['absence-stats-container'].innerHTML='new';if(fail)f.calls[0].reject(new Error('private fixture'));else f.calls[0].resolve(schedules({stats:['old']}));await p;assert.equal(f.c.absenceStats,'old stats');assert.equal(f.elements['absence-stats-container'].innerHTML,'new');assert.equal(f.renders.length,0);assert.equal(f.errors.length,0);}
});
test('stats month reverse order, rollover, current failure and crew gate',async()=>{
 const f=fixture('tutors');f.c.selectedStatsMonth=1;const p=f.c.changeAbsenceStatsMonth(-1);assert.equal(f.c.selectedStatsYear,2025);assert.equal(f.c.selectedStatsMonth,12);const q=f.c.changeAbsenceStatsMonth(1);f.calls[1].resolve(schedules({stats:['new']}));await q;f.calls[0].resolve(schedules({stats:['old']}));await p;assert.deepEqual(f.c.absenceStats,{stats:['new']});assert.equal(f.renders.length,1);
 const r=f.c.fetchAbsenceStats(2026,1);f.calls[2].reject(new Error('private fixture'));await r;assert.equal(f.c.absenceStats,null);assert.equal(f.errors.length,1);assert.equal(f.elements['absence-stats-container'].innerHTML.includes('private'),false);
 const g=fixture('tutors');g.c.currentUser.role='crew';await g.c.changeAbsenceStatsMonth(1);await g.c.fetchAbsenceStats(2026,10);assert.equal(g.calls.length,0);assert.equal(g.c.selectedStatsMonth,10);
});
