import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/minutes-read-events.js',import.meta.url),'utf8');
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],requests=[],listeners=[];
 const root=parent=>({root:parent,disabled:false,innerHTML:'',textContent:'',value:'',contains(n){for(let at=n;at;at=at.root)if(at===this)return true;return false},classList:{values:new Set(['hidden']),add(value){this.values.add(value)},remove(value){this.values.delete(value)},toggle(value,force){if(force===undefined)force=!this.values.has(value);if(force)this.values.add(value);else this.values.delete(value)}}});
 const elements={content:root()};elements['minutes-detail-modal']=root(elements.content);
 for(const id of ['minutes-modal-title','minutes-modal-text','minutes-detail-panel-text','minutes-detail-panel-quality','minutes-modal-save-btn','minutes-detail-tab-text','minutes-detail-tab-quality'])elements[id]=root(elements['minutes-detail-modal']);
 for(const id of ['minutes-student-input','minutes-student-results','minutes-list-container'])elements[id]=root(elements.content);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'minutes',minutesCurrentStudentId:'old-student',minutesCurrentStudentName:'Old synthetic',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log(){},error(){}},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),formatMinutesLessonNumber:value=>String(value),showNotification:()=>calls.push(['notice']),axios:{get:async(...args)=>{requests.push(args);return {data:{data:{lesson_date:'2026-10-28',generated_text:'Synthetic text',quality_evaluation:{synthetic:true}}}}}},renderMinutesQualityEvaluation:value=>calls.push(['quality',value])};
 for(const name of ['openMinutesForStudent','minutesSearchStudent','renderMinutesPage','changePage','openMinutesDetail','switchMinutesDetailTab','closeMinutesModal'])c[name]=(...args)=>calls.push([name,...args]);
 vm.createContext(c);vm.runInContext(source,c);
 const control=(action,data={},at=elements.content)=>{const n={root:at,disabled:false,dataset:{minutesReadAction:action,...data}};n.closest=s=>s==='[data-minutes-read-action]'?n:null;return n};
 const click=(n,nested=false)=>c.handleMinutesReadClick({target:nested?{closest:()=>n}:n});
 const install=(start,end)=>vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start))),c);
 return{c,calls,requests,listeners,elements,root,control,click,install};
}
test('minutes migrates exactly fifteen read controls and leaves writes/templates unchanged',()=>{
 assert.equal((app.match(/data-minutes-read-action=/g)||[]).length,15);
 for(const old of ['onclick="openMinutesForStudent(','onclick="minutesSearchStudent()"','onclick="closeMinutesModal()"','onclick="switchMinutesDetailTab(','onclick="openMinutesDetail(','onclick="event.stopPropagation(); openMinutesDetail('])assert.equal(app.includes(old),false);
 for(const write of ['onclick="generateMinutes()"','onclick="startMinutesBackfillFromPage()"','onclick="saveMinutesEdit()"','data-minutes-template-action="open"','onclick="event.stopPropagation(); deleteMinutes(${m.id})"'])assert.ok(app.includes(write));
});
test('student entry preserves exact data only on existing source pages and requires managers',async()=>{
 for(const page of ['students','reservations','today']){
  const f=fixture();f.c.currentPage=page;const id='Synthetic "<& student',name='Synthetic "<& name';await f.click(f.control('open-student',{minutesStudentId:id,minutesStudentName:name}),true);assert.deepEqual(f.calls,[['openMinutesForStudent',id,name]]);
 }
 const f=fixture();await f.click(f.control('open-student',{minutesStudentId:'synthetic'}));f.c.currentPage='students';for(const role of ['crew','unknown']){f.c.currentUser={role};await f.click(f.control('open-student',{minutesStudentId:'synthetic'}));}assert.equal(f.calls.length,0);
});
test('fixed search/all/back/student actions maintain state resets and fire only once for nested controls',async()=>{
 const f=fixture();assert.equal(f.listeners.length,1);assert.equal(f.listeners[0].type,'click');
 await f.click(f.control('search'),true);await f.click(f.control('all-students'));assert.equal(f.c.minutesCurrentStudentId,null);assert.equal(f.c.minutesCurrentStudentName,null);
 await f.click(f.control('select-student',{minutesStudentId:'Synthetic "<id>',minutesStudentName:'Synthetic "<name>'}),true);assert.equal(f.c.minutesCurrentStudentId,'Synthetic "<id>');assert.equal(f.c.minutesCurrentStudentName,'Synthetic "<name>');
 await f.click(f.control('back-students'));assert.deepEqual(f.calls,[['minutesSearchStudent'],['renderMinutesPage'],['renderMinutesPage'],['changePage','students']]);
});
test('detail row/nested button dispatch once and numeric IDs reject executable or unsafe values',async()=>{
 const f=fixture();for(const id of ['1','27'])await f.click(f.control('detail',{minutesId:id}),true);assert.deepEqual(f.calls,[['openMinutesDetail',1],['openMinutesDetail',27]]);
 for(const id of ['', '0','-1','1.5','2e2',' 1','1 ','9007199254740992','1;deleteMinutes(1)'])await f.click(f.control('detail',{minutesId:id}));
 for(const action of ['__proto__','constructor','delete','generate','save','unknown'])await f.click(f.control(action,{minutesId:'1'}));assert.equal(f.calls.length,2);
});
test('tab and close are restricted to current detail modal while stale roots/disabled/auth changes reject reads',async()=>{
 const f=fixture();const modal=f.elements['minutes-detail-modal'];await f.click(f.control('detail-tab',{minutesTab:'text'},modal));await f.click(f.control('detail-tab',{minutesTab:'quality'},modal));await f.click(f.control('close-detail',{},modal));
 await f.click(f.control('detail-tab',{minutesTab:'text'}));await f.click(f.control('close-detail'));await f.click(f.control('detail-tab',{minutesTab:'unknown'},modal));
 const old=f.control('search');f.elements.content=f.root();await f.click(old);const disabled=f.control('search');disabled.disabled=true;await f.click(disabled);
 for(const user of [null,{role:'crew'},{role:'unknown'}]){f.c.currentUser=user;await f.click(f.control('search'));}f.c.currentUser={role:'admin'};f.c.sessionToken='';await f.click(f.control('search'));f.c.sessionToken='synthetic';f.c.currentPage='students';await f.click(f.control('search'));
 assert.deepEqual(f.calls,[['switchMinutesDetailTab','text'],['switchMinutesDetailTab','quality'],['closeMinutesModal']]);
});
test('real student entry retains changePage and cached search returns escaped selection data',async()=>{
 const f=fixture();f.install('async function openMinutesForStudent(studentId, studentName)','async function renderMinutesPage()');f.c.currentPage='students';await f.click(f.control('open-student',{minutesStudentId:'S1',minutesStudentName:'Synthetic'}));assert.deepEqual(f.calls,[['changePage','minutes']]);assert.equal(f.c.minutesCurrentStudentId,'S1');
 f.c.currentPage='minutes';f.c.students=[{student_id:'Synthetic"<id>',name:'Synthetic"<name>'}];f.elements['minutes-student-input'].value='  Synthetic  ';
 f.install('async function minutesSearchStudent()', '// ═══════════════════════════════════════════════════════════════');await f.click(f.control('search'));
 const html=f.elements['minutes-student-results'].innerHTML;assert.ok(html.includes('data-minutes-student-id="Synthetic&quot;&lt;id&gt;"'));assert.ok(html.includes('data-minutes-student-name="Synthetic&quot;&lt;name&gt;"'));assert.equal(f.requests.length,0);
 f.elements['minutes-student-input'].value='missing';await f.click(f.control('search'));assert.ok(f.elements['minutes-student-results'].innerHTML.includes('該当する生徒が見つかりません'));
});
test('real list keeps detail/student separation, escapes attributes and leaves delete stopPropagation in place',()=>{
 const f=fixture();f.c.minutesCurrentStudentId=null;f.c.minutesListCache=[{id:27,student_id:'Synthetic"<id>',student_name:'Synthetic"<name>',lesson_date:'2026-10-28',preview:'Synthetic line'}];
 f.install('function renderMinutesList()', 'let minutesEditingId = null;');f.c.renderMinutesList();const html=f.elements['minutes-list-container'].innerHTML;
 assert.equal((html.match(/data-minutes-read-action="detail"/g)||[]).length,2);assert.equal((html.match(/data-minutes-read-action="select-student"/g)||[]).length,1);assert.ok(html.includes('data-minutes-student-name="Synthetic&quot;&lt;name&gt;"'));assert.ok(html.includes('onclick="event.stopPropagation(); deleteMinutes(27)"'));
 f.c.minutesListCache=[];f.c.renderMinutesList();assert.ok(f.elements['minutes-list-container'].innerHTML.includes('議事録がありません'));
});
test('real detail uses GET only and saved-quality tab toggles text/save visibility without AI',async()=>{
 const f=fixture();f.install('async function openMinutesDetail(id)', 'function parseMinutesQualityEvaluation(evaluation)');await f.click(f.control('detail',{minutesId:'27'}));
 assert.equal(f.requests.length,1);assert.equal(f.requests[0][0],'/api/minutes/detail/27');assert.equal(f.requests[0][1].headers.Authorization,'Bearer synthetic');assert.equal(f.elements['minutes-modal-text'].value,'Synthetic text');assert.equal(f.elements['minutes-detail-modal'].classList.values.has('hidden'),false);
 await f.click(f.control('detail-tab',{minutesTab:'quality'},f.elements['minutes-detail-modal']));assert.equal(f.elements['minutes-modal-save-btn'].classList.values.has('hidden'),true);assert.equal(f.elements['minutes-detail-panel-text'].classList.values.has('hidden'),true);
 await f.click(f.control('detail-tab',{minutesTab:'text'},f.elements['minutes-detail-modal']));assert.equal(f.elements['minutes-modal-save-btn'].classList.values.has('hidden'),false);assert.equal(f.requests.length,1);
 await f.click(f.control('close-detail',{},f.elements['minutes-detail-modal']));assert.equal(f.elements['minutes-detail-modal'].classList.values.has('hidden'),true);assert.equal(vm.runInContext('minutesEditingId',f.c),null);
});
