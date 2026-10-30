import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(view='handover'){
 const elements=Object.fromEntries(['content','handover-sidebar-list','handover-count-footer','new-assign-month','new-assign-table-body'].map(id=>[id,{innerHTML:'original',disabled:false,value:'next'}]));
 elements.content.contains=node=>node.root===elements.content;
 const student={student_id:'Synthetic/ID',handover_tutor_name:'Old'};
 const sends=[],pending=[],notices=[],logs=[],renders=[];
 const c={API_BASE:'',sessionToken:'synthetic',currentUser:{id:7,role:'leader'},currentPage:'handover',handoverActiveTab:view,handoverStudents:[student],newAssignStudents:[student],newAssignMonth:'next',newAssignTargetMonth:'2026-11',handoverFilterAssigned:'all',handoverFilterHandover:'all',newAssignFilterAssigned:'all',newAssignFilterHandover:'all',handoverTutorSidebar:[{tutor_name:'Target'}],document:{getElementById:id=>elements[id]},showNotification:(...args)=>notices.push(args),console:{error:(...args)=>logs.push(args)},studentDisplayText:value=>String(value).replace(/</g,'&lt;').replace(/>/g,'&gt;'),_renderHandoverSidebar:()=> 'sidebar-render',_handoverCountLabel:()=> 'handover-footer',_newAssignCountLabel:()=> 'new-footer',_renderHandoverLayout:()=>renders.push('layout'),_refreshNewAssignTable:()=>renders.push('table')};
 c.axios={put:(...args)=>send('put',args),get:(...args)=>send('get',args)};
 function send(method,args){const d=deferred();sends.push({method,args});pending.push(d);return d.promise}
 vm.createContext(c);
 if(source.includes('const handoverAssignmentWrites =')){vm.runInContext('let newAssignMonthReadGeneration = 0;',c);const start=source.indexOf('const handoverAssignmentWrites =');const end=source.indexOf('async function handoverUpdateAssignment',start);vm.runInContext(source.slice(start,end),c);}
 for(const name of ['handoverUpdateAssignment','newAssignUpdateAssignment','newAssignChangeMonth'])vm.runInContext(extract(name),c);
 return{c,elements,student,sends,pending,notices,logs,renders};
}
const ok={data:{success:true}};
test('assignment stale completion does not mutate cache, notify or start reads under a changed context',async()=>{
 for(const view of ['handover','new'])for(const fail of [false,true])for(const mutate of [f=>f.c.sessionToken='other',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.handoverActiveTab=view==='new'?'handover':'new',f=>f.elements.content={},f=>{f.c.handoverStudents=[];f.c.newAssignStudents=[]}]){
  const f=fixture(view),p=view==='new'?f.c.newAssignUpdateAssignment(f.student.student_id,'Target'):f.c.handoverUpdateAssignment(f.student.student_id,'Target');mutate(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve(ok);await tick();if(f.pending[1])f.pending[1].resolve({data:{data:[{tutor_name:'wrong'}]}});await p;assert.equal(f.student.handover_tutor_name,'Old');assert.equal(f.sends.length,1);assert.equal(f.notices.length,0);assert.equal(f.logs.length,0);
 }
});
test('older repeated month request cannot overwrite the latest response',async()=>{
 const f=fixture('new'),a=f.c.newAssignChangeMonth('current'),b=f.c.newAssignChangeMonth('current');f.pending[1].resolve({data:{success:true,data:[{student_id:'LATEST'}],target_month:'2026-10'}});await b;f.pending[0].resolve({data:{success:true,data:[{student_id:'OLD'}],target_month:'2026-10'}});await a;assert.equal(f.c.newAssignStudents[0].student_id,'LATEST');assert.deepEqual(f.renders,['layout']);
});

test('normal assignment and clear preserve payload while disabling only the owned control until completion',async()=>{
 for(const view of ['handover','new']){
  const f=fixture(view),control={root:f.elements.content,disabled:false},save=view==='new'?f.c.newAssignUpdateAssignment:f.c.handoverUpdateAssignment;
  const p=save(f.student.student_id,'Target <b>',control);assert.equal(control.disabled,true);await save(f.student.student_id,'Ignored',control);assert.equal(f.sends.length,1);assert.equal(f.sends[0].args[0],'/api/handover/students/Synthetic%2FID/assignment');assert.equal(f.sends[0].args[1].handover_tutor_name,'Target <b>');assert.equal(f.sends[0].args[2].headers.Authorization,'Bearer synthetic');
  f.pending[0].resolve(ok);await tick();assert.equal(f.sends.length,2);assert.equal(f.sends[1].args[1].headers.Authorization,'Bearer synthetic');assert.equal(f.student.handover_tutor_name,'Target <b>');assert.equal(control.disabled,true);assert.ok(f.notices[0][0].includes('&lt;b&gt;'));f.pending[1].resolve({data:{data:[{tutor_name:'fresh'}]}});await p;assert.equal(control.disabled,false);assert.equal(control.value,'Target <b>');assert.equal(f.elements['handover-count-footer'].innerHTML,view==='new'?'new-footer':'handover-footer');
  const clear=save(f.student.student_id,'',control);assert.equal(f.sends[2].args[1].handover_tutor_name,null);f.pending[2].resolve(ok);await tick();f.pending[3].resolve({data:{data:[]}});await clear;assert.equal(f.student.handover_tutor_name,'');assert.equal(control.value,'');assert.equal(control.disabled,false);
 }
});
test('sidebar response uses captured actor and never applies after context changes',async()=>{
 for(const fail of [false,true]){
  const f=fixture(),p=f.c.handoverUpdateAssignment(f.student.student_id,'Target');f.pending[0].resolve(ok);await tick();assert.equal(f.sends.length,2);f.c.sessionToken='other';if(fail)f.pending[1].reject(Error('PRIVATE_SENTINEL'));else f.pending[1].resolve({data:{data:[{tutor_name:'stale'}]}});await p;assert.equal(f.c.handoverTutorSidebar[0].tutor_name,'Target');assert.equal(f.elements['handover-sidebar-list'].innerHTML,'original');assert.equal(f.elements['handover-count-footer'].innerHTML,'original');assert.equal(f.logs.length,0);
 }
});
test('different-student saves retain both local results and only the latest sidebar read wins',async()=>{
 const f=fixture(),second={student_id:'OTHER',handover_tutor_name:'Old'};f.c.handoverStudents.push(second);
 const a=f.c.handoverUpdateAssignment(f.student.student_id,'A'),b=f.c.handoverUpdateAssignment(second.student_id,'B');assert.equal(f.sends.length,2);
 f.pending[0].resolve(ok);await tick();f.pending[1].resolve(ok);await tick();assert.equal(f.sends.length,4);f.pending[3].resolve({data:{data:[{tutor_name:'LATEST'}]}});await b;f.pending[2].resolve({data:{data:[{tutor_name:'OLD'}]}});await a;assert.equal(f.c.handoverTutorSidebar[0].tutor_name,'LATEST');assert.equal(f.student.handover_tutor_name,'A');assert.equal(second.handover_tutor_name,'B');assert.equal(f.notices.length,2);
});
test('current save failure stays fixed/private, releases busy control and permits a retry',async()=>{
 const f=fixture(),control={root:f.elements.content,disabled:false},p=f.c.handoverUpdateAssignment(f.student.student_id,'Target',control);f.pending[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'PRIVATE_SENTINEL'}}}));await p;assert.equal(control.disabled,false);assert.equal(f.student.handover_tutor_name,'Old');assert.equal(JSON.stringify([f.notices,f.logs]).includes('PRIVATE_SENTINEL'),false);
 const q=f.c.handoverUpdateAssignment(f.student.student_id,'Target',control);assert.equal(f.sends.length,2);f.pending[1].resolve(ok);await tick();f.pending[2].resolve({data:{data:[]}});await q;assert.equal(f.student.handover_tutor_name,'Target');
});
test('month read guards auth/page/tab/DOM/cache changes and error text while current retry succeeds',async()=>{
 for(const mutate of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.handoverActiveTab='handover',f=>f.elements.content={},f=>f.c.newAssignStudents=[],f=>f.c.newAssignFilterAssigned='other'])for(const fail of [false,true]){
  const f=fixture('new'),p=f.c.newAssignChangeMonth('current');mutate(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve({data:{success:true,data:[{student_id:'STALE'}],target_month:'old'}});await p;assert.equal(f.c.newAssignMonth,'next');assert.equal(f.renders.length+f.notices.length+f.logs.length,0);
 }
 const f=fixture('new'),p=f.c.newAssignChangeMonth('current');assert.equal(f.elements['new-assign-month'].disabled,true);f.pending[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'PRIVATE_SENTINEL'}}}));await p;assert.equal(f.elements['new-assign-month'].disabled,false);assert.equal(f.elements['new-assign-month'].value,'next');assert.deepEqual(f.renders,['table']);assert.equal(JSON.stringify([f.notices,f.logs]).includes('PRIVATE_SENTINEL'),false);
 const q=f.c.newAssignChangeMonth('current');assert.equal(f.sends[1].args[1].params.month,'current');assert.equal(f.sends[1].args[1].headers.Authorization,'Bearer synthetic');f.pending[1].resolve({data:{success:true,data:[{student_id:'CURRENT'}],target_month:'2026-10'}});await q;assert.equal(f.c.newAssignMonth,'current');assert.equal(f.c.newAssignStudents[0].student_id,'CURRENT');assert.deepEqual(f.renders,['table','layout']);assert.equal(f.elements['new-assign-month'].disabled,false);
});
test('crew and unknown targets cannot start guarded assignment or month operations',async()=>{
 const f=fixture('new');f.c.currentUser.role='crew';await f.c.newAssignChangeMonth('current');await f.c.newAssignUpdateAssignment(f.student.student_id,'Target');assert.equal(f.sends.length,0);f.c.currentUser.role='leader';await f.c.newAssignUpdateAssignment('missing','Target');assert.equal(f.sends.length,0);
});
