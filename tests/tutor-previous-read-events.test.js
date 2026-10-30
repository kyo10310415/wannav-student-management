import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile}from'node:fs/promises';
const tutorSource=await readFile(new URL('../public/tutor-read-events.js',import.meta.url),'utf8'),previousSource=await readFile(new URL('../public/previous-targets-events.js',import.meta.url),'utf8'),appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];const root=()=>({contains(n){return n.root===this},hasAttribute(){return true},remove(){this.removed=true}});
 const elements=Object.fromEntries(['content','satisfactionModal','tutor-minutes-quality-modal','previous-lesson-targets-modal'].map(id=>[id,root()]));
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'tutors',console:{log(){}},document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})}};
 for(const name of ['changeTutorStatsMonth','changeAbsenceStatsMonth','handleTeamFilterChange','showSatisfactionModal','showTutorMinutesQualityModal','closeSatisfactionModal','closeTutorMinutesQualityModal','showPreviousLessonTargets','closePreviousLessonTargetsModal'])c[name]=(...args)=>calls.push([name,...args]);
 vm.createContext(c);vm.runInContext(tutorSource+'\n'+previousSource,c);
 const node=(selector,dataset={},at=elements.content)=>{const n={root:at,dataset,disabled:false,value:'Synthetic team'};n.closest=s=>s===selector?n:null;return n};
 const tutor=(action,extra={},at=elements.content)=>node('button[data-tutor-read-action]',{tutorReadAction:action,...extra},at);
 const previous=(action,extra={},at=elements.content)=>node('button[data-previous-targets-action]',{previousTargetsAction:action,...extra},at);
 return{c,elements,calls,listeners,root,node,tutor,previous};
}
test('Tutor month/team controls retain exact arguments and manager-only absence stats',async()=>{
 for(const role of ['admin','leader','crew']){
  const f=fixture();f.c.currentUser={role};
  for(const action of ['previous-month','next-month','previous-absence','next-absence'])await f.c.handleTutorReadClick({target:f.tutor(action)});
  await f.c.handleTutorTeamChange({target:f.node('select[data-tutor-team-filter]')});
  const expected=[['changeTutorStatsMonth',-1],['changeTutorStatsMonth',1],...(role!=='crew'?[['changeAbsenceStatsMonth',-1],['changeAbsenceStatsMonth',1]]:[]),['handleTeamFilterChange','Synthetic team']];assert.deepEqual(f.calls,expected);
 }
});
test('Tutor detail entry uses exact IDs and close buttons are bound to their own modal',async()=>{
 const f=fixture(),id="synthetic'\"<&>";
 for(const action of ['satisfaction','quality'])await f.c.handleTutorReadClick({target:{closest:()=>f.tutor(action,{tutorId:id})}});
 await f.c.handleTutorReadClick({target:f.tutor('close-satisfaction',{},f.elements.satisfactionModal)});
 await f.c.handleTutorReadClick({target:f.tutor('close-quality',{},f.elements['tutor-minutes-quality-modal'])});
 await f.c.handleTutorReadClick({target:f.tutor('close-quality',{},f.elements.satisfactionModal)});
 await f.c.handleTutorReadClick({target:f.tutor('quality')});
 assert.deepEqual(f.calls,[['showSatisfactionModal',id],['showTutorMinutesQualityModal',id],['closeSatisfactionModal'],['closeTutorMinutesQualityModal']]);
});
test('satisfaction backdrop closes only the exact current modal, while inside clicks remain open',()=>{
 const f=fixture();f.c.handleTutorReadClick({target:{closest:()=>null,root:f.elements.satisfactionModal}});assert.equal(f.calls.length,0);
 const old=f.elements.satisfactionModal;f.elements.satisfactionModal=f.root();old.closest=()=>null;f.c.handleTutorReadClick({target:old});assert.equal(f.calls.length,0);
 f.c.handleTutorReadClick({target:f.elements.satisfactionModal});assert.deepEqual(f.calls,[['closeSatisfactionModal']]);
});
test('Tutor handlers reject unknown actions, invalid sessions/roles, obsolete roots and disabled controls',()=>{
 const f=fixture();const old=f.tutor('next-month');f.elements.content=f.root();f.c.handleTutorReadClick({target:old});
 const n=f.tutor('next-month');n.disabled=true;f.c.handleTutorReadClick({target:n});n.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c.handleTutorReadClick({target:n});}f.c.currentUser={role:'admin'};
 f.c.sessionToken='';f.c.handleTutorReadClick({target:n});f.c.sessionToken='synthetic';f.c.currentPage='students';f.c.handleTutorReadClick({target:n});f.c.currentPage='tutors';
 for(const action of ['constructor','__proto__','changeTutorStatsMonth(100)'])f.c.handleTutorReadClick({target:f.tutor(action)});
 assert.equal(f.calls.length,0);
});
test('real Tutor month functions retain year rollover, load order and team rerender',async()=>{
 const f=fixture();Object.assign(f.c,{selectedTutorYear:2026,selectedTutorMonth:1,loadTutorMonthlyStats:async()=>f.calls.push(['monthly']),loadTutorWeeklySnapshot:async()=>f.calls.push(['weekly']),loadSatisfactionLessonCompletion:async(...args)=>f.calls.push(['completion',...args]),renderTutorsPage:()=>f.calls.push(['render'])});
 const start=appSource.indexOf('async function changeTutorStatsMonth(delta)'),end=appSource.indexOf('// Render tutor statistics',start);vm.runInContext(appSource.slice(appSource.indexOf('const tutorMonthReadStates ='),appSource.indexOf('async function loadTutorMonthlyStats()'))+'\n'+appSource.slice(start,end),f.c);
 await f.c.handleTutorReadClick({target:f.tutor('previous-month')});assert.equal(f.c.selectedTutorYear,2025);assert.equal(f.c.selectedTutorMonth,12);assert.deepEqual(f.calls,[['monthly'],['weekly'],['completion',2025,12,true],['render']]);
 await f.c.handleTutorTeamChange({target:f.node('select[data-tutor-team-filter]')});assert.equal(f.c.selectedTeam,'Synthetic team');
});
test('previous targets preserve exact student/date and modal close without broadening API access',async()=>{
 const f=fixture();f.c.currentPage='today';const id="Synthetic'\"<&>";
 await f.c.handlePreviousTargetsClick({target:f.previous('open',{studentId:id,lessonDate:'2026-10-28'})});
 await f.c.handlePreviousTargetsClick({target:f.previous('close',{},f.elements['previous-lesson-targets-modal'])});
 await f.c.handlePreviousTargetsClick({target:f.previous('close')});await f.c.handlePreviousTargetsClick({target:f.previous('open',{studentId:id})});
 assert.deepEqual(f.calls,[['showPreviousLessonTargets',id,'2026-10-28'],['closePreviousLessonTargetsModal']]);
});
test('previous targets reject stale roots, disabled, invalid auth/page and unknown actions',()=>{
 const f=fixture();f.c.currentPage='today';const extra={studentId:'synthetic',lessonDate:'2026-10-28'};
 const n=f.previous('open',extra);f.elements.content=f.root();f.c.handlePreviousTargetsClick({target:n});
 const current=f.previous('open',extra);current.disabled=true;f.c.handlePreviousTargetsClick({target:current});current.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c.handlePreviousTargetsClick({target:current});}f.c.currentUser={role:'admin'};f.c.sessionToken='';f.c.handlePreviousTargetsClick({target:current});f.c.sessionToken='synthetic';f.c.currentPage='students';f.c.handlePreviousTargetsClick({target:current});f.c.currentPage='today';f.c.handlePreviousTargetsClick({target:f.previous('__proto__',extra)});assert.equal(f.calls.length,0);
});
test('existing previous modal backdrop rejects content clicks after removing redundant inline stopPropagation',()=>{
 const f=fixture();const start=appSource.indexOf('function closePreviousLessonTargetsModal(event)'),end=appSource.indexOf('// ===== Column Filter',start);vm.runInContext(appSource.slice(start,end),f.c);
 const modal=f.elements['previous-lesson-targets-modal'];f.c.closePreviousLessonTargetsModal({target:{},currentTarget:modal});assert.equal(modal.removed,undefined);f.c.closePreviousLessonTargetsModal({target:modal,currentTarget:modal});assert.equal(modal.removed,true);
 assert.ok(appSource.includes('modal.onclick = closePreviousLessonTargetsModal;'));
});
test('markup escapes IDs, removes targeted inline handlers and preserves write controls',()=>{
 assert.match(appSource,/data-tutor-id="\$\{escapeHtml\(tutor.employee_id\)\.replace/);assert.match(appSource,/data-student-id="\$\{escapeHtml\(student.student_id\)\.replace/);
 for(const fn of ['changeTutorStatsMonth','changeAbsenceStatsMonth','handleTeamFilterChange','showSatisfactionModal','showTutorMinutesQualityModal','closeSatisfactionModal','closeTutorMinutesQualityModal','showPreviousLessonTargets','closePreviousLessonTargetsModal'])assert.equal(new RegExp('on(?:click|change)="'+fn+'\\(').test(appSource),false);
 for(const fn of ['exportTutorSatisfactionToSheet()','exportTutorQualityToSheet(this)','sendStatsReport()','triggerWeeklySnapshot()'])assert.ok(appSource.includes('onclick="'+fn+'"'));
});


test('new Tutor and previous-target data attributes encode double quotes without changing DOM values',()=>{
 const dangerous='Synthetic" data-injected="yes<&';
 const c={tutor:{employee_id:dangerous},student:{student_id:dangerous},lessonDateStr:dangerous,escapeHtml:text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};vm.createContext(c);
 for(const attr of ['data-tutor-id','data-student-id','data-lesson-date']){
  const anchor=appSource.indexOf(attr==='data-tutor-id'?'data-tutor-read-action="satisfaction"':'data-previous-targets-action="open"');const start=appSource.indexOf(attr+'="',anchor);const exprStart=appSource.indexOf('$'+'{',start);const exprEnd=appSource.indexOf('}',exprStart)+1;
  const value=vm.runInContext('`'+appSource.slice(exprStart,exprEnd)+'`',c);
  assert.equal(value,'Synthetic&quot; data-injected=&quot;yes&lt;&amp;');assert.equal(value.includes('"'),false);
 }
});

test('root loads four new delegates once after app.js while preserving the earlier delegates',async()=>{
 const index=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
 for(const name of ['student-search-events','student-filter-events','tutor-read-events','previous-targets-events','navigation-events','today-events','extension-stats-events','funnel-events','lesson-report-events']){
  const marker='<script src="/'+name+'.js?v=';assert.equal(index.split(marker).length-1,1);assert.ok(index.indexOf(marker)>index.indexOf('<script src="/app.js'));
 }
});
