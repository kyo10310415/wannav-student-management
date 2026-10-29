import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const helperPendingCreations ='),source.indexOf('// ==================== Helper Requests List Page'));
const closeStart=source.indexOf('function closeHelperRequestModal()');
const close=source.slice(closeStart,source.indexOf('\n}',closeStart)+2);
function fixture(){
 const requests=[],alerts=[],logs=[];
 const node=parent=>({parent,disabled:false,innerHTML:'Confirm',contains(other){for(let p=other;p;p=p.parent)if(p===this)return true;return false},remove(){this.parent=null;this.removed=true}});
 const body=node(),elements={content:node()};
 const student={student_id:'OWN',name:'Synthetic Student',homeroom_tutor:'Synthetic Tutor',lesson_progress:'3',page_id:'synthetic-page'};
 const draft=()=>({selectedDate:'2026-10-29',selectedLesson:student,lessonTime:'12:00',reason:'Synthetic reason',notes:'Synthetic notes',deadline:'2026-10-30T12:00'});
 const modal=()=>{elements['helper-request-modal']=node(body);elements['helper-request-submit']=node(elements['helper-request-modal']);return elements['helper-request-modal']};modal();
 const c={currentUser:{id:7,role:'crew'},sessionToken:'synthetic-session',currentPage:'reservations',API_BASE:'',helperRequestData:draft(),cachedNotionUrls:{OWN:'https://example.invalid/notion'},tutors:[{notion_name:'Synthetic Tutor',employee_id:'E7',tutor_name:'Synthetic Tutor'}],Date,
 document:{getElementById:id=>elements[id]?.removed?null:elements[id],body},alert:m=>alerts.push(m),console:{error:(...args)=>logs.push(args)},
 fetch:(url,config)=>new Promise((resolve,reject)=>requests.push({url,config,resolve,reject}))};
 vm.createContext(c);vm.runInContext(block+'\n'+close,c);
 const resolve=(index=0,result={success:true},ok=true)=>requests[index].resolve({ok,json:async()=>result});
 return {c,requests,alerts,logs,elements,body,student,node,draft,modal,resolve};
}

test('helper create preserves payload, captured authorization, PRO/normal progress and successful close',async()=>{
 for(const pro of [false,true]){
  const f=fixture();if(pro)f.student.contract_plan='PROプラン';const pending=f.c.submitHelperRequest();assert.equal(f.requests.length,1);assert.equal(f.requests[0].config.headers.Authorization,'Bearer synthetic-session');
  const data=JSON.parse(f.requests[0].config.body);assert.deepEqual(data,{lesson_date:'2026-10-29',lesson_time:'12:00',student_id:'OWN',student_name:'Synthetic Student',notion_url:'https://example.invalid/notion',requesting_tutor_id:'E7',requesting_tutor_name:'Synthetic Tutor',lesson_progress:pro?null:3,reason:'Synthetic reason',notes:'Synthetic notes',deadline:new Date('2026-10-30T12:00').toISOString()});
  f.resolve();await pending;assert.equal(f.alerts.length,1);assert.equal(f.elements['helper-request-modal'].removed,true);assert.equal(f.c.helperRequestData.selectedLesson,null);
 }
});

test('same target pending guard prevents duplicate creation even with a new confirmation button',async()=>{
 const f=fixture();const pending=f.c.submitHelperRequest();await f.c.submitHelperRequest();assert.equal(f.requests.length,1);
 f.elements['helper-request-submit']=f.node(f.elements['helper-request-modal']);await f.c.submitHelperRequest();assert.equal(f.requests.length,1);
 f.resolve();await pending;assert.equal(f.alerts.length,0);assert.equal(f.elements['helper-request-submit'].disabled,false);
});

test('missing auth, unsupported roles/page, detached modal or non-confirmation DOM never sends',async()=>{
 for(const change of [f=>f.c.currentUser=null,f=>f.c.currentUser.role='unknown',f=>f.c.sessionToken='',f=>f.c.currentPage='helpers',f=>f.elements['helper-request-modal'].parent=null,f=>f.elements['helper-request-submit'].parent=null,f=>f.elements['helper-request-submit'].disabled=true,f=>f.c.helperRequestData.selectedLesson=null]){
  const f=fixture();change(f);await f.c.submitHelperRequest();assert.equal(f.requests.length,0);
 }
});

test('old success or failure cannot close, notify or reset changed draft, auth or page',async()=>{
 for(const fail of [false,true])for(const change of [f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'crew'},f=>f.c.currentUser.role='leader',f=>f.c.currentPage='helpers',f=>f.elements.content=f.node(),f=>f.c.helperRequestData.reason='NEW DRAFT',f=>f.student.name='NEW STUDENT']){
  const f=fixture();const pending=f.c.submitHelperRequest();change(f);if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve();await pending;assert.equal(f.alerts.length,0);assert.equal(f.logs.length,0);assert.notEqual(f.elements['helper-request-modal'].removed,true);
 }
});

test('close and reopen before an old response preserves the new modal and data identity',async()=>{
 const f=fixture();const pending=f.c.submitHelperRequest();f.c.closeHelperRequestModal();const fresh=f.modal();const data=f.draft();data.reason='KEEP NEW DRAFT';f.c.helperRequestData=data;
 f.resolve();await pending;assert.equal(f.elements['helper-request-modal'],fresh);assert.notEqual(fresh.removed,true);assert.equal(f.c.helperRequestData,data);assert.equal(data.reason,'KEEP NEW DRAFT');assert.equal(f.alerts.length,0);
});

test('current failure uses fixed diagnostic and releases pending state; invalid deadlines do not send',async()=>{
 const f=fixture();const pending=f.c.submitHelperRequest();f.requests[0].reject(Error('PRIVATE_SENTINEL'));await pending;assert.equal(f.alerts.length,1);assert.ok(!JSON.stringify([f.alerts,f.logs]).includes('PRIVATE_SENTINEL'));assert.equal(f.elements['helper-request-submit'].disabled,false);
 const retry=f.c.submitHelperRequest();assert.equal(f.requests.length,2);f.resolve(1,{success:false,error:'PRIVATE_SENTINEL'},false);await retry;assert.ok(!JSON.stringify([f.alerts,f.logs]).includes('PRIVATE_SENTINEL'));
 for(const deadline of [null,'','not-date']){const g=fixture();g.c.helperRequestData.deadline=deadline;await g.c.submitHelperRequest();assert.equal(g.requests.length,0);assert.equal(g.alerts.length,1)}
});
