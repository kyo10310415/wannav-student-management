import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const pro=source.slice(source.indexOf('const proPlanPendingWrites ='),source.indexOf('// Format month',source.indexOf('const proPlanPendingWrites =')));
const wanami=source.slice(source.indexOf('let wanamiBatchReadGeneration ='),source.indexOf('// Show Wanami usage history modal'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(){
 const calls=[],alerts=[],errors=[],renders=[],input={value:'2026-10',disabled:false,dataset:{studentProPlanId:'fixture/id'}},student={student_id:'fixture/id',homeroom_tutor:'fixture tutor',pro_plan_start_date:'2026-09-01',pro_plan_continued_months:2};
 const cells=[{dataset:{studentId:student.student_id},innerHTML:'loading',textContent:'',classList:{remove(){}}}];
 const root={contains:n=>n===input||cells.includes(n),querySelectorAll:()=>cells},elements={content:root};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'crew'},currentPage:'students',document:{getElementById:id=>elements[id]},getFilteredStudents:()=>[student],API_BASE:'',confirm:()=>true,formatDateForMonthInput:v=>v.slice(0,7),showAlert:(...args)=>alerts.push(args),renderStudentsPage:()=>renders.push('students'),console:{error:m=>errors.push(m)},escapeHtml:esc};
 c.axios={patch:(...args)=>send('patch',args),get:(...args)=>send('get',args)};
 function send(method,args){const d=deferred();calls.push({method,args,...d});return d.promise;}
 vm.createContext(c);vm.runInContext(pro+'\n'+wanami,c);return{c,calls,alerts,errors,renders,input,student,cells,root,elements};
}
const updated=(id='fixture/id',date='2026-10-01')=>({data:{success:true,data:{student_id:id,pro_plan_start_date:date,pro_plan_continued_months:1}}});
test('PRO normal crew without notion_name preserves canonical fields and never calls whole sync',async()=>{
 const f=fixture();f.c.refreshData=()=>{throw Error('Must not sync')};const p=f.c.updateProPlanStartDate(f.student.student_id,f.input.value,f.input);assert.equal(f.input.disabled,true);assert.equal(f.calls[0].args[0],'/api/students/fixture%2Fid/pro-plan');assert.equal(f.calls[0].args[1].proPlanStartDate,'2026-10-01');assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer fixture-token');f.calls[0].resolve(updated());await p;assert.equal(f.student.pro_plan_start_date,'2026-10-01');assert.equal(f.student.pro_plan_continued_months,1);assert.deepEqual(f.renders,['students']);assert.equal(f.input.disabled,false);
});
test('PRO duplicate writes suppressed and stale completion never updates another state',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='reservations',f=>f.elements.content={},f=>f.c.getFilteredStudents=()=>[],f=>f.input.value='2026-11',f=>f.input.dataset.studentProPlanId='other',f=>f.student.homeroom_tutor='other',f=>f.student.pro_plan_start_date='2026-08-01'];
 for(const change of changes)for(const failure of [false,true]){const f=fixture(),p=f.c.updateProPlanStartDate(f.student.student_id,f.input.value,f.input);await f.c.updateProPlanStartDate(f.student.student_id,f.input.value,f.input);assert.equal(f.calls.length,1);change(f);const before=f.student.pro_plan_start_date;if(failure)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(updated());await p;assert.equal(f.student.pro_plan_start_date,before);assert.equal(f.alerts.length,0);assert.equal(f.errors.length,0);assert.equal(f.renders.length,0);}
});
test('PRO clear cancellation restores local value; accepted clear and errors keep contract',async()=>{
 const f=fixture();f.input.value='';f.c.confirm=()=>false;await f.c.updateProPlanStartDate(f.student.student_id,'',f.input);assert.equal(f.input.value,'2026-09');assert.equal(f.calls.length,0);
 f.input.value='';f.c.confirm=()=>true;let p=f.c.updateProPlanStartDate(f.student.student_id,'',f.input);assert.equal(f.calls[0].args[1].proPlanStartDate,null);f.calls[0].resolve(updated(f.student.student_id,null));await p;assert.equal(f.student.pro_plan_start_date,null);
 const g=fixture();p=g.c.updateProPlanStartDate(g.student.student_id,g.input.value,g.input);g.calls[0].reject(Error('private synthetic'));await p;assert.equal(g.input.value,'2026-09');assert.equal(g.input.disabled,false);assert.equal(g.errors.length,1);assert.equal(g.alerts[0][1].includes('private'),false);assert.equal(g.renders.length,0);
});
test('PRO invalid context and month send nothing; confirmation rechecks state',async()=>{
 for(const change of [f=>f.c.sessionToken=null,f=>f.c.currentPage='reservations',f=>f.c.currentUser.role='unknown',f=>f.input.disabled=true,f=>f.input.dataset.studentProPlanId='other',f=>f.c.getFilteredStudents=()=>[],f=>f.input.value='0000-01',f=>f.input.value='2026-13',f=>f.input.value='2026-1']){const f=fixture();change(f);await f.c.updateProPlanStartDate(f.student.student_id,f.input.value,f.input);assert.equal(f.calls.length,0);}
 const g=fixture();g.input.value='';g.c.confirm=()=>{g.c.sessionToken='new';return true};await g.c.updateProPlanStartDate(g.student.student_id,'',g.input);assert.equal(g.calls.length,0);
});
test('Wanami reverse reads update only latest captured cells and escape synthetic counts',async()=>{
 const f=fixture(),p=f.c.loadWanamiUsageDataBatch(),q=f.c.loadWanamiUsageDataBatch();f.calls[1].resolve({data:{success:true,data:{usage_counts:{[f.student.student_id]:'<b>fixture</b>'}}}});await q;assert.equal(f.cells[0].innerHTML.includes('<b>'),false);assert.match(f.cells[0].innerHTML,/&lt;b&gt;/);const html=f.cells[0].innerHTML;f.calls[0].resolve({data:{success:true,data:{usage_counts:{[f.student.student_id]:1}}}});await p;assert.equal(f.cells[0].innerHTML,html);
});
test('Wanami stale success/error after auth page root target cache or cells change is ignored',async()=>{
 for(const change of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='reservations',f=>f.elements.content={},f=>f.c.getFilteredStudents=()=>[],f=>f.student.student_id='other',f=>f.cells[0].dataset.studentId='other',f=>f.cells.splice(0,1)])for(const failure of [false,true]){const f=fixture(),cell=f.cells[0],p=f.c.loadWanamiUsageDataBatch();change(f);if(failure)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve({data:{success:true,data:{usage_counts:{'fixture/id':3}}}});await p;assert.equal(cell.innerHTML,'loading');assert.equal(cell.textContent,'');assert.equal(f.errors.length,0);}
});
test('Wanami current missing count is zero and current failure falls back locally',async()=>{
 const f=fixture();let p=f.c.loadWanamiUsageDataBatch();f.calls[0].resolve({data:{success:true,data:{usage_counts:{}}}});await p;assert.match(f.cells[0].innerHTML,/>0回</);p=f.c.loadWanamiUsageDataBatch();f.calls[1].reject(Error('private synthetic'));await p;assert.equal(f.cells[0].textContent,'-');assert.deepEqual(f.errors,['Wanami usage lookup failed']);
});
test('actual fixed card delegate reaches PRO operation with the exact input and keeps normal crew flow',async()=>{
 const start=source.indexOf('function handleStudentProPlanChange(');assert.ok(start>=0,'Integrated card delegate must exist');
 const delegate=source.slice(start,source.indexOf('\n}',start)+2),f=fixture();f.input.closest=selector=>selector==='input[data-student-pro-plan-id]'?f.input:null;
 vm.runInContext(delegate,f.c);const p=f.c.handleStudentProPlanChange({target:f.input});assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1].proPlanStartDate,'2026-10-01');f.calls[0].resolve(updated());await p;assert.equal(f.student.pro_plan_start_date,'2026-10-01');assert.deepEqual(f.renders,['students']);
});
