import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const absencePendingWrites ='),source.indexOf('// ==================== Current Tutor Management'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(role='crew'){
 const calls=[], alerts=[], errors=[], reads=[], requests=[];
 const elements={content:{}};
 const radio={value:'cancel'}, reason={value:' regular reason '}, button={disabled:false,innerHTML:'submit'};
 const modal={contains:n=>[radio,reason,button].includes(n),querySelector:()=>radio};
 elements['absence-request-modal']=modal;elements['absence-request-submit']=button;elements['absence-reason']=reason;
 const schedule={event_id:'event/fixture',unique_event_key:'event/fixture_2026',title:'fixture title',schedule_date:'2026-10-29',schedule_time:'10:00',matched_keyword:'1on1',account:'manager@example.test',absence_requests:[{id:7,tutor_email:'crew@example.test'}]};
 const event={event_id:schedule.unique_event_key,requests:[{id:7,tutor_email:'crew@example.test',tutor_name:'fixture tutor'}]};
 const c={API_BASE:'',sessionToken:'fixture-token',currentUser:{id:1,role,email:'manager@example.test',name:'manager'},currentPage:'schedules',currentTutorEmail:'crew@example.test',currentTutorName:'fixture tutor',scheduleTab:'confirmed',selectedScheduleYear:2026,selectedScheduleMonth:10,selectedScheduleForAbsence:schedule,pendingRequests:[event],getFilteredSchedules:()=>[schedule],document:{getElementById:id=>elements[id],body:{contains:m=>elements['absence-request-modal']===m}},alert:m=>alerts.push(m),confirm:()=>true,console:{error:m=>errors.push(m)},renderSchedulesPage:async()=>reads.push('schedules'),handleScheduleTabChange:async()=>reads.push('pending'),closeAbsenceRequestModal(){delete elements['absence-request-modal'];c.selectedScheduleForAbsence=null;}};
 c.axios={post:(...args)=>send('post',args),delete:(...args)=>send('delete',args)};
 function send(method,args){const d=deferred();calls.push([method,...args]);requests.push(d);return d.promise;}
 vm.createContext(c);vm.runInContext(block,c);
 return{c,calls,alerts,errors,reads,requests,elements,modal,button,reason,radio,schedule,event};
}
const success={data:{success:true}};
test('absence submit preserves payload, guards duplicate and refreshes current completion',async()=>{
 const f=fixture();const p=f.c.submitAbsenceRequest();await f.c.submitAbsenceRequest();assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][2])),{event_id:f.schedule.unique_event_key,tutor_email:'crew@example.test',tutor_name:'fixture tutor',absence_type:'cancel',reason:'regular reason',schedule_date:'2026-10-29',schedule_time:'10:00',schedule_title:'fixture title',matched_keyword:'1on1',leader_email:'manager@example.test'});
 f.requests[0].resolve(success);await p;assert.equal(f.alerts.length,1);assert.deepEqual(f.reads,['schedules']);assert.equal(f.c.selectedScheduleForAbsence,null);
});
test('submit stale success/failure never closes another modal or reports errors',async()=>{
 const mutations=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='leader',f=>f.c.currentPage='students',f=>f.elements.content={},f=>f.c.currentTutorEmail='other@example.test',f=>f.c.scheduleTab='pending',f=>f.c.selectedScheduleMonth=11,f=>f.reason.value='new',f=>f.radio.value='reschedule',f=>f.schedule.title='changed',f=>f.elements['absence-request-modal']={}];
 for(const change of mutations)for(const reject of [false,true]){const f=fixture(),p=f.c.submitAbsenceRequest();change(f);if(reject)f.requests[0].reject(new Error('private failure fixture'));else f.requests[0].resolve(success);await p;assert.equal(f.alerts.length,0);assert.equal(f.errors.length,0);assert.equal(f.reads.length,0);assert.notEqual(f.c.selectedScheduleForAbsence,null);}
});
test('submit gates detached/untrusted state and restores same failed button for retry',async()=>{
 for(const mutate of [f=>f.c.sessionToken=null,f=>f.c.currentPage='students',f=>f.c.currentUser.role='unknown',f=>f.button.disabled=true,f=>delete f.elements['absence-request-modal'],f=>f.c.getFilteredSchedules=()=>[],f=>f.radio.value='invalid']){const f=fixture();mutate(f);await f.c.submitAbsenceRequest();assert.equal(f.calls.length,0);}
 const f=fixture();let p=f.c.submitAbsenceRequest();f.requests[0].resolve({data:{success:false,error:'private fixture'}});await p;assert.equal(f.button.disabled,false);assert.equal(f.button.innerHTML,'submit');assert.deepEqual(f.alerts,['申請に失敗しました']);assert.equal(f.errors.some(x=>x.includes('private')),false);p=f.c.submitAbsenceRequest();f.requests[1].resolve(success);await p;
});
test('withdraw is scoped to current tutor and cached request; confirmation mutations and duplicate rejected',async()=>{
 const f=fixture();await f.c.cancelAbsenceRequest(f.schedule.unique_event_key,'other@example.test');assert.equal(f.calls.length,0);
 const p=f.c.cancelAbsenceRequest(f.schedule.unique_event_key,f.c.currentTutorEmail);await f.c.cancelAbsenceRequest(f.schedule.unique_event_key,f.c.currentTutorEmail);assert.equal(f.calls.length,1);assert.match(f.calls[0][1],/event%2Ffixture_2026/);f.requests[0].resolve(success);await p;assert.deepEqual(f.reads,['schedules']);
 const g=fixture();g.c.confirm=()=>{g.c.currentPage='students';return true};await g.c.cancelAbsenceRequest(g.schedule.unique_event_key,g.c.currentTutorEmail);assert.equal(g.calls.length,0);
});
test('withdraw and approval stale completion do not alert or refresh another view',async()=>{
 for(const action of ['cancel','approve'])for(const rejected of [true,false])for(const change of [f=>f.c.sessionToken='new',f=>f.c.currentPage='other',f=>f.elements.content={},f=>f.c.scheduleTab='pending',f=>{f.schedule.absence_requests=[];f.event.requests=[]}]){
 const f=fixture('admin');const p=action==='cancel'?f.c.cancelAbsenceRequest(f.schedule.unique_event_key,f.c.currentTutorEmail):f.c.approveAbsenceRequest(7,'ignored');change(f);if(rejected)f.requests[0].reject(new Error('private fixture'));else f.requests[0].resolve(success);await p;assert.equal(f.alerts.length,0);assert.equal(f.errors.length,0);assert.equal(f.reads.length,0);
 }
});
test('approval requires manager, cached positive id and locks against withdrawal',async()=>{
 const crew=fixture();await crew.c.approveAbsenceRequest(7,'fixture');assert.equal(crew.calls.length,0);
 const f=fixture('leader');for(const id of ['7x',0,999])await f.c.approveAbsenceRequest(id,'fixture');assert.equal(f.calls.length,0);
 const p=f.c.approveAbsenceRequest('7','ignored');await f.c.approveAbsenceRequest(7,'fixture');await f.c.cancelAbsenceRequest(f.schedule.unique_event_key,f.c.currentTutorEmail);assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][2])),{leader_email:'manager@example.test',leader_name:'manager'});f.requests[0].resolve(success);await p;assert.deepEqual(f.reads,['pending']);
});
test('approval confirmation rechecks auth and current failures have fixed messages',async()=>{
 const g=fixture('admin');g.c.confirm=()=>{g.c.currentUser.role='crew';return true};await g.c.approveAbsenceRequest(7,'fixture');assert.equal(g.calls.length,0);
 for(const action of ['cancel','approve']){const f=fixture('admin');const p=action==='cancel'?f.c.cancelAbsenceRequest(f.schedule.unique_event_key,f.c.currentTutorEmail):f.c.approveAbsenceRequest(7,'fixture');f.requests[0].reject(new Error('private fixture'));await p;assert.equal(f.alerts.length,1);assert.equal(f.errors.length,1);assert.equal(f.alerts.concat(f.errors).some(s=>s.includes('private')),false);}
});
function realRefresh(f){
 const extract=(name)=>{const start=source.indexOf('async function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2)};
 f.c.schedules=['old'];f.c.renderSchedulesContent=()=>f.reads.push('content');
 f.c.axios.get=url=>{const d=deferred();f.calls.push(['get',url]);f.requests.push(d);return d.promise};
 vm.runInContext(extract('renderSchedulesPage')+'\n'+extract('handleScheduleTabChange'),f.c);
}
test('write-owned refresh ignores old schedule GET success and failure after page change',async()=>{
 for(const reject of [false,true]){const f=fixture();realRefresh(f);const p=f.c.submitAbsenceRequest();f.requests[0].resolve(success);await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,2);f.c.currentPage='students';f.elements.content.innerHTML='new view';if(reject)f.requests[1].reject(new Error('private fixture'));else f.requests[1].resolve({data:{success:true,data:[{event_id:'new'}]}});await p;assert.equal(f.elements.content.innerHTML,'new view');assert.deepEqual(f.c.schedules,['old']);assert.equal(f.reads.length,0);assert.equal(f.errors.length,0);}
});
test('write-owned second schedule read and pending refresh ignore auth changes',async()=>{
 const f=fixture();realRefresh(f);const p=f.c.submitAbsenceRequest();f.requests[0].resolve(success);await new Promise(r=>setImmediate(r));f.requests[1].resolve({data:{success:true,data:[{event_id:'new'}]}});await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,3);f.c.sessionToken='new';f.elements.content.innerHTML='new view';f.requests[2].resolve({data:{success:true,data:{requests:{}}}});await p;assert.equal(f.reads.length,0);assert.equal(f.elements.content.innerHTML,'new view');
 for(const reject of [false,true]){const g=fixture('leader');realRefresh(g);const before=g.c.pendingRequests;const q=g.c.approveAbsenceRequest(7,'ignored');g.requests[0].resolve(success);await new Promise(r=>setImmediate(r));assert.equal(g.calls.length,2);g.c.sessionToken='new';g.elements.content.innerHTML='new view';if(reject)g.requests[1].reject(new Error('private fixture'));else g.requests[1].resolve({data:{success:true,data:{pendingRequests:[]}}});await q;assert.equal(g.c.pendingRequests,before);assert.equal(g.reads.length,0);assert.equal(g.errors.length,0);assert.equal(g.elements.content.innerHTML,'new view');}
});
test('normal write-owned refresh still renders schedule and pending results',async()=>{
 const f=fixture();realRefresh(f);const p=f.c.submitAbsenceRequest();f.requests[0].resolve(success);await new Promise(r=>setImmediate(r));f.requests[1].resolve({data:{success:true,data:[{event_id:'new'}]}});await new Promise(r=>setImmediate(r));f.requests[2].resolve({data:{success:true,data:{requests:{}}}});await p;assert.deepEqual(f.reads,['content']);
 const g=fixture('admin');realRefresh(g);const q=g.c.approveAbsenceRequest(7,'ignored');g.requests[0].resolve(success);await new Promise(r=>setImmediate(r));g.requests[1].resolve({data:{success:true,data:{pendingRequests:[]}}});await q;assert.deepEqual(g.reads,['content']);assert.equal(g.c.pendingRequests.length,0);
});

