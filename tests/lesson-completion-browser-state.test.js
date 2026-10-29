import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
assert.ok(source.includes('/**\n * Load survey stats for a single student'));
const block=source.slice(source.indexOf('let lessonCompletionReadGeneration ='),source.indexOf('/**\n * Load survey stats for a single student'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const escapeHtml=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(ids=['fixture']){
 const calls=[],errors=[],students=ids.map(student_id=>({student_id})),cells=ids.map(id=>({dataset:{studentId:id},innerHTML:'loading'}));
 const body={},root={contains:n=>n===body||cells.includes(n),querySelectorAll:selector=>{assert.equal(selector,'.lesson-completion-loading[data-student-id]');return cells}};
 const elements={content:root,'student-table-body':body},dates=Object.create(null);ids.forEach(id=>dates[id]=[{date:new Date(2026,9,29)}]);
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'crew'},currentPage:'reservations',currentTab:'active',activeSubTab:'lesson',selectedTutor:'all',reservationCountFilter:'all',currentMonth:new Date(2026,9,1),studentSearchQuery:'',lessonDates:dates,getFilteredStudents:()=>students,document:{getElementById:id=>elements[id]},API_BASE:'',escapeHtml,console:{error:m=>errors.push(m)},axios:{post:(url,payload)=>{const d=deferred();calls.push({url,payload,...d});return d.promise;}}};
 vm.createContext(c);vm.runInContext(block,c);return{c,calls,errors,students,cells,root,body,elements};
}
const response=(id='fixture',extra={})=>({data:{success:true,data:[{studentId:id,lessonDate:'2026-10-29',completed:true,...extra}]}});
test('normal completion flow preserves local dates and displays summary without lessonResult HTML',async()=>{
 const f=fixture(),p=f.c.loadLessonCompletionBatch();assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload)),{items:[{studentId:'fixture',lessonDate:'2026-10-29'}]});f.calls[0].resolve(response('fixture',{lessonResult:'<b>private synthetic</b>'}));await p;assert.match(f.cells[0].innerHTML,/1\/1/);assert.match(f.cells[0].innerHTML,/10\/29/);assert.equal(f.cells[0].innerHTML.includes('private synthetic'),false);
});
test('completion reverse response commits only newest request',async()=>{
 const f=fixture(),old=f.c.loadLessonCompletionBatch(),latest=f.c.loadLessonCompletionBatch();f.calls[1].resolve(response());await latest;const html=f.cells[0].innerHTML;f.calls[0].resolve(response('fixture',{completed:false}));await old;assert.equal(f.cells[0].innerHTML,html);
});
test('stale results and errors are ignored across auth page DOM filters and cache mutation',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='students',f=>f.elements.content={},f=>f.elements['student-table-body']={},f=>f.c.currentTab='suspended',f=>f.c.activeSubTab='pro',f=>f.c.selectedTutor='other',f=>f.c.reservationCountFilter='above2',f=>f.c.currentMonth.setMonth(10),f=>f.c.studentSearchQuery='new',f=>f.c.lessonDates=Object.create(null),f=>f.students[0].student_id='new',f=>f.c.getFilteredStudents=()=>[],f=>f.c.lessonDates.fixture[0].date.setDate(30),f=>f.c.lessonDates.fixture.push({date:new Date()}),f=>f.cells.splice(0,1)];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),cell=f.cells[0],p=f.c.loadLessonCompletionBatch();change(f);if(fail)f.calls[0].reject(new Error('private synthetic'));else f.calls[0].resolve(response());await p;assert.equal(cell.innerHTML,'loading');assert.equal(f.errors.length,0);}
});
test('filter rerender for same students keeps new DOM free from old result',async()=>{
 const f=fixture(),p=f.c.loadLessonCompletionBatch(),old=f.cells[0];f.cells.splice(0,1,{dataset:{studentId:'fixture'},innerHTML:'new loading'});f.calls[0].resolve(response());await p;assert.equal(old.innerHTML,'loading');assert.equal(f.cells[0].innerHTML,'new loading');
});
test('special identifiers use exact datasets and Map grouping; unrelated response pairs ignored',async()=>{
 const ids=['a"], .other','__proto__','constructor'];const f=fixture(ids),p=f.c.loadLessonCompletionBatch();f.calls[0].resolve({data:{success:true,data:ids.map(id=>response(id).data.data[0]).concat([{studentId:ids[0],lessonDate:'2026-10-30',completed:false},{studentId:'foreign',lessonDate:'2026-10-29',completed:true}])}});await p;for(const cell of f.cells)assert.match(cell.innerHTML,/1\/1/);assert.equal(f.errors.length,0);
});
test('display date fallback renders synthetic tags literally and never interpolates selector ids',()=>{
 const f=fixture(['quote"selector']);f.c.updateLessonCompletionDisplay('quote"selector',[{lessonDate:'abcde<b>fixture</b>',completed:false}]);assert.equal(f.cells[0].innerHTML.includes('<b '),false);assert.match(f.cells[0].innerHTML,/&lt;b/);f.c.updateLessonCompletionDisplay('missing',[]);f.c.updateLessonCompletionDisplay('quote"selector',[]);assert.match(f.cells[0].innerHTML,/>-</);
});
test('missing session role page and zero items do not send; current failure logs fixed message',async()=>{
 for(const change of [f=>f.c.sessionToken=null,f=>f.c.currentUser.role='unknown',f=>f.c.currentPage='students',f=>delete f.elements['student-table-body'],f=>f.c.lessonDates=Object.create(null)]){const f=fixture();change(f);await f.c.loadLessonCompletionBatch();assert.equal(f.calls.length,0);}
 const f=fixture(),p=f.c.loadLessonCompletionBatch();f.calls[0].reject(new Error('private synthetic'));await p;assert.deepEqual(f.errors,['[Lesson Completion] Error loading lesson completion']);assert.equal(f.cells[0].innerHTML,'loading');
});
test('actual reservation render starts completion lookup and normal response reaches captured cell',async()=>{
 const f=fixture();const klass={add(){},remove(){}};f.elements.loading={classList:klass};f.root.classList=klass;
 Object.assign(f.c,{formatMonth:()=> '2026年10月',getTutorOptions:()=>'',renderStatistics:()=>'',renderActiveSubTabs:()=>'',getTabTitle:()=>'',renderContractPlanTabs:()=>'',renderStudentRows:()=>'<tr><td class="lesson-completion-loading" data-student-id="fixture"></td></tr>',loadStudentSurveyStats:async()=>null,updateRouletteMarker:()=>{}});
 const a=source.indexOf('function renderReservationsPage()'),b=source.indexOf('\n}',a)+2;vm.runInContext(source.slice(a,b),f.c);f.c.renderReservationsPage();assert.equal(f.calls.length,1);assert.match(f.root.innerHTML,/student-table-body/);f.calls[0].resolve(response());await new Promise(r=>setImmediate(r));assert.match(f.cells[0].innerHTML,/1\/1/);
});
