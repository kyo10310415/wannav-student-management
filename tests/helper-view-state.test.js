import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fn(name){let a=source.indexOf('async function '+name+'(');if(a<0)a=source.indexOf('function '+name+'(');assert.ok(a>=0);return source.slice(a,source.indexOf('\n}',a)+2)}
function fixture(){
 const requests=[],alerts=[],logs=[],renders=[],badges=[];const elements={};
 const node=parent=>({parent,dataset:{},value:'',disabled:false,innerHTML:'',textContent:'',removed:false,classList:{hidden:false,add(){this.hidden=true},remove(){this.hidden=false},contains(){return this.hidden}},contains(n){for(;n;n=n.parent)if(n===this)return true;return false},remove(){this.removed=true}});
 elements.content=node();elements.loading=node();elements['helper-badge']=node();const body=node();
 const c={sessionToken:'synthetic-session',currentUser:{id:7,role:'admin'},currentPage:'helpers',API_BASE:'',helperStatusFilter:'all',helperRequests:[{id:1,status:'pending',reason:'Synthetic',deadline:'2099-01-01'}],tutors:[{employee_id:'E7',tutor_name:'Synthetic Tutor',status:'アクティブ',job_type:'Tutor'}],Date,URL,
 document:{getElementById:id=>elements[id]?.removed?null:elements[id],createElement:()=>{const n=node();Object.defineProperty(n,'id',{set(id){elements[id]=n}});return n},body:{appendChild(n){n.parent=body}}},
 alert:m=>alerts.push(m),confirm:()=>true,console:{error:(...args)=>logs.push(args)},escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),renderHelperStatistics:()=>'',getHelperStatusTitle:()=>'',updateHelperBadge:()=>badges.push(true),
 axios:{get:(url,config)=>new Promise((resolve,reject)=>requests.push({method:'GET',url,config,resolve,reject})),post:(url,data,config)=>new Promise((resolve,reject)=>requests.push({method:'POST',url,data,config,resolve,reject})),delete:(url,config)=>new Promise((resolve,reject)=>requests.push({method:'DELETE',url,config,resolve,reject}))}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let helperReadGeneration ='),source.indexOf('// Render helpers page')),c);
 for(const name of ['renderHelpersPage','loadHelperRequests','renderHelperRequestsList','acceptHelperRequest','showTutorSelectionModal','closeTutorSelectionModal','confirmAcceptHelperRequest','deleteHelperRequest'])vm.runInContext(fn(name),c);
 const resolve=(i,data=[],extra={})=>requests[i].resolve({data:{success:true,data,...extra}});
 const selection=(id=1)=>{c.showTutorSelectionModal(id);const modal=elements['tutor-selection-modal'];elements['accepting-tutor-select']=node(modal);elements['accepting-tutor-select'].value='E7';elements['helper-accept-confirm']=node(modal);return modal};
 const stubRender=()=>{c.renderHelpersPage=async parent=>renders.push(parent)};
 return {c,elements,requests,alerts,logs,renders,badges,node,resolve,selection,stubRender};
}

test('shared helper list renders saved text literally and permits only HTTP(S) links',()=>{
 const f=fixture(),marker='<b data-synthetic="field">Synthetic</b>';
 f.c.helperRequests=[{id:1,status:marker,student_id:marker,student_name:marker,requesting_tutor_name:marker,accepted_by_tutor_name:marker,lesson_progress:marker,reason:marker,notes:marker,notion_url:'data:text/html,Synthetic',deadline:'2099-01-01'}];
 let html=f.c.renderHelperRequestsList();assert.ok(!html.includes(marker));assert.equal(html.includes('href='),false);assert.ok(html.includes('Synthetic&lt;/b&gt;'));assert.ok(html.includes('deleteHelperRequest(1)'));
 f.c.helperRequests[0].status='accepted';f.c.helperRequests[0].notion_url='https://example.invalid/" quoted';html=f.c.renderHelperRequestsList();assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(!html.includes('<b data-synthetic'));assert.ok(html.includes('https://example.invalid/%22%20quoted'));
 f.c.helperRequests[0].id=marker;html=f.c.renderHelperRequestsList();assert.ok(!html.includes('deleteHelperRequest(<'));assert.ok(!html.includes('acceptHelperRequest(<'));
});

test('helper read newest response wins and late failures cannot erase cache or badges',async()=>{
 for(const fail of [false,true]){const f=fixture();const old=f.c.loadHelperRequests();const latest=f.c.loadHelperRequests();f.resolve(1,[{id:2}]);await latest;if(fail)f.requests[0].reject(Error('PRIVATE_SENTINEL'));else f.resolve(0,[{id:3}]);await old;assert.equal(f.c.helperRequests[0].id,2);assert.equal(f.badges.length,1);assert.equal(f.logs.length,0);assert.equal(f.requests[1].config.headers.Authorization,'Bearer synthetic-session');}
});

