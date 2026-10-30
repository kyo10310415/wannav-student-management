import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/student-search-events.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];const root=()=>({contains(n){return n.root===this}});
 const elements={content:root(),'student-search-reservations':{value:'synthetic'}};
 const c={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'reservations',studentSearchQuery:'synthetic',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},changeMonth:async delta=>calls.push(['month',delta]),switchTab:tab=>calls.push(['status',tab]),switchActiveSubTab:tab=>calls.push(['plan',tab]),renderStudentTable:()=>calls.push(['table']),renderStudentsCards:()=>calls.push(['cards']),renderStudentsPage:()=>calls.push(['students-page'])};
 vm.createContext(c);vm.runInContext(source,c);
 const button=(action,data={},at=elements.content)=>{const n={root:at,disabled:false,dataset:{studentViewAction:action,...data}};n.closest=s=>s==='button[data-student-view-action]'?n:null;return n};
 const input=(view,value,at=elements.content)=>{const n={root:at,disabled:false,dataset:{studentSearchView:view},value};n.closest=s=>s==='input[data-student-search-view]'?n:null;return n};
 const click=(node,nested=false)=>c.handleStudentViewClick({target:nested?{closest:()=>node}:node});
 return {c,calls,listeners,elements,root,button,input,click};
}
test('twenty student search/month/status/plan attributes migrate while unrelated write actions remain',()=>{
 for(const old of ['onclick="changeMonth(','onclick="switchTab(','onclick="switchActiveSubTab(','oninput="studentSearchQuery=','onclick="studentSearchQuery='])assert.equal(appSource.includes(old),false);
 assert.equal((appSource.match(/data-student-view-action=/g)||[]).length,18);
 assert.equal((appSource.match(/data-student-search-view=/g)||[]).length,4);
 assert.equal((appSource.match(/value="\$\{escapeHtml\(studentSearchQuery\)\.replace\(/g)||[]).length,2);
 for(const old of ['onclick="resetTestRouletteResults()"','onclick="sendReminders()"','onclick="refreshData()"'])assert.ok(appSource.includes(old));
});
test('fixed actions preserve exact status/plan choices and use fixed month deltas on reservations only',async()=>{
 const f=fixture();assert.deepEqual(f.listeners.map(l=>l.type),['click','input']);
 await f.click(f.button('previous-month'),true);await f.click(f.button('next-month'));
 for(const studentStatus of ['active','preparing','suspended','graduated','cancelled'])await f.click(f.button('status-tab',{studentStatus}));
 for(const studentPlan of ['lesson','pro','permanent','enrolled'])await f.click(f.button('active-tab',{studentPlan}));
 f.c.currentPage='students';await f.click(f.button('previous-month'));await f.click(f.button('next-month'));
 assert.deepEqual(f.calls,[['month',-1],['month',1],...['active','preparing','suspended','graduated','cancelled'].map(v=>['status',v]),...['lesson','pro','permanent','enrolled'].map(v=>['plan',v])]);
 for(const key of ['unknown','__proto__','constructor',"active');sendReminders()"]){await f.click(f.button(key));await f.click(f.button('status-tab',{studentStatus:key}));await f.click(f.button('active-tab',{studentPlan:key}));}
 assert.equal(f.calls.length,11);
});
test('query input and clear preserve their separate table/card/page render contracts and exact text',()=>{
 const f=fixture();const text='  Synthetic <query> & " value  ';
 f.c.handleStudentSearchInput({target:f.input('reservations',text)});
 assert.equal(f.c.studentSearchQuery,text);assert.deepEqual(f.calls,[['table']]);
 f.click(f.button('clear-search',{studentSearchView:'reservations'}));assert.equal(f.c.studentSearchQuery,'');assert.equal(f.elements['student-search-reservations'].value,'');
 f.c.currentPage='students';f.c.handleStudentSearchInput({target:f.input('students',text)});assert.equal(f.c.studentSearchQuery,text);
 f.click(f.button('clear-search',{studentSearchView:'students'}));assert.equal(f.c.studentSearchQuery,'');
 assert.deepEqual(f.calls,[['table'],['table'],['cards'],['students-page']]);
 f.c.handleStudentSearchInput({target:f.input('reservations','wrong view')});f.click(f.button('clear-search',{studentSearchView:'reservations'}));assert.equal(f.calls.length,4);
});
test('all known roles retain view controls, unknown roles and missing auth are refused',()=>{
 const f=fixture();
 for(const role of ['admin','leader','crew']){f.c.currentUser={role};f.click(f.button('status-tab',{studentStatus:'active'}));f.c.handleStudentSearchInput({target:f.input('reservations','synthetic')});}
 assert.equal(f.calls.length,6);
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.click(f.button('status-tab',{studentStatus:'active'}));f.c.handleStudentSearchInput({target:f.input('reservations','blocked')});}
 f.c.currentUser={role:'admin'};f.c.sessionToken='';f.click(f.button('next-month'));f.c.handleStudentSearchInput({target:f.input('reservations','blocked')});
 f.c.sessionToken='synthetic';f.c.currentPage='today';f.click(f.button('next-month'));f.c.handleStudentSearchInput({target:f.input('reservations','blocked')});assert.equal(f.calls.length,6);
});
test('disabled, outside and stale controls are refused while replacement content receives one event',()=>{
 const f=fixture();const old=f.button('next-month'),oldInput=f.input('reservations','old');f.elements.content=f.root();
 f.click(old);f.c.handleStudentSearchInput({target:oldInput});
 const disabled=f.button('next-month');disabled.disabled=true;f.click(disabled);
 const disabledInput=f.input('reservations','disabled');disabledInput.disabled=true;f.c.handleStudentSearchInput({target:disabledInput});
 f.click(f.button('next-month',{},f.root()));f.c.handleStudentSearchInput({target:f.input('reservations','outside',f.root())});
 f.c.handleStudentViewClick({target:{}});f.c.handleStudentSearchInput({target:{}});assert.equal(f.calls.length,0);
 f.click(f.button('next-month'),true);assert.deepEqual(f.calls,[['month',1]]);assert.equal(f.listeners.length,2);
});
test('real status and plan functions preserve active default reset and one app render each',()=>{
 const f=fixture();let renders=0;f.c.renderApp=()=>renders++;f.c.currentTab='suspended';f.c.activeSubTab='pro';
 const start=appSource.indexOf('function switchTab(tab)');const end=appSource.indexOf('// Get lesson count color class',start);vm.runInContext(appSource.slice(start,end),f.c);
 f.click(f.button('status-tab',{studentStatus:'active'}));assert.equal(f.c.currentTab,'active');assert.equal(f.c.activeSubTab,'lesson');
 f.click(f.button('active-tab',{studentPlan:'permanent'}));assert.equal(f.c.activeSubTab,'permanent');
 f.click(f.button('status-tab',{studentStatus:'graduated'}));assert.equal(f.c.currentTab,'graduated');assert.equal(f.c.activeSubTab,'permanent');assert.equal(renders,3);
});
test('real reservation month navigation preserves year boundary, load order and render without writes',async()=>{
 const f=fixture();f.c.currentMonth=new Date(2026,0,15);f.elements['current-month-display']={textContent:''};
 f.c.formatMonth=date=>date.getFullYear()+'-'+(date.getMonth()+1);f.c.loadLessonStats=async()=>f.calls.push(['stats']);f.c.loadLessonDates=async()=>f.calls.push(['dates']);f.c.renderApp=()=>f.calls.push(['render']);
 const start=appSource.indexOf('async function changeMonth(delta)');const end=appSource.indexOf('// Filter by tutor',start);vm.runInContext(appSource.slice(appSource.indexOf('const lessonMonthReadStates ='),appSource.indexOf('// Load lesson statistics.'))+'\n'+appSource.slice(start,end),f.c);
 await f.click(f.button('previous-month'));assert.equal(f.c.currentMonth.getFullYear(),2025);assert.equal(f.c.currentMonth.getMonth(),11);assert.equal(f.c.currentMonth.getDate(),1);assert.equal(f.elements['current-month-display'].textContent,'2025-12');
 assert.deepEqual(f.calls,[['stats'],['dates'],['render']]);
});


test('both real search value templates encode attribute-breaking quotes',()=>{
 const query='Synthetic" autofocus data-injected="<&';
 const c={studentSearchQuery:query,escapeHtml:value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};vm.createContext(c);
 const matches=[...appSource.matchAll(/value="(\$\{escapeHtml\(studentSearchQuery\).*?\})"/g)];assert.equal(matches.length,2);
 for(const match of matches){const encoded=vm.runInContext('`'+match[1]+'`',c);assert.equal(encoded,'Synthetic&quot; autofocus data-injected=&quot;&lt;&amp;');assert.equal(encoded.includes('"'),false);}
});
