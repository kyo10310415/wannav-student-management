import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const extract=name=>{const a=source.indexOf(`function ${name}(`);assert.ok(a>=0);return(source.slice(a-6,a)==='async '?'async ':'')+source.slice(a,source.indexOf('\n}',a)+2)};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const calls=[],logs=[],renders=[],timers=[],charts=[],elements={content:{}},tutor={employee_id:'fixture',tutor_name:'Synthetic',notion_name:'Synthetic'};
 const data={'2026/9':{average:8,count:1,responses:[]},'2026/10':{average:9,count:1,responses:[]}};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'crew'},currentPage:'tutors',selectedTutorYear:2026,selectedTutorMonth:10,selectedTeam:'all',tutors:[tutor],satisfactionData:{fixture:data},tutorMonthlyStats:{old:true},tutorWeeklySnapshotData:{old:true},satisfactionLessonCompletionByMonth:{},students:[],API_BASE:'',canViewOverallSatisfactionMetrics:()=>false,getTutorSatisfactionData:()=>data,getSatisfactionActiveStudents:()=>[{}],getJstDateParts:()=>({year:2026,month:10}),getSatisfactionDenominator:()=>1,getOverallSatisfactionDenominator:()=>1,isLessonCompletionFilterActive:()=>false,normalizeSatisfactionStudentId:x=>x,escapeHtml:x=>String(x??''),console:{error:m=>logs.push(m),log(){}},alert:m=>logs.push(m),setTimeout:fn=>timers.push(fn),Chart:function(...args){charts.push(args)},renderTutorsPage:()=>renders.push('render')};
 c.document={getElementById:id=>elements[id]??null,body:{contains:node=>elements.satisfactionModal===node,insertAdjacentHTML:(where,html)=>{renders.push(html);const canvas={getContext:()=>({})};const modal={contains:node=>node===canvas,remove:()=>{delete elements.satisfactionModal;delete elements.satisfactionChart}};elements.satisfactionModal=modal;elements.satisfactionChart=canvas}}};
 function send(type,args){const d=defer();calls.push({type,args,...d});return d.promise}
 c.axios={get:(...args)=>send('get',args)};c.loadSatisfactionLessonCompletion=(...args)=>send('completion',args);
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const tutorMonthReadStates ='),source.indexOf('async function loadTutorMonthlyStats()'))+'\nlet satisfactionModalReadGeneration=0;\n'+['loadTutorMonthlyStats','loadTutorWeeklySnapshot','changeTutorStatsMonth','showSatisfactionModal','closeSatisfactionModal'].map(extract).join('\n'),c);
 return{c,calls,logs,renders,timers,charts,elements,tutor,data};
}
const ok=data=>({data:{success:true,data}}),tick=()=>new Promise(r=>setImmediate(r));
test('monthly and weekly normal reads keep API and current fallback; reverse old replies ignored',async()=>{
 for(const name of ['loadTutorMonthlyStats','loadTutorWeeklySnapshot'])for(const fail of [false,true]){const f=fixture(),p=f.c[name](),q=f.c[name]();f.calls[1].resolve(ok({latest:true}));await q;if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(ok({old:true}));await p;assert.equal((name==='loadTutorMonthlyStats'?f.c.tutorMonthlyStats:f.c.tutorWeeklySnapshotData).latest,true);assert.equal(f.logs.length,0);}
 const f=fixture(),p=f.c.loadTutorWeeklySnapshot();assert.match(f.calls[0].args[0],/2026%2F10/);f.calls[0].reject(Error('private synthetic'));await p;assert.equal(Object.keys(f.c.tutorWeeklySnapshotData).length,0);assert.deepEqual(f.logs,['Error loading tutor weekly snapshot']);
});
test('monthly/weekly stale success or failure never changes new state after auth page DOM or month',async()=>{
 for(const name of ['loadTutorMonthlyStats','loadTutorWeeklySnapshot'])for(const change of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.elements.content={},f=>f.c.selectedTutorMonth=11,f=>f.c.selectedTutorYear=2027])for(const fail of [false,true]){const f=fixture(),old=f.c[name==='loadTutorMonthlyStats'?'tutorMonthlyStats':'tutorWeeklySnapshotData'],p=f.c[name]();change(f);if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(ok({new:true}));await p;assert.equal(f.c[name==='loadTutorMonthlyStats'?'tutorMonthlyStats':'tutorWeeklySnapshotData'],old);assert.equal(f.logs.length,0);}
});
test('real Tutor month pipeline preserves rollover and render; stale stages do not continue',async()=>{
 const f=fixture();f.c.selectedTutorMonth=12;const p=f.c.changeTutorStatsMonth(1);f.calls[0].resolve(ok({monthly:true}));await tick();f.calls[1].resolve(ok({weekly:true}));await tick();assert.deepEqual(Array.from(f.calls[2].args),[2027,1,true]);f.calls[2].resolve({});await p;assert.deepEqual(f.renders,['render']);
 for(const phase of [0,1,2]){const g=fixture(),q=g.c.changeTutorStatsMonth(1);for(let i=0;i<phase;i++){g.calls[i].resolve(ok({}));await tick()}g.c.currentPage='today';g.calls[phase].resolve(ok({}));await q;assert.equal(g.calls.length,phase+1);assert.equal(g.renders.length,0);}
});
test('satisfaction modal real caller keeps historical parallel fetches and normal chart',async()=>{
 const f=fixture(),p=f.c.showSatisfactionModal('fixture');assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>Array.from(c.args)),[[2026,9],[2026,10]]);f.calls[1].resolve({});f.calls[0].resolve({});await p;assert.equal(f.renders.length,1);assert.match(f.renders[0],/satisfactionModal/);f.timers[0]();assert.equal(f.charts.length,1);assert.equal(f.charts[0][1].data.labels.length,2);
});
test('satisfaction modal stale caller cannot open after auth target page month team cache or close change',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.elements.content={},f=>f.c.selectedTutorMonth=11,f=>f.c.selectedTeam='new',f=>f.c.tutors=[],f=>f.tutor.tutor_name='new',f=>f.data['2026/10'].average=1,f=>f.c.satisfactionData={},f=>f.c.closeSatisfactionModal()];
 for(const change of changes){const f=fixture(),p=f.c.showSatisfactionModal('fixture');change(f);f.calls[0].resolve({});f.calls[1].resolve({});await p;assert.equal(f.renders.length,0);assert.equal(f.timers.length,0);}
});
test('only latest modal opens and delayed chart never attaches after close or replacement',async()=>{
 const f=fixture(),p=f.c.showSatisfactionModal('fixture'),q=f.c.showSatisfactionModal('fixture');f.calls[2].resolve({});f.calls[3].resolve({});await q;f.calls[0].resolve({});f.calls[1].resolve({});await p;assert.equal(f.renders.length,1);f.c.closeSatisfactionModal();f.timers[0]();assert.equal(f.charts.length,0);
 const g=fixture(),r=g.c.showSatisfactionModal('fixture');g.calls[0].resolve({});g.calls[1].resolve({});await r;g.elements.satisfactionModal={};g.timers[0]();assert.equal(g.charts.length,0);
});
