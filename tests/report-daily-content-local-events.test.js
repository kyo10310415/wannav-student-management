import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const names=['lesson-report-prepare-events','daily-history-events','content-local-events'];const sources=await Promise.all(names.map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
function fixture(){
 const calls=[],requests=[],listeners=[],forms=[],logs=[];const elements={};
 const root=parent=>({root:parent,innerHTML:'',textContent:'',value:'',disabled:false,required:false,focused:false,contains(n){for(let p=n;p;p=p.root)if(p===this)return true;return false},classList:{values:new Set(['hidden']),add(v){this.values.add(v)},remove(v){this.values.delete(v)},contains(v){return this.values.has(v)}},focus(){this.focused=true},remove(){this.removed=true},addEventListener(type,callback){forms.push({type,callback})}});
 elements.content=root();for(const id of ['lessonReportModal','dailyReportHistoryModal','lc-add-form'])elements[id]=root(elements.content);
 for(const id of ['lessonResult','lessonNumber','proFields','proCurriculum','proTextNumber','lessonReportForm'])elements[id]=root(elements.lessonReportModal);
 for(const id of ['drHistoryTitle','drHistoryBody','drHistoryPager'])elements[id]=root(elements.dailyReportHistoryModal);
 elements['lc-new-number']=root(elements['lc-add-form']);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'today',dailyReportTutors:[{tutor_id:7,tutor_name:'Synthetic own'},{tutor_id:8,tutor_name:'Synthetic other'}],dailyReportViewTutorId:null,lessonContentsCache:[{lesson_number:'1'},{lesson_number:'Pro_動画_1'}],lessonReportStatus:{},document:{getElementById:id=>elements[id]?.removed?null:elements[id],createElement:()=>{const el=root();Object.defineProperty(el,'id',{set(value){elements[value]=el}});return el},body:{appendChild(el){for(const id of ['lessonResult','lessonNumber','proFields','proCurriculum','proTextNumber','lessonReportForm'])elements[id].root=el}},addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),axios:{get:async(...args)=>{requests.push(args);return{data:{success:true,data:[],total:12,offset:0}}}}};
 for(const fn of ['showLessonReportModal','closeLessonReportModal','toggleProFields','openDailyReportHistory','closeDailyReportHistory','loadDailyReportHistory','showAddLessonContentForm','editLessonContent','cancelEditLessonContent'])c[fn]=(...args)=>calls.push([fn,...args]);
 vm.createContext(c);sources.forEach(source=>vm.runInContext(source,c));
 const node=(selector,dataset={},at=elements.content)=>{const n={root:at,dataset,disabled:false};n.closest=s=>s===selector?n:null;return n};const install=(start,end)=>{const i=app.indexOf(start),j=app.indexOf(end,i);assert.ok(i>=0&&j>i);vm.runInContext(app.slice(i,j),c)};
 return{c,elements,calls,requests,listeners,forms,logs,root,node,install};
}
test('report modal preparation preserves exact fields, own modal close and PRO toggle without save',()=>{
 const f=fixture();const data={reportPrepareAction:'open',reportStudentId:'SYNTHETIC',reportDate:'2026-10-28',reportStudentName:'Synthetic "<Student>',reportTutorName:'Synthetic Tutor'};
 f.c.handleReportPrepareClick({target:f.node('button[data-report-prepare-action]',data)});
 f.c.handleReportPrepareClick({target:f.node('button[data-report-prepare-action]',{reportPrepareAction:'close'},f.elements.lessonReportModal)});
 f.c.handleReportProChange({target:f.node('select[data-report-pro-fields]',{},f.elements.lessonReportModal)});
 assert.deepEqual(f.calls,[['showLessonReportModal','SYNTHETIC','2026-10-28','Synthetic "<Student>','Synthetic Tutor'],['closeLessonReportModal'],['toggleProFields']]);assert.equal(f.requests.length,0);
});
test('real report renderer restores existing PRO values, required fields and keeps submit listener unexecuted',()=>{
 const f=fixture();f.install('function showLessonReportModal(', 'async function submitLessonReport(');f.c.lessonReportStatus={'SYNTHETIC-2026-10-28':{lesson_result:'実施済み',lesson_number:'PROプラン',pro_curriculum:'Synthetic',pro_text_number:'2'}};
 f.c.showLessonReportModal('SYNTHETIC','2026-10-28','Synthetic <Student>','Synthetic <Tutor>');
 assert.ok(f.elements.lessonReportModal.innerHTML.includes('Synthetic &lt;Student&gt;'));assert.equal(f.elements.lessonNumber.value,'PROプラン');assert.equal(f.elements.proCurriculum.required,true);assert.equal(f.elements.proTextNumber.value,'2');assert.equal(f.forms.filter(x=>x.type==='submit').length,1);
 f.elements.lessonNumber.value='1';f.c.handleReportProChange({target:Object.assign(f.elements.lessonNumber,{closest:()=>f.elements.lessonNumber})});assert.equal(f.elements.proCurriculum.required,false);assert.equal(f.elements.proCurriculum.value,'');assert.equal(f.elements.proTextNumber.value,'');assert.equal(f.requests.length,0);
});
test('both report entry variants encode argument quotes instead of code interpolation',()=>{
 const f=fixture();f.install('function getLessonReportButton(', 'function renderTodayStudentRows');
 for(const existing of [false,true]){f.c.lessonReportStatus={'SYNTHETIC-2026-10-28':existing};const html=f.c.getLessonReportButton('SYNTHETIC','2026-10-28','Synthetic" <name>','Synthetic" <Tutor>');assert.ok(html.includes('data-report-student-name="Synthetic&quot; &lt;name&gt;"'));assert.equal(html.includes('onclick='),false);}
 assert.equal(f.logs.length,0);
});
test('daily history allows managers and only crew rows matching the existing displayed owner mapping',()=>{
 const f=fixture();f.c.currentPage='daily-reports';const open=id=>f.c.handleDailyHistoryClick({target:f.node('button[data-daily-history-action]',{dailyHistoryAction:'open',dailyTutorId:String(id),dailyTutorName:'Synthetic'})});
 f.c.currentUser={role:'crew',tutorName:'Synthetic own',email:'synthetic@example.invalid'};open(7);open(8);f.c.currentUser={role:'leader'};open(8);assert.deepEqual(f.calls,[['openDailyReportHistory',7,'Synthetic'],['openDailyReportHistory',8,'Synthetic']]);
 f.c.currentUser={role:'crew',email:'Synthetic own'};open(7);assert.equal(f.calls.length,3);
});
test('daily pagination validates selected tutor/offset, disabled state and modal scope',()=>{
 const f=fixture();f.c.currentPage='daily-reports';f.c.dailyReportViewTutorId=7;
 const node=(id,offset,at=f.elements.dailyReportHistoryModal)=>f.node('button[data-daily-history-action]',{dailyHistoryAction:'page',dailyTutorId:id,dailyOffset:offset},at);
 f.c.handleDailyHistoryClick({target:node('7','5')});for(const offset of ['-1','1.5','2e2','9007199254740992',''])f.c.handleDailyHistoryClick({target:node('7',offset)});
 f.c.handleDailyHistoryClick({target:node('8','5')});f.c.handleDailyHistoryClick({target:node('7','5',f.elements.content)});const disabled=node('7','0');disabled.disabled=true;f.c.handleDailyHistoryClick({target:disabled});
 assert.deepEqual(f.calls,[['loadDailyReportHistory',7,5]]);
});
test('real daily read keeps page size/query, escaped title, close reset and pager boundaries',async()=>{
 const f=fixture();f.c.currentPage='daily-reports';f.install('const DR_PAGE_SIZE = 5;','function _renderDailyReportHistoryBody()');f.c._renderDailyReportHistoryBody=()=>{};f.c._renderDailyReportHistoryPager=()=>{};
 await f.c.openDailyReportHistory(7,'Synthetic <Tutor>');assert.equal(f.requests[0][0],'/api/daily-reports/tutor/7');assert.equal(f.requests[0][1].params.limit,5);assert.equal(f.requests[0][1].params.offset,0);assert.ok(f.elements.drHistoryTitle.innerHTML.includes('Synthetic &lt;Tutor&gt;'));
 f.install('function _renderDailyReportHistoryPager()', '// ─── コメント');
 f.c._renderDailyReportHistoryPager();assert.match(f.elements.drHistoryPager.innerHTML,/data-daily-offset="0"\s+disabled/);assert.match(f.elements.drHistoryPager.innerHTML,/data-daily-offset="5"/);
 f.c.closeDailyReportHistory();assert.equal(f.c.dailyReportViewTutorId,null);assert.equal(f.c.dailyReportHistory,null);
});
test('content local editing supports numeric and registered PRO keys and makes no API calls',()=>{
 const f=fixture();f.c.currentPage='lesson-contents';for(const key of ['1','Pro_動画_1']){f.elements['lc-view-'+key]=f.root(f.elements.content);f.elements['lc-edit-'+key]=f.root(f.elements.content)}
 f.install('function showAddLessonContentForm()', 'async function loadLessonContents()');f.install('function editLessonContent(num)', 'async function saveLessonContent(num)');
 const click=(action,key)=>f.c.handleContentLocalClick({target:f.node('button[data-content-local-action]',{contentLocalAction:action,lessonNumber:key})});
 click('show-add');assert.equal(f.elements['lc-new-number'].focused,true);click('hide-add');assert.equal(f.elements['lc-add-form'].classList.contains('hidden'),true);
 for(const key of ['1','Pro_動画_1']){click('edit',key);assert.equal(f.elements['lc-view-'+key].classList.contains('hidden'),true);click('cancel',key);assert.equal(f.elements['lc-view-'+key].classList.contains('hidden'),false)}
 click('edit','not-registered');assert.equal(f.requests.length,0);
});
test('all local delegates reject stale roots, disabled, wrong pages and missing authentication',()=>{
 const f=fixture();const cases=[['today','button[data-report-prepare-action]',{reportPrepareAction:'open',reportStudentId:'SYNTHETIC',reportDate:'2026-10-28'},'handleReportPrepareClick'],['daily-reports','button[data-daily-history-action]',{dailyHistoryAction:'open',dailyTutorId:'7'},'handleDailyHistoryClick'],['lesson-contents','button[data-content-local-action]',{contentLocalAction:'show-add'},'handleContentLocalClick']];
 for(const[page,selector,data,handler]of cases){f.c.currentPage=page;const old=f.node(selector,data);f.elements.content=f.root();f.c[handler]({target:old});const n=f.node(selector,data);n.disabled=true;f.c[handler]({target:n});n.disabled=false;f.c.sessionToken='';f.c[handler]({target:n});f.c.sessionToken='synthetic';f.c.currentUser=null;f.c[handler]({target:n});f.c.currentUser={role:'admin'};f.c.currentPage='other';f.c[handler]({target:n});}
 f.c.currentUser={role:'crew'};f.c.currentPage='lesson-contents';f.c.handleContentLocalClick({target:f.node('button[data-content-local-action]',{contentLocalAction:'show-add'})});assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
});
test('targeted inline handlers disappear while submit and persistence controls remain',async()=>{
 for(const fn of ['showLessonReportModal','closeLessonReportModal','toggleProFields','openDailyReportHistory','closeDailyReportHistory','loadDailyReportHistory','showAddLessonContentForm','editLessonContent','cancelEditLessonContent'])assert.equal(new RegExp('on(?:click|change)="'+fn+'\\(').test(app),false);
 for(const fn of ['submitDailyReport()','addLessonContent()','saveLessonContent(this.dataset.lessonNumber)','deleteLessonContent(this.dataset.lessonNumber)'])assert.ok(app.includes('onclick="'+fn+'"'));
 const index=await readFile(new URL('../src/index.js',import.meta.url),'utf8');for(const name of [...names,'helper-prepare-events','handover-read-events']){const marker='<script src="/'+name+'.js?v=';assert.equal(index.split(marker).length-1,1);assert.ok(index.indexOf(marker)>index.indexOf('<script src="/app.js'));}
});

