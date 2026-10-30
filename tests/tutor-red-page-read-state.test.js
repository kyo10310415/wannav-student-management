import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const node=()=>({innerHTML:'original',disabled:false,classList:{values:new Set(),add(value){this.values.add(value)},remove(value){this.values.delete(value)},contains(value){return this.values.has(value)}}});
 const elements={content:node(),loading:node(),'tutor-red-recalc':node()};elements.content.contains=child=>child===elements['tutor-red-recalc'];
 const calls=[],pending=[],renders=[],notices=[],logs=[];
 const c={API_BASE:'',sessionToken:'synthetic',currentUser:{id:7,role:'admin'},currentPage:'tutor-red-list',tutorRedListYear:2026,tutorRedListMonth:10,tutorRedListData:[{tutor_id:'CURRENT'}],document:{getElementById:id=>elements[id]},_renderTutorRedListContent:()=>renders.push('render'),showNotification:(...args)=>notices.push(args),studentDisplayText:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),console:{error:(...args)=>logs.push(args)}};
 const send=(method,args)=>{const d=deferred();calls.push({method,args});pending.push(d);return d.promise};c.axios={get:(...args)=>send('get',args),post:(...args)=>send('post',args)};
 vm.createContext(c);const helper=source.indexOf('let tutorRedPageReadGeneration =');if(helper>=0)vm.runInContext(source.slice(helper,source.indexOf('async function renderTutorRedListPage',helper)),c);
 vm.runInContext(extract('renderTutorRedListPage')+'\n'+extract('recalcTutorRedList'),c);
 return{c,elements,calls,pending,renders,notices,logs};
}
test('old list read cannot update a different page after completion',async()=>{
 const f=fixture(),p=f.c.renderTutorRedListPage();f.c.currentPage='today';f.elements.content.innerHTML='new page';f.pending[0].resolve({data:{success:true,data:[{tutor_id:'OLD'}]}});await p;assert.equal(f.c.tutorRedListData[0].tutor_id,'CURRENT');assert.equal(f.renders.length,0);assert.equal(f.elements.content.innerHTML,'new page');
});
test('duplicate recalculation is suppressed and old completion cannot trigger a new-context read',async()=>{
 const f=fixture(),p=f.c.recalcTutorRedList();const duplicate=f.c.recalcTutorRedList();assert.equal(f.calls.length,1);await duplicate;f.c.sessionToken='new';f.pending[0].resolve({data:{success:true,message:'synthetic'}});await tick();if(f.pending[1])f.pending[1].resolve({data:{success:true,data:[]}});await p;assert.equal(f.calls.length,1);
});

