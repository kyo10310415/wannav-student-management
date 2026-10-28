import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const names=['navigation-events','today-events','extension-stats-events'];
const sources=await Promise.all(names.map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const indexSource=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];const root=()=>({contains(node){return node.root===this}});
 const elements={content:root(),header:root()};elements.app={querySelector:()=>elements.header};
 const c={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'today',minutesCurrentStudentId:'synthetic',minutesCurrentStudentName:'synthetic',document:{getElementById:id=>elements[id],addEventListener:(type,cb)=>listeners.push({type,cb})},changePage:page=>calls.push(['page',page]),changeLessonDate:delta=>calls.push(['date',delta]),resetToToday:()=>calls.push(['today']),changeExtensionTutor:value=>calls.push(['tutor',value]),renderSuspensionsPage:()=>calls.push(['suspensions'])};
 vm.createContext(c);sources.forEach(source=>vm.runInContext(source,c));
 const node=(selector,dataset={},at=elements.content)=>{const n={root:at,dataset,disabled:false,value:'synthetic'};n.closest=s=>s===selector?n:null;return n};
 return {c,elements,calls,listeners,root,node};
}
const common=['today','reservations','helpers','students','red-list','extensions','suspensions','broadcast','tutors','daily-reports','schedules'];
const managers=['handover','funnel','vq-diagnosis','lesson-reports','minutes','lesson-contents'];
const admins=['users','database','tutor-red-list'];
test('navigation matches existing role-specific entries and preserves minutes filter reset',()=>{
 for(const role of ['admin','leader','crew']){
  const f=fixture();f.c.currentUser={role};
  for(const page of [...common,...managers,...admins,'roulette-winners','unknown','__proto__'])f.c.handleNavigationClick({target:f.node('button[data-nav-page]',{navPage:page},f.elements.header)});
  const expected=[...common,...(role!=='crew'?managers:[]),...(role==='admin'?admins:[])];
  assert.deepEqual(f.calls.map(c=>c[1]),expected);
  assert.equal(f.c.minutesCurrentStudentId,role==='crew'?'synthetic':null);assert.equal(f.c.minutesCurrentStudentName,role==='crew'?'synthetic':null);
 }
});
test('navigation rejects disabled, old header, content buttons, missing auth and unknown roles',()=>{
 const f=fixture();const create=()=>f.node('button[data-nav-page]',{navPage:'today'},f.elements.header);
 const old=create();f.elements.header=f.root();f.c.handleNavigationClick({target:old});
 const disabled=create();disabled.disabled=true;f.c.handleNavigationClick({target:disabled});
 f.c.handleNavigationClick({target:f.node('button[data-nav-page]',{navPage:'today'})});
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c.handleNavigationClick({target:create()});}
 f.c.currentUser={role:'admin'};f.c.sessionToken='';f.c.handleNavigationClick({target:create()});assert.equal(f.calls.length,0);
 f.c.sessionToken='synthetic';const current=create();f.c.handleNavigationClick({target:{closest:()=>current}});assert.deepEqual(f.calls,[['page','today']]);
});
test('today date controls pass fixed deltas and only act on the current today page',()=>{
 const f=fixture();const click=action=>f.c.handleTodayDateClick({target:f.node('button[data-today-action]',{todayAction:action})});
 for(const action of ['previous','next','today','__proto__','changeLessonDate(100)'])click(action);
 assert.deepEqual(f.calls,[['date',-1],['date',1],['today']]);
 f.c.currentPage='students';click('next');assert.equal(f.calls.length,3);
});
test('real date functions preserve month/year boundaries and today reset without API calls',()=>{
 const f=fixture();f.c.currentLessonDate=new Date(2026,0,1,12);let renders=0;f.c.renderTodayLessonsPage=()=>renders++;
 const start=appSource.indexOf('function changeLessonDate(days)');const end=appSource.indexOf('// ===== Lesson Report Modal',start);
 vm.runInContext(appSource.slice(start,end),f.c);
 f.c.handleTodayDateClick({target:f.node('button[data-today-action]',{todayAction:'previous'})});
 assert.equal(f.c.currentLessonDate.getFullYear(),2025);assert.equal(f.c.currentLessonDate.getMonth(),11);assert.equal(f.c.currentLessonDate.getDate(),31);
 f.c.handleTodayDateClick({target:f.node('button[data-today-action]',{todayAction:'next'})});assert.equal(f.c.currentLessonDate.getFullYear(),2026);
 const before=Date.now();f.c.handleTodayDateClick({target:f.node('button[data-today-action]',{todayAction:'today'})});assert.ok(f.c.currentLessonDate.getTime()>=before);assert.equal(renders,3);
});
test('extension Tutor selection is manager-only and suspension retry allows all existing roles',()=>{
 const f=fixture();
 for(const role of ['admin','leader','crew']){
  f.c.currentUser={role};f.c.currentPage='extensions';const n=f.node('select[data-extension-stats-tutor]');n.value='Synthetic <Tutor>';
  f.c.handleExtensionStatsChange({target:n});f.c.currentPage='suspensions';f.c.handleSuspensionReloadClick({target:f.node('button[data-suspension-action]',{suspensionAction:'reload'})});
 }
 assert.deepEqual(f.calls,[['tutor','Synthetic <Tutor>'],['suspensions'],['tutor','Synthetic <Tutor>'],['suspensions'],['suspensions']]);
});
test('today and statistics controls reject stale roots, disabled, missing session and unknown roles',()=>{
 const f=fixture();
 const cases=[['today','button[data-today-action]',{todayAction:'next'},'handleTodayDateClick'],['extensions','select[data-extension-stats-tutor]',{},'handleExtensionStatsChange'],['suspensions','button[data-suspension-action]',{suspensionAction:'reload'},'handleSuspensionReloadClick']];
 for(const [page,selector,dataset,handler]of cases){
  f.c.currentPage=page;const old=f.node(selector,dataset);f.elements.content=f.root();f.c[handler]({target:old});
  const n=f.node(selector,dataset);n.disabled=true;f.c[handler]({target:n});n.disabled=false;
  f.c.sessionToken='';f.c[handler]({target:n});f.c.sessionToken='synthetic';
  for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c[handler]({target:n});}f.c.currentUser={role:'admin'};
  f.c.currentPage='other';f.c[handler]({target:n});
 }assert.equal(f.calls.length,0);
});
test('root loads five external scripts after app.js and excluded/write controls remain unchanged',()=>{
 for(const name of [...names,'funnel-events','lesson-report-events']){const marker=`<script src="/${name}.js?v=`;assert.equal(indexSource.split(marker).length-1,1);assert.ok(indexSource.indexOf(marker)>indexSource.indexOf('<script src="/app.js'));}
 for(const page of [...common,...managers,...admins])assert.ok(appSource.includes(`data-nav-page="${page}"`));
 assert.ok(appSource.includes('id="nav-roulette-winners" onclick="changePage(\'roulette-winners\')"'));
 for(const inline of ['onclick="logout()"','onclick="toggleSurveyNotification()"','onclick="refreshFunnelDiscordInsights()"','onclick="resetTestRouletteResults()"'])assert.ok(appSource.includes(inline));
 assert.equal(/onclick="(?:changeLessonDate|resetToToday|renderSuspensionsPage)\(/.test(appSource),false);assert.equal(appSource.includes('onchange="changeExtensionTutor(this.value)"'),false);
 assert.equal(fixture().listeners.length,4);
});


test('handover entry retains the existing manager-only UI permission',()=>{
 for(const role of ['crew','leader','admin']){
  const f=fixture();f.c.currentUser={role};f.c.handleNavigationClick({target:f.node('button[data-nav-page]',{navPage:'handover'},f.elements.header)});
  assert.deepEqual(f.calls,role==='crew'?[]:[['page','handover']]);
 }
 assert.match(appSource,/\$\{currentUser && \(currentUser\.role === 'admin' \|\| currentUser\.role === 'leader'\) \? `[\s]*<button id="nav-handover" data-nav-page="handover"/);
});
