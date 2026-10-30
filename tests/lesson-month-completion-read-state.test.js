import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const extract=name=>{const a=source.indexOf(`function ${name}(`);assert.ok(a>=0,name);return (source.slice(a-6,a)==='async '?'async ':'')+source.slice(a,source.indexOf('\n}',a)+2)};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const calls=[],logs=[],renders=[],elements={content:{innerHTML:'old'},'current-month-display':{textContent:''}};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'crew'},currentPage:'reservations',currentMonth:new Date(2026,9,1),lessonStats:{fixture:9},lessonDates:{fixture:[]},selectedTutorYear:2026,selectedTutorMonth:10,satisfactionLessonCompletionByMonth:{},isLessonCompletionFilterActive:()=>true,normalizeSatisfactionStudentId:id=>String(id).trim().toUpperCase(),document:{getElementById:id=>elements[id]},API_BASE:'',formatMonth:d=>`${d.getFullYear()}-${d.getMonth()+1}`,renderApp:()=>renders.push([c.lessonStats,c.lessonDates]),console:{error:m=>logs.push(m)},alert:m=>logs.push(m),axios:{get:(url,options)=>{const d=defer();calls.push({url,options,...d});return d.promise}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const lessonMonthReadStates ='),source.indexOf('// Load lesson statistics.'))+'\nconst satisfactionCompletionReadStates=new Map();let satisfactionCompletionCacheOwner=null;\n'+['loadLessonStats','loadLessonDates','changeMonth','loadSatisfactionLessonCompletion'].map(extract).join('\n'),c);
 return{c,calls,logs,renders,elements};
}
const success=data=>({data:{success:true,data}}),stats=n=>success([{student_id:'fixture',lesson_count:String(n)}]),dates=day=>success([{student_id:'fixture',lesson_date:`2026-10-${day}T09:00:00.000Z`}]),completed=id=>success({completedStudentIds:[id],checkedLessonCount:1});
const tick=()=>new Promise(r=>setImmediate(r));
test('lesson stats and dates reverse responses commit only latest result and preserve date contract',async()=>{
 for(const name of ['loadLessonStats','loadLessonDates']){const f=fixture(),p=f.c[name](),q=f.c[name]();f.calls[1].resolve(name==='loadLessonStats'?stats(2):dates('29'));await q;f.calls[0].resolve(name==='loadLessonStats'?stats(1):dates('28'));await p;if(name==='loadLessonStats')assert.equal(f.c.lessonStats.fixture,2);else{assert.equal(f.c.lessonDates.fixture[0].formatted,'10/29');assert.equal(f.c.lessonDates.fixture[0].date.toISOString(),'2026-10-29T09:00:00.000Z');}}
});
test('lesson month stale success and failure cannot update cache or log after auth page DOM month change',async()=>{
 for(const name of ['loadLessonStats','loadLessonDates'])for(const change of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='students',f=>f.elements.content={},f=>f.c.currentMonth.setMonth(10)])for(const fail of [false,true]){const f=fixture(),oldStats=f.c.lessonStats,oldDates=f.c.lessonDates,p=f.c[name]();change(f);if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(name==='loadLessonStats'?stats(2):dates('29'));await p;assert.equal(f.c.lessonStats,oldStats);assert.equal(f.c.lessonDates,oldDates);assert.equal(f.logs.length,0);}
});
test('real month pipeline preserves rollover and order; old stage does not start another read or render',async()=>{
 const f=fixture();f.c.currentMonth=new Date(2026,11,1);const p=f.c.changeMonth(1);assert.equal(f.c.currentMonth.getFullYear(),2027);assert.match(f.calls[0].url,/stats\/2027\/1/);f.calls[0].resolve(stats(2));await tick();assert.match(f.calls[1].url,/month\/2027\/1/);f.calls[1].resolve(dates('29'));await p;assert.equal(f.renders.length,1);assert.equal(f.renders[0][0].fixture,2);assert.equal(f.renders[0][1].fixture[0].formatted,'10/29');
 for(const phase of [0,1]){const g=fixture(),q=g.c.changeMonth(1);if(phase===1){g.calls[0].resolve(stats(2));await tick();}g.c.currentPage='students';g.calls[phase].resolve(phase===0?stats(2):dates('29'));await q;assert.equal(g.calls.length,phase+1);assert.equal(g.renders.length,0);}
});
test('current month failure has fixed log, no partial dates mutation and no navigation render',async()=>{
 const f=fixture(),old=f.c.lessonDates,p=f.c.loadLessonDates();f.calls[0].resolve(success([{student_id:'fixture',lesson_date:'2026-10-29T09:00:00Z'},{student_id:'bad',lesson_date:null}]));await p;assert.equal(f.c.lessonDates,old);assert.deepEqual(f.logs,['Error loading lesson dates']);
 const g=fixture(),q=g.c.changeMonth(1);g.calls[0].reject(Error('private synthetic'));await q;assert.equal(g.calls.length,1);assert.equal(g.renders.length,0);assert.deepEqual(g.logs,['Error loading lesson stats','月の切り替えに失敗しました']);
});
test('satisfaction same-key force reverse responses cannot overwrite or delete new cache',async()=>{
 for(const fail of [false,true]){const f=fixture(),p=f.c.loadSatisfactionLessonCompletion(2026,10,true),q=f.c.loadSatisfactionLessonCompletion(2026,10,true);f.calls[1].resolve(completed(' new '));await q;if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(completed('old'));await p;assert.deepEqual([...f.c.satisfactionLessonCompletionByMonth['2026/10'].completedStudentIds],['NEW']);assert.equal(f.logs.length,0);}
});
test('satisfaction preserves independent historical reads and cache reuse but reauth fetches afresh',async()=>{
 const f=fixture(),p=f.c.loadSatisfactionLessonCompletion(2026,9),q=f.c.loadSatisfactionLessonCompletion(2026,10);assert.equal(f.calls[0].options.params.yearMonth,'2026-09');f.calls[1].resolve(completed('oct'));f.calls[0].resolve(completed('sep'));await Promise.all([p,q]);assert.ok(f.c.satisfactionLessonCompletionByMonth['2026/9'].loaded);await f.c.loadSatisfactionLessonCompletion(2026,9);assert.equal(f.calls.length,2);f.c.sessionToken='new';const r=f.c.loadSatisfactionLessonCompletion(2026,9);assert.equal(f.calls.length,3);assert.equal(f.c.satisfactionLessonCompletionByMonth['2026/10'],undefined);f.calls[2].resolve(completed('reauth'));await r;assert.deepEqual([...f.c.satisfactionLessonCompletionByMonth['2026/9'].completedStudentIds],['REAUTH']);
});
test('satisfaction stale response respects auth selected month page DOM and current failure remains retryable',async()=>{
 for(const change of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='tutors',f=>f.elements.content={},f=>f.c.selectedTutorMonth=11,f=>f.c.selectedTutorYear=2027])for(const fail of [false,true]){const f=fixture(),p=f.c.loadSatisfactionLessonCompletion(2026,10,true);change(f);if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(completed('old'));await p;assert.equal(f.c.satisfactionLessonCompletionByMonth['2026/10'],undefined);assert.equal(f.logs.length,0);}
 const f=fixture(),p=f.c.loadSatisfactionLessonCompletion(2026,10,true);f.calls[0].reject(Error('private synthetic'));await p;assert.equal(f.c.satisfactionLessonCompletionByMonth['2026/10'],undefined);assert.deepEqual(f.logs,['[Tutor Satisfaction] Failed to load lesson completion']);
});
test('actual month navigation feeds real reservation row renderer with the new stats and dates',async()=>{
 const f=fixture(),student={student_id:'fixture',name:'Synthetic',status:'アクティブ',contract_plan:'通常',lesson_progress:1};
 Object.assign(f.c,{getFilteredStudents:()=>[student],escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),getLessonCountColor:()=>'',getLessonCountBadgeColor:()=>'',getTutorDisplayName:()=>'-',renderStudentTextTypeBadge:()=>'-',getLessonProgressClass:()=>'',getLessonProgressDisplay:()=> 'L1',formatYouTubeUrl:()=>'',formatXUrl:()=>'',getPreviousMonth:()=> '2026-10'});
 vm.runInContext(['studentDisplayText','studentDisplayAttribute','studentDisplayLink','renderStudentRows'].map(extract).join('\n'),f.c);
 f.c.renderApp=()=>{f.elements.content.innerHTML=f.c.renderStudentRows()};
 const p=f.c.changeMonth(1);f.calls[0].resolve(stats(2));await tick();f.calls[1].resolve(success([{student_id:'fixture',lesson_date:'2026-11-29T09:00:00.000Z'}]));await p;assert.match(f.elements.content.innerHTML,/2回/);assert.match(f.elements.content.innerHTML,/11\/29/);assert.match(f.elements.content.innerHTML,/lesson-completion-loading/);
});