test('current list and real month navigation preserve query, cache and loading contracts',async()=>{
 const f=fixture(),p=f.c.renderTutorRedListPage();assert.equal(f.calls[0].args[0],'/api/tutor-red-list?year=2026&month=10');assert.equal(f.calls[0].args[1].headers.Authorization,'Bearer synthetic');assert.equal(f.elements.content.classList.contains('hidden'),true);f.pending[0].resolve({data:{success:true,data:[{tutor_id:'FRESH'}]}});await p;assert.equal(f.c.tutorRedListData[0].tutor_id,'FRESH');assert.equal(f.elements.content.classList.contains('hidden'),false);assert.equal(f.elements.loading.classList.contains('hidden'),true);
 vm.runInContext(extract('changeTutorRedListMonth'),f.c);f.c.tutorRedListYear=2026;f.c.tutorRedListMonth=12;const next=f.c.changeTutorRedListMonth(1);assert.ok(f.calls[1].args[0].includes('year=2027&month=1'));f.pending[1].resolve({data:{success:true,data:[]}});await next;assert.equal(f.renders.length,2);
});
test('list response generation and auth/month/root ownership reject old success and errors',async()=>{
 for(const mutate of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='leader',f=>f.c.currentPage='today',f=>f.c.tutorRedListMonth=11,f=>f.c.tutorRedListYear=2027,f=>f.elements.content={},f=>f.elements.loading={}])for(const fail of [false,true]){const f=fixture(),p=f.c.renderTutorRedListPage();mutate(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve({data:{success:true,data:[{tutor_id:'OLD'}]}});await p;assert.equal(f.c.tutorRedListData[0].tutor_id,'CURRENT');assert.equal(f.renders.length+f.logs.length,0)}
 const f=fixture(),a=f.c.renderTutorRedListPage(),b=f.c.renderTutorRedListPage();f.pending[1].resolve({data:{success:true,data:[{tutor_id:'LATEST'}]}});await b;f.pending[0].resolve({data:{success:true,data:[{tutor_id:'OLD'}]}});await a;assert.equal(f.c.tutorRedListData[0].tutor_id,'LATEST');assert.equal(f.renders.length,1);
});
test('current read failure preserves empty fallback and private diagnostics; denied roles issue no request',async()=>{
 const f=fixture(),p=f.c.renderTutorRedListPage();f.pending[0].reject(Error('PRIVATE_SENTINEL'));await p;assert.equal(f.c.tutorRedListData.length,0);assert.equal(f.renders.length,1);assert.equal(JSON.stringify(f.logs).includes('PRIVATE_SENTINEL'),false);assert.equal(f.elements.content.classList.contains('hidden'),false);
 for(const role of ['leader','crew','unknown']){const g=fixture();g.c.currentUser.role=role;await g.c.renderTutorRedListPage();await g.c.recalcTutorRedList();assert.equal(g.calls.length,0);assert.equal(g.c.tutorRedListData.length,0);assert.ok(g.elements.content.innerHTML.includes('管理者'));}
});
test('current recalculation preserves payload, busy lifecycle and guarded refresh with literal success text',async()=>{
 const f=fixture(),p=f.c.recalcTutorRedList();assert.equal(f.elements['tutor-red-recalc'].disabled,true);await f.c.recalcTutorRedList();assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1].year,2026);assert.equal(f.calls[0].args[1].month,10);assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer synthetic');f.pending[0].resolve({data:{success:true,message:'Done <b>'}});await tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].args[1].headers.Authorization,'Bearer synthetic');assert.ok(f.notices.at(-1)[0].includes('&lt;b&gt;'));f.pending[1].resolve({data:{success:true,data:[{tutor_id:'RECALCULATED'}]}});await p;assert.equal(f.renders.length,1);assert.equal(f.c.tutorRedListData[0].tutor_id,'RECALCULATED');assert.equal(f.elements['tutor-red-recalc'].disabled,false);
});
test('stale recalculation success/error and its chained list read do not report into a new context',async()=>{
 for(const mutate of [f=>f.c.sessionToken='new',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='leader',f=>f.c.currentPage='today',f=>f.c.tutorRedListMonth=11,f=>f.elements.content={}])for(const fail of [false,true]){const f=fixture(),p=f.c.recalcTutorRedList();mutate(f);if(fail)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve({data:{success:true,message:'stale'}});await p;assert.equal(f.calls.length,1);assert.equal(f.renders.length+f.logs.length,0);assert.equal(f.notices.length,1)}
 const f=fixture(),p=f.c.recalcTutorRedList();f.pending[0].resolve({data:{success:true,message:'done'}});await tick();f.c.tutorRedListMonth=11;f.pending[1].resolve({data:{success:true,data:[{tutor_id:'OLD'}]}});await p;assert.equal(f.c.tutorRedListData[0].tutor_id,'CURRENT');assert.equal(f.renders.length,0);
});
test('current recalculation failure is fixed/private, unlocks and permits retry',async()=>{
 const f=fixture(),p=f.c.recalcTutorRedList();f.pending[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'PRIVATE_SENTINEL'}}}));await p;assert.equal(f.elements['tutor-red-recalc'].disabled,false);assert.equal(JSON.stringify([f.logs,f.notices]).includes('PRIVATE_SENTINEL'),false);assert.equal(f.calls.length,1);
 const q=f.c.recalcTutorRedList();assert.equal(f.calls.length,2);f.pending[1].resolve({data:{success:true}});await tick();f.pending[2].resolve({data:{success:true,data:[]}});await q;assert.equal(f.elements['tutor-red-recalc'].disabled,false);
});