test('read remains usable for badges outside helper page but rejects auth or root changes',async()=>{
 const g=fixture();g.c.currentPage='students';const badge=g.c.loadHelperRequests();g.resolve(0,[{id:2}]);await badge;assert.equal(g.badges.length,1);
 for(const change of [f=>f.c.sessionToken='other',f=>f.c.currentUser=null,f=>f.c.currentUser={id:8,role:'admin'},f=>f.c.currentPage='students',f=>f.elements.content=f.node()]){const f=fixture();const pending=f.c.loadHelperRequests();change(f);f.resolve(0,[{id:2}]);await pending;assert.equal(f.c.helperRequests[0].id,1);assert.equal(f.badges.length,0);}
});

test('helper page does not render a late response after navigation',async()=>{
 const f=fixture();const pending=f.c.renderHelpersPage();f.c.currentPage='students';f.elements.content.innerHTML='NEW PAGE';f.resolve(0,[{id:2}]);await pending;assert.equal(f.elements.content.innerHTML,'NEW PAGE');assert.equal(f.c.helperRequests[0].id,1);
});

test('accept captures modal, selected tutor, auth and suppresses duplicate request or delete',async()=>{
 const f=fixture();f.stubRender();const modal=f.selection();const pending=f.c.confirmAcceptHelperRequest(1);await f.c.confirmAcceptHelperRequest(1);await f.c.deleteHelperRequest(1);assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].data)),{tutor_id:'E7',tutor_name:'Synthetic Tutor'});assert.equal(f.requests[0].config.headers.Authorization,'Bearer synthetic-session');f.resolve(0);await pending;assert.equal(modal.removed,true);assert.equal(f.alerts.length,1);assert.equal(f.renders.length,1);
});

test('old accept success cannot close or notify a new selection or changed session',async()=>{
 for(const change of [f=>{f.c.closeTutorSelectionModal();f.selection()},f=>f.c.sessionToken='other',f=>f.c.currentPage='students',f=>f.elements['accepting-tutor-select'].value='E8',f=>f.c.helperRequests=[{id:1,status:'pending'}]]){const f=fixture();f.stubRender();f.selection();const pending=f.c.confirmAcceptHelperRequest(1);change(f);f.resolve(0);await pending;assert.equal(f.alerts.length,0);assert.equal(f.renders.length,0);}
});

test('delete rechecks confirmation state, avoids repeated mutations and binds refresh to current view',async()=>{
 const f=fixture();f.stubRender();const pending=f.c.deleteHelperRequest(1);await f.c.deleteHelperRequest(1);assert.equal(f.requests.length,1);f.resolve(0);await pending;assert.equal(f.alerts.length,1);assert.equal(f.renders.length,1);assert.equal(f.renders[0](),true);f.selection();assert.equal(f.renders[0](),false);
 const g=fixture();g.c.confirm=()=>{g.c.currentUser=null;return true};await g.c.deleteHelperRequest(1);assert.equal(g.requests.length,0);
});

test('delete rejects old success after cache, role, root or modal changes',async()=>{
 for(const change of [f=>f.c.currentUser.role='crew',f=>f.elements.content=f.node(),f=>f.c.helperRequests=[{id:1,status:'pending'}],f=>f.selection()]){const f=fixture();f.stubRender();const pending=f.c.deleteHelperRequest(1);change(f);f.resolve(0);await pending;assert.equal(f.alerts.length,0);assert.equal(f.renders.length,0);}
});

test('current accept/delete failures use fixed diagnostics and release the pending lock',async()=>{
 for(const accept of [false,true]){const f=fixture();f.stubRender();if(accept)f.selection();const send=()=>accept?f.c.confirmAcceptHelperRequest(1):f.c.deleteHelperRequest(1);const pending=send();f.requests[0].reject(Error('PRIVATE_SENTINEL'));await pending;assert.ok(!JSON.stringify([f.logs,f.alerts]).includes('PRIVATE_SENTINEL'));const again=send();assert.equal(f.requests.length,2);f.resolve(1);await again;}
});

test('helper page follows the latest existing badge read before rendering shared cache',async()=>{
 const f=fixture();let pageDone=false;const page=f.c.renderHelpersPage().then(()=>pageDone=true);
 const badge=f.c.loadHelperRequests();f.resolve(0,[{id:1,reason:'OLD',deadline:'2099-01-01'}]);await new Promise(setImmediate);
 assert.equal(pageDone,false);assert.equal(f.elements.content.innerHTML,'');
 f.resolve(1,[{id:2,reason:'LATEST',deadline:'2099-01-01'}]);await badge;await page;
 assert.equal(pageDone,true);assert.ok(f.elements.content.innerHTML.includes('LATEST'));assert.ok(!f.elements.content.innerHTML.includes('OLD'));
 assert.equal(f.elements.loading.classList.hidden,true);assert.equal(f.elements.content.classList.hidden,false);assert.equal(f.requests.length,2);
});
