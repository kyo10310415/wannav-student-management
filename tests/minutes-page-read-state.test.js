import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const node=parent=>({parent,innerHTML:'original',textContent:'',value:'',contains(child){for(let p=child;p;p=p.parent)if(p===this)return true;return false},classList:{values:new Set(['hidden']),add(v){this.values.add(v)},remove(v){this.values.delete(v)},contains(v){return this.values.has(v)}}});
 const elements={content:node()};for(const id of ['minutes-list-container','minutes-detail-modal'])elements[id]=node(elements.content);for(const id of ['minutes-modal-title','minutes-modal-text','minutes-detail-panel-quality'])elements[id]=node(elements['minutes-detail-modal']);
 const calls=[],pending=[],renders=[],notices=[],quality=[];
 const c={sessionToken:'synthetic',currentUser:{id:7,role:'leader'},currentPage:'minutes',minutesCurrentStudentId:'Synthetic/ID',minutesCurrentStudentName:'Synthetic Name',minutesListCache:[{id:1}],minutesEditingId:null,minutesCurrentDetail:null,document:{getElementById:id=>elements[id],addEventListener(){}},renderMinutesList:()=>renders.push('list'),renderMinutesQualityEvaluation:value=>quality.push(value),switchMinutesDetailTab:()=>{},formatMinutesLessonNumber:value=>String(value),showNotification:(...args)=>notices.push(args)};
 c.axios={get:(...args)=>{const d=deferred();calls.push(args);pending.push(d);return d.promise}};vm.createContext(c);
 const helper=source.indexOf('let minutesListReadGeneration =');if(helper>=0)vm.runInContext(source.slice(helper,source.indexOf('async function loadMinutesList',helper)),c);
 for(const name of ['loadMinutesList','openMinutesDetail','closeMinutesModal'])vm.runInContext(extract(name),c);
 return{c,elements,calls,pending,renders,notices,quality,node};
}
const detail=id=>({data:{data:{id,student_id:'Synthetic/ID',lesson_date:'2026-10-30',generated_text:'Synthetic '+id,quality_evaluation:{version:2}}}});
test('old student list response cannot replace a new student context',async()=>{
 const f=fixture(),p=f.c.loadMinutesList();f.c.minutesCurrentStudentId='OTHER';f.pending[0].resolve({data:{data:[{id:99}]}});await p;assert.equal(f.c.minutesListCache[0].id,1);assert.equal(f.renders.length,0);
});
test('older detail response cannot replace the latest selected record',async()=>{
 const f=fixture(),a=f.c.openMinutesDetail(1),b=f.c.openMinutesDetail(2);f.pending[1].resolve(detail(2));await b;f.pending[0].resolve(detail(1));await a;assert.equal(f.c.minutesEditingId,2);assert.equal(f.elements['minutes-modal-text'].value,'Synthetic 2');
});

