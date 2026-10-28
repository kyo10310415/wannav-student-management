import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/student-filter-events.js',import.meta.url),'utf8');
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];
 const root=parent=>({root:parent,contains(node){for(let n=node;n;n=n.root)if(n===this)return true;return false},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false}}});
 const elements={content:root()};elements['filter-modal']=root(elements.content);
 for(const id of ['filter-modal-title','filter-modal-content','filter-search-input'])elements[id]={root:elements['filter-modal'],value:'',innerHTML:'',textContent:'',focus(){}};
 const context={sessionToken:'synthetic-session',currentUser:{role:'admin'},currentPage:'students',document:{getElementById:id=>elements[id]||null,addEventListener:(type,cb)=>listeners.push({type,cb})}};
 for(const name of ['toggleSort','toggleFilter','toggleSurveyFilter','clearAllFilters','closeFilterModal','applyFilter','clearFilter','filterOptions','updateSearchInput'])context[name]=(...args)=>calls.push([name,...args]);
 vm.createContext(context);vm.runInContext(source,context);
 const node=(selector,dataset={},at=elements.content)=>{const n={root:at,dataset,disabled:false,checked:true};n.closest=s=>s===selector?n:null;return n};
 const button=(action,column,at=elements.content)=>node('button[data-student-filter-action]',{studentFilterAction:action,studentFilterColumn:column},at);
 const click=n=>context.handleStudentFilterClick({target:n});
 return{context,elements,calls,listeners,root,node,button,click};
}
function installReal(f){
 f.context.columnFilters={};f.context.sortColumn=null;f.context.sortDirection='asc';f.context.studentSearchQuery='synthetic';f.context.tutors=[{notion_name:'Synthetic notion'}];
 f.context.getTutorDisplayName=value=>value==='Synthetic notion'?'Synthetic display':value;
 f.context.getFilteredStudents=()=>[{name:'Synthetic <student>',homeroom_tutor:'Synthetic notion'}];
 f.context.renderApp=()=>f.calls.push(['render']);f.context.setTimeout=()=>{};
 f.context.escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 f.context.document.querySelector=()=>f.selected||null;
 f.context.document.querySelectorAll=()=>f.options||[];
 const start=app.indexOf('let currentFilterColumn = null;');const end=app.indexOf('// Calculate tutor\'s lesson progress status',start);
 vm.runInContext(app.slice(start,end),f.context);
 return code=>vm.runInContext(code,f.context);
}
test('student filter controls migrate local controls only and keep all fixed column actions',()=>{
 for(const name of ['toggleSort','toggleFilter','toggleSurveyFilter','clearAllFilters','closeFilterModal','applyFilter','clearFilter','filterOptions','updateSearchInput'])assert.equal(new RegExp('on(?:click|change|input)="'+name+'\\(').test(app),false);
 assert.ok(app.includes('data-student-filter-backdrop'));
 assert.ok(app.includes('onclick="resetTestRouletteResults()"'));
 assert.ok(app.includes('onclick="refreshData()"'));assert.ok(app.includes('onchange="updateProPlanStartDate('));
 const f=fixture();assert.deepEqual(f.listeners.map(l=>l.type),['click','input','change']);
 for(const col of ['student_id','name','status','contract_plan','character_name','homeroom_tutor','lesson_progress','lesson_start_date','continued_months','pro_plan_start_date','pro_plan_continued_months','result_overall','wanami_usage','result_absence'])f.click(f.button('sort',col));
 assert.equal(f.calls.length,14);
 for(const col of ['student_id','name','status','contract_plan','character_name','homeroom_tutor','result_overall'])f.click(f.button('open',col));assert.equal(f.calls.length,21);
 for(const col of ['__proto__','unknown','name;applyFilter()']){f.click(f.button('sort',col));f.click(f.button('open',col));}assert.equal(f.calls.length,21);
});
test('filter modal close/apply/clear are scoped; backdrop closes only on an exact target',()=>{
 const f=fixture();const modal=f.elements['filter-modal'];
 for(const action of ['close','apply','clear']){f.click(f.button(action));f.click(f.button(action,null,modal));}
 assert.deepEqual(f.calls,[['closeFilterModal'],['applyFilter'],['clearFilter']]);
 f.click(modal);assert.equal(f.calls.length,4);
 f.click(f.root(modal));assert.equal(f.calls.length,4);
 f.elements['filter-modal']=f.root(f.elements.content);f.click(modal);assert.equal(f.calls.length,4);
});
test('filter delegates reject missing authentication, roles, other pages, disabled and stale roots',()=>{
 const f=fixture();const event=()=>f.button('sort','name');
 const old=event();f.elements.content=f.root();f.click(old);
 const disabled=event();disabled.disabled=true;f.click(disabled);
 for(const role of ['unknown',null]){f.context.currentUser=role?{role}:null;f.click(event());}
 f.context.currentUser={role:'admin'};f.context.sessionToken='';f.click(event());f.context.sessionToken='synthetic';f.context.currentPage='reservations';f.click(event());
 assert.equal(f.calls.length,0);
 for(const role of ['crew','leader','admin']){f.context.currentUser={role};f.context.currentPage='students';f.click(event());}assert.equal(f.calls.length,3);
});
test('input and radio choice use current modal only and forward text without interpreting it',()=>{
 const f=fixture();const modal=f.elements['filter-modal'];const search=f.node('input[data-student-filter-search]',{},modal);
 f.context.handleStudentFilterInput({target:search});
 const choice=f.node('input[data-student-filter-choice]',{studentFilterChoice:'Synthetic "<&\' value'},modal);
 f.context.handleStudentFilterChoice({target:choice});choice.dataset.studentFilterChoice='';f.context.handleStudentFilterChoice({target:choice});
 assert.deepEqual(f.calls,[['filterOptions'],['updateSearchInput','Synthetic "<&\' value'],['updateSearchInput','']]);
 choice.checked=false;f.context.handleStudentFilterChoice({target:choice});search.disabled=true;f.context.handleStudentFilterInput({target:search});
 f.elements['filter-modal']=f.root(f.elements.content);choice.checked=true;f.context.handleStudentFilterChoice({target:choice});assert.equal(f.calls.length,3);
});
test('real sort toggles direction and clear-all preserves its existing local reset contract',()=>{
 const f=fixture();const run=installReal(f);
 f.click(f.button('sort','name'));assert.equal(f.context.sortColumn,'name');assert.equal(f.context.sortDirection,'asc');
 f.click(f.button('sort','name'));assert.equal(f.context.sortDirection,'desc');f.click(f.button('sort','student_id'));assert.equal(f.context.sortDirection,'asc');
 f.context.columnFilters={name:'Synthetic'};f.click(f.button('clear-all'));assert.deepEqual(JSON.parse(JSON.stringify(f.context.columnFilters)),{});assert.equal(f.context.sortColumn,null);assert.equal(f.context.studentSearchQuery,'');assert.equal(f.calls.length,4);assert.equal(run('currentFilterColumn'),null);
});
test('real filter rendering escapes quotes and markup in current input, option data, value and label',()=>{
 const f=fixture();const run=installReal(f);const special='Synthetic " data-x="<&\' student';f.context.columnFilters={name:special};f.context.getFilteredStudents=()=>[{name:special}];
 f.click(f.button('open','name'));
 const html=f.elements['filter-modal-content'].innerHTML;const escaped='Synthetic &quot; data-x=&quot;&lt;&amp;\' student';
 assert.ok(html.includes('value="'+escaped+'"'));assert.ok(html.includes('data-filter-option="'+escaped+'"'));assert.ok(html.includes('data-student-filter-choice="'+escaped+'"'));
 assert.ok(html.includes('Synthetic " data-x="&lt;&amp;\' student</span>'));
 assert.equal(html.includes('onchange='),false);assert.equal(html.includes('oninput='),false);assert.equal(f.context.columnFilters.name,special);assert.equal(run('currentFilterColumn'),'name');
});
test('real apply/clear preserves typed-text preference and Tutor display-to-Notion mapping',()=>{
 const f=fixture();const run=installReal(f);const modal=f.elements['filter-modal'];
 f.click(f.button('open','name'));f.elements['filter-search-input'].value=' Synthetic typed ';f.selected={value:'Synthetic radio'};f.click(f.button('apply',null,modal));assert.equal(f.context.columnFilters.name,'Synthetic typed');assert.equal(run('currentFilterColumn'),null);
 f.click(f.button('open','homeroom_tutor'));f.elements['filter-search-input'].value='Synthetic display';f.click(f.button('apply',null,modal));assert.equal(f.context.columnFilters.homeroom_tutor,'Synthetic notion');
 f.click(f.button('open','name'));f.elements['filter-search-input'].value='';f.selected={value:'all'};f.click(f.button('apply',null,modal));assert.equal(f.context.columnFilters.name,undefined);
 f.click(f.button('open','homeroom_tutor'));f.click(f.button('clear',null,modal));assert.equal(f.context.columnFilters.homeroom_tutor,undefined);
});
test('real filter-options and choice update stay local and preserve case-insensitive matching',()=>{
 const f=fixture();installReal(f);f.context.document.querySelectorAll=()=>f.options;f.options=['Synthetic Alpha','Synthetic beta'].map(text=>({getAttribute:()=>text,style:{}}));
 f.elements['filter-search-input'].value=' ALPHA ';f.context.filterOptions();assert.equal(f.options[0].style.display,'');assert.equal(f.options[1].style.display,'none');f.context.updateSearchInput('Synthetic text');assert.equal(f.elements['filter-search-input'].value,'Synthetic text');
});
