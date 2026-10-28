import test from 'node:test';import assert from 'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../public/helper-prepare-events.js',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],requests=[],alerts=[],logs=[],listeners=[];const root=parent=>({root:parent,innerHTML:'',value:'',disabled:false,contains(node){for(let n=node;n;n=n.root)if(n===this)return true;return false},remove(){this.removed=true},classList:{hidden:true,remove(){this.hidden=false},add(){this.hidden=true}}});
 const elements={content:root(),'helper-request-modal':root()};for(const id of ['helper-date-input','lesson-search-input','lessons-list-container','lessons-list','helper-lesson-time-input','helper-reason-input','helper-notes-input','helper-deadline-input'])elements[id]=root(elements['helper-request-modal']);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'reservations',API_BASE:'',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},alert:text=>alerts.push(text),helperRequestData:{selectedDate:'2026-10-28',selectedLesson:null,reason:'',notes:'',deadline:null},students:[],lessonDates:{},cachedNotionUrls:{},getTutorDisplayName:value=>value,escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),axios:{get:async(...args)=>{requests.push(args);return{data:{data:[]}}}}};
 for(const name of ['openHelperRequestModal','closeHelperRequestModal','selectLesson','showHelperRequestConfirmation','showHelperRequestForm','loadLessonsForDate','filterLessons'])c[name]=(...args)=>calls.push([name,...args]);vm.createContext(c);vm.runInContext(source,c);
 const node=(selector,dataset={},at=elements['helper-request-modal'])=>{const n={root:at,dataset,disabled:false};n.closest=s=>s===selector?n:null;return n};
 const action=(value,data={},at)=>node('[data-helper-prepare-action]',{helperPrepareAction:value,...data},at);
 const install=()=>{const i=app.indexOf('function openHelperRequestModal()'),j=app.indexOf('// Submit helper request (Step 4:',i);vm.runInContext(app.slice(i,j),c)};
 return{c,calls,requests,alerts,logs,listeners,elements,root,node,action,install};
}
test('prepare dispatcher preserves fixed actions and exact ID without reaching submit',()=>{
 const f=fixture();for(const action of ['open','close','select','confirm','back','submit','__proto__'])f.c.handleHelperPrepareClick({target:f.action(action,{helperStudentId:'Synthetic"<&'},action==='open'?f.elements.content:undefined)});
 assert.deepEqual(f.calls,[['openHelperRequestModal'],['closeHelperRequestModal'],['selectLesson','Synthetic"<&'],['showHelperRequestConfirmation'],['showHelperRequestForm']]);assert.equal(f.requests.length,0);assert.equal(f.listeners.length,3);
});
test('external Notion link never selects the parent lesson row',()=>{
 const f=fixture();const row=f.action('select',{helperStudentId:'synthetic'}),link=f.node('a[data-helper-prepare-link]');link.closest=s=>s==='a[data-helper-prepare-link]'?link:s==='[data-helper-prepare-action]'?row:null;f.c.handleHelperPrepareClick({target:link});assert.equal(f.calls.length,0);
});
test('prepare controls require roles/session/current root and open is reservations-only',()=>{
 const f=fixture();for(const role of ['admin','leader','crew']){f.c.currentUser={role};f.c.handleHelperPrepareClick({target:f.action('open',{},f.elements.content)})}assert.equal(f.calls.length,3);f.calls.length=0;
 const stale=f.action('close');f.elements['helper-request-modal']=f.root();f.c.handleHelperPrepareClick({target:stale});const n=f.action('close');n.disabled=true;f.c.handleHelperPrepareClick({target:n});n.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.c.handleHelperPrepareClick({target:n})}f.c.currentUser={role:'admin'};f.c.sessionToken='';f.c.handleHelperPrepareClick({target:n});f.c.sessionToken='synthetic';f.c.currentPage='students';f.c.handleHelperPrepareClick({target:f.action('open',{},f.elements.content)});assert.equal(f.calls.length,0);
});
test('date/search handlers use the current modal and preserve real date cache and name filtering',async()=>{
 const f=fixture();f.install();f.c.students=[{student_id:'SYNTHETIC',name:'Synthetic Student',homeroom_tutor:'Synthetic Tutor',lesson_progress:1}];f.c.cachedNotionUrls.SYNTHETIC='https://fixture.invalid/notion';f.elements['helper-date-input'].value='2026-10-28';f.c.axios.get=async(...args)=>{f.requests.push(args);return{data:{data:[{student_id:'SYNTHETIC',lesson_date:'2026-10-28T00:00:00Z'}]}}};
 await f.c.handleHelperPrepareDateChange({target:f.node('input[data-helper-prepare-date]')});assert.equal(f.requests[0][0],'/api/lessons/month/2026/10');assert.equal(f.c.helperRequestData.selectedDate,'2026-10-28');assert.equal(f.c.lessonDates.SYNTHETIC[0].formatted,'10/28');assert.ok(f.elements['lessons-list'].innerHTML.includes('Synthetic Student'));
 f.elements['lesson-search-input'].value='missing';f.c.handleHelperPrepareSearchInput({target:f.node('input[data-helper-prepare-search]')});assert.ok(f.elements['lessons-list'].innerHTML.includes('この日のレッスンはありません'));
 assert.equal(JSON.stringify(f.logs).includes('SYNTHETIC'),false);assert.equal(JSON.stringify(f.logs).includes('Synthetic Student'),false);
});
test('real selection and confirmation validate before advancing, escape data and retain state when going back',()=>{
 const f=fixture();f.install();const special='Synthetic "<&';f.c.students=[{student_id:special,name:special,homeroom_tutor:special,lesson_progress:1}];f.c.cachedNotionUrls[special]='https://fixture.invalid/notion';
 f.c.handleHelperPrepareClick({target:f.action('select',{helperStudentId:special})});assert.equal(f.c.helperRequestData.selectedLesson.name,special);assert.ok(f.elements['helper-request-modal'].innerHTML.includes('Synthetic "&lt;&amp;'));
 f.c.handleHelperPrepareClick({target:f.action('confirm')});assert.equal(f.alerts.length,1);
 f.elements['helper-lesson-time-input'].value='10:00';f.c.handleHelperPrepareClick({target:f.action('confirm')});assert.equal(f.alerts.length,2);
 f.elements['helper-reason-input'].value='Synthetic <reason>';f.elements['helper-notes-input'].value='Synthetic <notes>';f.c.handleHelperPrepareClick({target:f.action('confirm')});assert.equal(f.alerts.length,3);
 f.elements['helper-deadline-input'].value='2026-10-29T10:00';f.c.handleHelperPrepareClick({target:f.action('confirm')});assert.equal(f.c.helperRequestData.reason,'Synthetic <reason>');assert.ok(f.elements['helper-request-modal'].innerHTML.includes('Synthetic &lt;reason&gt;'));assert.ok(f.elements['helper-request-modal'].innerHTML.includes('onclick="submitHelperRequest()"'));
 f.c.handleHelperPrepareClick({target:f.action('back')});assert.equal(f.c.helperRequestData.reason,'Synthetic <reason>');assert.ok(f.elements['helper-request-modal'].innerHTML.includes('helper-reason-input'));assert.equal(f.requests.length,0);
});
test('close resets preparation state without sending and lesson attributes protect quotes',()=>{
 const f=fixture();f.install();f.c.helperRequestData.reason='synthetic';f.c.handleHelperPrepareClick({target:f.action('close')});assert.equal(f.elements['helper-request-modal'].removed,true);assert.deepEqual(JSON.parse(JSON.stringify(f.c.helperRequestData)),{selectedDate:null,selectedLesson:null,reason:'',notes:'',deadline:null});assert.equal(f.requests.length,0);
 f.c.displayLessonsList([{student_id:'Synthetic"<id>',name:'Synthetic <name>',homeroom_tutor:'Tutor',lesson_progress:1}]);assert.ok(f.elements['lessons-list'].innerHTML.includes('data-helper-student-id="Synthetic&quot;&lt;id&gt;"'));assert.ok(f.elements['lessons-list'].innerHTML.includes('Synthetic &lt;name&gt;'));
});
test('only eleven preparation inline attributes change and submit/accept/delete remain inline',()=>{
 for(const fn of ['openHelperRequestModal','closeHelperRequestModal','loadLessonsForDate','filterLessons','selectLesson','showHelperRequestConfirmation','showHelperRequestForm'])assert.equal(new RegExp('on(?:click|change|input)="'+fn+'\\(').test(app),false);
 assert.equal((app.match(/data-helper-prepare-action=/g)||[]).length,8);assert.equal((app.match(/data-helper-prepare-(?:date|search|link)(?:\s|>)/g)||[]).length,3);
 for(const fn of ['submitHelperRequest()','acceptHelperRequest(','deleteHelperRequest('])assert.ok(app.includes('onclick="'+fn));assert.equal(app.includes('Sample lesson - Student:'),false);assert.equal(app.includes('Sample - Student ${studentId}'),false);
});