test('current list preserves encoded student ID and all-student requests with captured authorization',async()=>{
 for(const studentId of ['Synthetic/ID',null]){const f=fixture();f.c.minutesCurrentStudentId=studentId;const p=f.c.loadMinutesList();assert.equal(f.calls[0][0],studentId?'/api/minutes/list/Synthetic%2FID':'/api/minutes/all');assert.equal(f.calls[0][1].headers.Authorization,'Bearer synthetic');f.pending[0].resolve({data:{data:[{id:2}]}});assert.equal(await p,true);assert.equal(f.c.minutesListCache[0].id,2);assert.deepEqual(f.renders,['list'])}
 const f=fixture(),a=f.c.loadMinutesList(),b=f.c.loadMinutesList();f.pending[1].resolve({data:{data:[{id:2}]}});await b;f.pending[0].resolve({data:{data:[{id:1}]}});assert.equal(await a,false);assert.equal(f.c.minutesListCache[0].id,2);assert.equal(f.renders.length,1);
});
test('list context and container changes drop stale success/error while current failure stays fixed',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='students',f=>f.c.minutesCurrentStudentName='other',f=>f.elements.content={},f=>f.elements['minutes-list-container']=f.node(f.elements.content)];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),old=f.elements['minutes-list-container'],p=f.c.loadMinutesList();change(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve({data:{data:[{id:99}]}});assert.equal(await p,false);assert.equal(f.c.minutesListCache[0].id,1);assert.equal(old.innerHTML,'original');assert.equal(f.renders.length,0)}
 const f=fixture(),p=f.c.loadMinutesList();f.pending[0].reject(Error('PRIVATE_SENTINEL'));assert.equal(await p,false);assert.ok(f.elements['minutes-list-container'].innerHTML.includes('読み込みに失敗'));assert.equal(f.elements['minutes-list-container'].innerHTML.includes('PRIVATE_SENTINEL'),false);
});
test('real fixed detail preparation keeps numeric route and raw text in textarea without HTML interpretation',async()=>{
 const f=fixture();vm.runInContext(await readFile(new URL('../public/minutes-read-events.js',import.meta.url),'utf8'),f.c);
 const button={parent:f.elements.content,dataset:{minutesReadAction:'detail',minutesId:'2'},closest(){return this}};
 const p=f.c.handleMinutesReadClick({target:button});assert.equal(f.calls[0][0],'/api/minutes/detail/2');assert.equal(f.calls[0][1].headers.Authorization,'Bearer synthetic');const response=detail(2);response.data.data.generated_text='<b data-synthetic="minutes">SYNTHETIC</b>';f.pending[0].resolve(response);assert.equal(await p,true);assert.equal(f.elements['minutes-modal-text'].value,response.data.data.generated_text);assert.equal(f.c.minutesEditingId,2);assert.equal(f.quality.length,1);assert.equal(f.elements['minutes-detail-modal'].classList.contains('hidden'),false);
});
test('detail close and auth/student/cache/modal/field ownership changes prevent reopening or errors',async()=>{
 const changes=[f=>f.c.closeMinutesModal(),f=>f.c.sessionToken='new',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='students',f=>f.c.minutesCurrentStudentId='OTHER',f=>f.c.minutesCurrentStudentName='other',f=>f.c.minutesListCache=[],f=>f.elements.content={},f=>f.elements['minutes-detail-modal']=f.node(f.elements.content),f=>f.elements['minutes-modal-text']=f.node(f.elements['minutes-detail-modal'])];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=f.c.openMinutesDetail(1);change(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve(detail(1));assert.equal(await p,false);assert.equal(f.c.minutesEditingId,null);assert.equal(f.notices.length+f.quality.length,0)}
 const f=fixture(),p=f.c.openMinutesDetail(1);f.pending[0].reject(Error('PRIVATE_SENTINEL'));assert.equal(await p,false);assert.equal(f.notices.length,1);assert.equal(JSON.stringify(f.notices).includes('PRIVATE_SENTINEL'),false);
});
test('write-owned callback cancellation and unavailable authorization never issue or apply reads',async()=>{
 for(const method of ['list','detail']){const f=fixture();let active=true;const call=()=>method==='list'?f.c.loadMinutesList(()=>active):f.c.openMinutesDetail(1,()=>active);const p=call();active=false;f.pending[0].resolve(method==='list'?{data:{data:[{id:99}]}}:detail(1));assert.equal(await p,false);assert.equal(f.c.minutesEditingId,null);assert.equal(f.c.minutesListCache[0].id,1);assert.equal(f.renders.length+f.notices.length,0);await call();assert.equal(f.calls.length,1)}
 for(const role of ['crew','unknown']){const f=fixture();f.c.currentUser.role=role;await f.c.loadMinutesList();await f.c.openMinutesDetail(1);assert.equal(f.calls.length,0)}
 const f=fixture();for(const id of [0,-1,'1/2','01',9007199254740992])await f.c.openMinutesDetail(id);assert.equal(f.calls.length,0);
});
