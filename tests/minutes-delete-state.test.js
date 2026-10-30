import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const root={contains:node=>node?.root===root},list={root};
 const control={root,disabled:false,dataset:{minutesReadAction:'delete',minutesId:'27'}};
 const elements={content:root,'minutes-list-container':list,'minutes-detail-modal':{root}};
 const calls=[],pending=[],notices=[],confirmations=[],listWrites=[];
 const entry={id:27,student_id:'Synthetic',student_name:'Synthetic'};
 const c={currentUser:{id:7,role:'leader'},currentPage:'minutes',sessionToken:'synthetic',minutesCurrentStudentId:'Synthetic',minutesCurrentStudentName:'Synthetic',minutesListCache:[entry],minutesEditingId:null,minutesCurrentDetail:null,document:{getElementById:id=>elements[id],addEventListener(){}},showNotification:(...args)=>notices.push(args),confirm:message=>{confirmations.push(message);return true},loadMinutesList:async(parentCurrent=()=>true)=>{if(parentCurrent())listWrites.push('list');return parentCurrent()},axios:{delete:(...args)=>{const d=deferred();calls.push(args);pending.push(d);return d.promise}}};
 vm.createContext(c);vm.runInContext('const minutesPendingWrites=new Set();\n'+extract('captureMinutesWriteView')+'\n'+extract('deleteMinutes'),c);
 return{c,root,list,control,elements,entry,calls,pending,notices,confirmations,listWrites};
}
test('old delete completion cannot notify or refresh a newly selected student context',async()=>{
 const f=fixture(),p=f.c.deleteMinutes(27,f.control);f.c.minutesCurrentStudentId='OTHER';f.pending[0].resolve({data:{success:true}});await p;assert.equal(f.notices.length+f.listWrites.length,0);
});
test('same-record duplicate delete sends only one request',async()=>{
 const f=fixture(),a=f.c.deleteMinutes(27,f.control),b=f.c.deleteMinutes(27,f.control);assert.equal(f.calls.length,1);f.pending[0].resolve({data:{success:true}});await Promise.all([a,b]);
});

test('real renderer fixed delete entry sends one DELETE and refreshes the same manager view',async()=>{
 const f=fixture();f.c.escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');f.c.formatMinutesLessonNumber=String;f.list.innerHTML='';
 vm.runInContext(extract('renderMinutesList'),f.c);f.c.renderMinutesList();assert.ok(f.list.innerHTML.includes('data-minutes-read-action="delete" data-minutes-id="27"'));assert.equal(f.list.innerHTML.includes('onclick='),false);
 vm.runInContext(await readFile(new URL('../public/minutes-read-events.js',import.meta.url),'utf8'),f.c);f.control.closest=()=>f.control;
 const p=f.c.handleMinutesReadClick({target:{closest:()=>f.control}});assert.equal(f.control.disabled,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'/api/minutes/27');assert.equal(f.calls[0][1].headers.Authorization,'Bearer synthetic');f.pending[0].resolve({data:{success:true}});await p;assert.equal(f.confirmations.length,1);assert.equal(f.notices.length,1);assert.deepEqual(f.listWrites,['list']);assert.equal(f.control.disabled,false);
});
test('cancel and confirmation context changes send nothing and release the shared record lock',async()=>{
 for(const confirm of [()=>false,f=>()=>{f.c.minutesCurrentStudentId='OTHER';return true}]){const f=fixture();f.c.confirm=confirm.length?confirm(f):confirm;await f.c.deleteMinutes(27,f.control);assert.equal(f.calls.length,0);assert.equal(f.control.disabled,false);assert.equal(vm.runInContext('minutesPendingWrites.size',f.c),0)}
 const f=fixture();vm.runInContext("minutesPendingWrites.add(JSON.stringify(['save','synthetic',7,27]))",f.c);await f.c.deleteMinutes(27,f.control);assert.equal(f.calls.length+f.confirmations.length,0);assert.equal(f.control.disabled,false);
});
test('delete completion respects auth, page, student, cache, modal and control ownership on success and errors',async()=>{
 const changes=[f=>f.c.sessionToken='other',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentName='Other',f=>f.c.minutesListCache=[],f=>f.elements.content={},f=>f.elements['minutes-list-container']={},f=>f.control.root={},f=>f.c.minutesEditingId=99,f=>f.c.minutesCurrentDetail={id:99},f=>f.elements['minutes-detail-modal']={}];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=f.c.deleteMinutes(27,f.control);change(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve({data:{success:true}});await p;assert.equal(f.notices.length+f.listWrites.length,0);assert.equal(vm.runInContext('minutesPendingWrites.size',f.c),0)}
});
test('current delete failure is retryable and chained list receives the original parent context',async()=>{
 const f=fixture(),p=f.c.deleteMinutes(27,f.control);assert.equal(vm.runInContext("minutesPendingWrites.has(JSON.stringify(['save','synthetic',7,27]))",f.c),true);f.pending[0].reject(Error('PRIVATE_SENTINEL'));await p;assert.equal(f.control.disabled,false);assert.equal(JSON.stringify(f.notices).includes('PRIVATE_SENTINEL'),false);
 let finish;f.c.loadMinutesList=parentCurrent=>new Promise(resolve=>{finish=()=>{if(parentCurrent())f.listWrites.push('list');resolve(parentCurrent())}});
 const q=f.c.deleteMinutes(27,f.control);f.pending[1].resolve({data:{success:true}});await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof finish,'function');f.c.minutesCurrentStudentId='OTHER';finish();await q;assert.equal(f.listWrites.length,0);
});
test('missing cache targets, malformed IDs and unavailable manager authorization cannot confirm or send',async()=>{
 for(const role of ['crew','unknown']){const f=fixture();f.c.currentUser.role=role;await f.c.deleteMinutes(27,f.control);assert.equal(f.calls.length+f.confirmations.length,0)}
 const f=fixture();for(const id of [0,-1,'01','27/x',99,9007199254740992])await f.c.deleteMinutes(id,f.control);assert.equal(f.calls.length+f.confirmations.length,0);f.c.minutesListCache=[];await f.c.deleteMinutes(27,f.control);assert.equal(f.calls.length+f.confirmations.length,0);
});