test('real list preparation opens the canonical cached schedule and real submit sends its payload', async()=>{
 const f=fixture();
 f.c.escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 f.elements.content.contains=node=>node.root===f.elements.content;
 f.c.document.addEventListener=()=>{};
 f.c.document.createElement=()=>{const modal={contains:node=>[f.radio,f.reason,f.button].includes(node),querySelector:()=>f.radio};Object.defineProperty(modal,'id',{set(id){f.elements[id]=modal}});return modal};
 f.c.document.body.appendChild=()=>{};
 const extract=name=>{const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2)};
 vm.runInContext(extract('renderSchedulesList')+'\n'+extract('openAbsenceRequestModal'),f.c);
 vm.runInContext(await readFile(new URL('../public/absence-prepare-events.js',import.meta.url),'utf8'),f.c);
 const html=f.c.renderSchedulesList(), encoded=html.match(/data-absence-schedule="([^"]+)"/)[1];
 const button={root:f.elements.content,dataset:{absencePrepareAction:'open',absenceSchedule:encoded},closest(){return this}};
 f.c.selectedScheduleForAbsence=null;
 f.c.handleAbsencePrepareClick({target:button});
 assert.equal(f.c.selectedScheduleForAbsence,f.schedule);
 assert.ok(f.elements['absence-request-modal'].innerHTML.includes('fixture title'));
 const pending=f.c.submitAbsenceRequest();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][2].event_id,f.schedule.unique_event_key);assert.equal(f.calls[0][2].reason,'regular reason');
 f.requests[0].resolve(success);await pending;assert.equal(f.alerts.length,1);
});

test('preparation rejects stale snapshots and filtered-out events before modal creation', async()=>{
 const f=fixture(), opened=[];
 f.c.document.addEventListener=()=>{};f.elements.content.contains=node=>node.root===f.elements.content;
 f.c.openAbsenceRequestModal=schedule=>opened.push(schedule);
 vm.runInContext(await readFile(new URL('../public/absence-prepare-events.js',import.meta.url),'utf8'),f.c);
 const button={root:f.elements.content,dataset:{absencePrepareAction:'open',absenceSchedule:encodeURIComponent(JSON.stringify(f.schedule))},closest(){return this}};
 f.schedule.title='updated title';f.c.handleAbsencePrepareClick({target:button});assert.equal(opened.length,0);
 button.dataset.absenceSchedule=encodeURIComponent(JSON.stringify(f.schedule));f.c.getFilteredSchedules=()=>[];f.c.handleAbsencePrepareClick({target:button});assert.equal(opened.length,0);
 f.c.getFilteredSchedules=()=>[f.schedule];f.c.handleAbsencePrepareClick({target:button});assert.equal(opened[0],f.schedule);
});