test('real content edit markup keeps quote-like titles and lesson keys inside attributes',()=>{
 const f=fixture();f.elements['lc-list-container']=f.root(f.elements.content);f.c.lessonContentsCache=[{lesson_number:'Pro_動画_1',title:'Synthetic" autofocus data-injected="<&',content:'Synthetic <content>'}];
 f.install('function renderLessonContentsList()', 'function editLessonContent(num)');f.c.renderLessonContentsList();const html=f.elements['lc-list-container'].innerHTML;
 assert.ok(html.includes('value="Synthetic&quot; autofocus data-injected=&quot;&lt;&amp;"'));assert.ok(html.includes('data-lesson-number="Pro_動画_1" data-content-local-action="edit"'));assert.ok(html.includes('Synthetic &lt;content&gt;'));
});

test('daily history failure prints no raw error object and retains the failure state',async()=>{
 const f=fixture();f.install('const DR_PAGE_SIZE = 5;', 'function _renderDailyReportHistoryBody()');f.c.axios.get=async()=>{throw Error('Synthetic private details')};
 f.c.currentPage='daily-reports';f.c.dailyReportViewTutorId=7;f.elements.dailyReportHistoryModal.classList.remove('hidden');
 await f.c.loadDailyReportHistory(7,5);assert.deepEqual(f.logs,[['[DailyReports] load history error']]);assert.ok(f.elements.drHistoryBody.innerHTML.includes('読み込みに失敗しました'));
});
