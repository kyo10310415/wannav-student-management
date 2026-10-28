import test from 'node:test';import assert from 'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const historySource=await readFile(new URL('../public/student-history-events.js',import.meta.url),'utf8'),vqSource=await readFile(new URL('../public/vq-history-events.js',import.meta.url),'utf8'),helperSource=await readFile(new URL('../public/helper-status-events.js',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],requests=[],notices=[],logs=[],timers=[],children=new Set(),html=[],listeners=[];
 const root=()=>({innerHTML:'',attributes:{},contains(n){for(let p=n;p;p=p.root)if(p===this)return true;return false},setAttribute(key,value){this.attributes[key]=value},remove(){children.delete(this);this.removed=true}});
 const elements={content:root(),'wanami-history-modal':root()};
 const c={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'students',API_BASE:'',students:[{student_id:'SYNTHETIC',name:'Synthetic <student>'}],document:{getElementById:id=>elements[id],body:{contains:n=>children.has(n),insertAdjacentHTML:(position,value)=>html.push(value),appendChild:modal=>children.add(modal)},createElement:()=>root(),addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),setTimeout:(callback,delay)=>timers.push({callback,delay}),showAlert:(...args)=>notices.push(args),showNotification:(...args)=>notices.push(args),renderVQDiagnosisCharts:rows=>calls.push(['charts',rows.length])};
 for(const name of ['showWanamiHistory','closeWanamiHistoryModal','showStudentVQHistory','filterHelpersByStatus'])c[name]=(...args)=>calls.push([name,...args]);
 c.axios={get:async(...args)=>{requests.push(args);return {data:{success:true,data:{history:[]},history:[]}}}};
 vm.createContext(c);vm.runInContext(historySource+'\n'+helperSource+'\n'+vqSource,c);
 const node=(action,id='SYNTHETIC',at=elements.content,modal=null)=>{const n={root:at,disabled:false,dataset:{studentHistoryAction:action,studentHistoryId:id}};n.closest=s=>s==='[data-student-history-action]'?n:s==='[data-student-vq-history]'?modal:null;return n};
 const status=(value,at=elements.content)=>{const n={root:at,disabled:false,dataset:{helperStatus:value}};n.closest=s=>s==='button[data-helper-status]'?n:null;return n};
 return{c,calls,requests,notices,logs,timers,children,html,elements,listeners,root,node,status};
}
function installRealHistories(f){for(const [start,end]of [['async function showWanamiHistory(studentId)','// Render student statistics'],['async function showStudentVQHistory(studentId)','function renderVQDiagnosisCharts(history)']]){const i=app.indexOf(start),j=app.indexOf(end,i);assert.ok(i>=0&&j>i);vm.runInContext(app.slice(i,j),f.c)}}
test('history span/button actions preserve IDs and effective manager-only VQ access',async()=>{
 for(const role of ['admin','leader','crew']){
  const f=fixture();f.c.currentUser={role};const id="Synthetic'\"<&>";
  await f.c.handleStudentHistoryClick({target:{closest:()=>f.node('wanami',id)}});await f.c.handleStudentHistoryClick({target:f.node('vq',id)});
  f.c.currentPage='vq-diagnosis';await f.c.handleStudentHistoryClick({target:f.node('vq',id)});
  assert.deepEqual(f.calls,[['showWanamiHistory',id],...(role==='crew'?[]:[['showStudentVQHistory',id],['showStudentVQHistory',id]])]);
 }
});
test('history close controls are restricted to their own current roots and VQ data roots',()=>{
 const f=fixture();const modal=f.root();f.children.add(modal);
 f.c.handleStudentHistoryClick({target:f.node('close-wanami','',f.elements['wanami-history-modal'])});
 f.c.handleStudentHistoryClick({target:f.node('close-wanami')});
 f.c.handleStudentHistoryClick({target:f.node('close-vq','',modal,modal)});assert.equal(modal.removed,true);
 const stale=f.root();f.c.handleStudentHistoryClick({target:f.node('close-vq','',stale,stale)});assert.equal(stale.removed,undefined);
 assert.deepEqual(f.calls,[['closeWanamiHistoryModal']]);
});
test('history guards reject stale content, disabled, invalid role/session/page, empty ID and unknown actions',async()=>{
 const f=fixture();const n=f.node('wanami');f.elements.content=f.root();await f.c.handleStudentHistoryClick({target:n});
 const current=f.node('wanami');current.disabled=true;await f.c.handleStudentHistoryClick({target:current});current.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;await f.c.handleStudentHistoryClick({target:current});}f.c.currentUser={role:'admin'};
 f.c.sessionToken='';await f.c.handleStudentHistoryClick({target:current});f.c.sessionToken='synthetic';f.c.currentPage='today';await f.c.handleStudentHistoryClick({target:current});f.c.currentPage='students';
 await f.c.handleStudentHistoryClick({target:f.node('wanami','')});for(const action of ['constructor','__proto__','showWanamiHistory'])await f.c.handleStudentHistoryClick({target:f.node(action)});assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
});
test('real Wanami history keeps read contract, escapes student name, and handles empty/failure without sensitive logs',async()=>{
 const f=fixture();installRealHistories(f);
 await f.c.handleStudentHistoryClick({target:f.node('wanami')});assert.equal(f.notices.length,1);assert.equal(f.html.length,0);
 f.c.axios.get=async(...args)=>{f.requests.push(args);return {data:{success:true,data:{history:[{year:2026,month:10,count:2}]}}}};
 await f.c.handleStudentHistoryClick({target:f.node('wanami')});assert.equal(f.requests[1][0],'/api/students/SYNTHETIC/wanami-history');assert.ok(f.html[0].includes('Synthetic &lt;student&gt;'));assert.match(f.html[0],/data-student-history-action="close-wanami"/);
 f.c.axios.get=async()=>{throw Error('Synthetic private failure')};await f.c.handleStudentHistoryClick({target:f.node('wanami')});assert.deepEqual(f.logs,[['Error showing Wanami history']]);
});
test('real VQ history keeps chart scheduling and its own close root, with empty/failure behavior',async()=>{
 const f=fixture();installRealHistories(f);await f.c.handleStudentHistoryClick({target:f.node('vq')});assert.equal(f.notices.length,1);assert.equal(f.children.size,0);
 f.c.axios.get=async(...args)=>{f.requests.push(args);return {data:{history:[{student_name:'Synthetic <student>',total_score:75,status:'sent',diagnosis_type:'Synthetic'}]}}};
 await f.c.handleStudentHistoryClick({target:f.node('vq')});const modal=[...f.children][0];assert.equal(modal.attributes['data-student-vq-history'],'');assert.ok(modal.innerHTML.includes('Synthetic &lt;student&gt;'));assert.equal((modal.innerHTML.match(/data-student-history-action="close-vq"/g)||[]).length,2);assert.equal(f.requests[1][0],'/api/vq-diagnosis/student/SYNTHETIC');assert.equal(f.timers[0].delay,100);f.timers[0].callback();assert.deepEqual(f.calls,[['charts',1]]);
 f.c.axios.get=async()=>{throw Error('Synthetic private error')};await f.c.handleStudentHistoryClick({target:f.node('vq')});assert.deepEqual(f.logs.at(-1),['生徒別履歴取得エラー']);assert.ok(f.logs.every(entry=>entry.slice(1).every(value=>typeof value==='number')));assert.equal(JSON.stringify(f.logs).includes('Synthetic private'),false);
});
test('helper status keeps four fixed values, all three roles, and one rerender after content recreation',async()=>{
 const f=fixture();f.c.currentPage='helpers';const i=app.indexOf('async function filterHelpersByStatus(status)'),j=app.indexOf('// Render helper requests list',i);vm.runInContext(app.slice(i,j),f.c);let renders=0;f.c.renderHelpersPage=async()=>renders++;
 for(const value of ['all','pending','accepted','rescheduled']){await f.c.handleHelperStatusClick({target:f.status(value)});assert.equal(f.c.helperStatusFilter,value)}assert.equal(renders,4);
 const old=f.status('pending');f.elements.content=f.root();await f.c.handleHelperStatusClick({target:old});assert.equal(renders,4);
 for(const role of ['admin','leader','crew']){f.c.currentUser={role};await f.c.handleHelperStatusClick({target:f.status('all')})}assert.equal(renders,7);
});
test('helper controls reject disabled, wrong page, missing auth, stale roots and arbitrary status names',async()=>{
 const f=fixture();f.c.currentPage='helpers';const n=f.status('pending');n.disabled=true;await f.c.handleHelperStatusClick({target:n});n.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;await f.c.handleHelperStatusClick({target:n})}f.c.currentUser={role:'admin'};f.c.sessionToken='';await f.c.handleHelperStatusClick({target:n});f.c.sessionToken='synthetic';f.c.currentPage='students';await f.c.handleHelperStatusClick({target:n});f.c.currentPage='helpers';
 for(const value of ['unknown','__proto__','all;submitHelperRequest()'])await f.c.handleHelperStatusClick({target:f.status(value)});assert.equal(f.calls.length,0);
});
test('history data attributes encode quotes and targeted inline handlers disappear without changing send/delete controls',()=>{
 const c={studentId:'Synthetic" <&',student:{student_id:'Synthetic" <&'},studentIdCode:'Synthetic" <&',escapeHtml:value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;')};vm.createContext(c);
 const matches=[...app.matchAll(/data-student-history-id="(\$\{.*?\})"/g)];assert.equal(matches.length,3);for(const match of matches)assert.equal(vm.runInContext('`'+match[1]+'`',c),'Synthetic&quot; &lt;&amp;');
 for(const fn of ['showWanamiHistory','closeWanamiHistoryModal','showStudentVQHistory','filterHelpersByStatus'])assert.equal(new RegExp('onclick="'+fn+'\\(').test(app),false);
 assert.equal(app.includes('onclick="this.closest(\'.fixed\').remove()"'),false);for(const fn of ['submitHelperRequest()','acceptHelperRequest(','deleteHelperRequest('])assert.ok(app.includes('onclick="'+fn));
});

test('root loads the four new delegates after app.js without duplicate entries',async()=>{
 const index=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
 for(const name of ['student-history-events','helper-status-events','schedule-read-events','minutes-read-events']){const marker='<script src="/'+name+'.js?v=';assert.equal(index.split(marker).length-1,1);assert.ok(index.indexOf(marker)>index.indexOf('<script src="/app.js'));}
});

test('VQ stored dates are escaped and path IDs are encoded without altering chart inputs', async()=>{
 const f=fixture();installRealHistories(f);const value='<img/src=x/onerror=synthetic()>';
 const row={student_name:'Synthetic',diagnosis_date:value,total_score:81};
 f.c.axios.get=async(...args)=>{f.requests.push(args);return {data:{history:[row]}}};
 await f.c.showStudentVQHistory('Synthetic/?#');const modal=[...f.children][0];
 assert.ok(modal.innerHTML.includes('&lt;img/src=x/onerror=synthetic()&gt;'));assert.equal(modal.innerHTML.includes(value),false);
 assert.equal(f.requests[0][0],'/api/vq-diagnosis/student/Synthetic%2F%3F%23');
 f.timers[0].callback();assert.deepEqual(f.calls,[['charts',1]]);
});
test('VQ late reads and charts cannot restore private modal after session or page changes',async()=>{
 for(const change of [f=>{f.c.sessionToken='changed'},f=>{f.c.currentPage='dashboard'},f=>{f.c.currentUser={role:'crew'}},f=>{f.elements.content=f.root()}]){
  const f=fixture();installRealHistories(f);let resolve;
  f.c.axios.get=()=>new Promise(r=>{resolve=r});const pending=f.c.showStudentVQHistory('SYNTHETIC');change(f);
  resolve({data:{history:[{student_name:'Synthetic'}]}});await pending;assert.equal(f.children.size,0);assert.equal(f.notices.length,0);
 }
 const f=fixture();installRealHistories(f);f.c.axios.get=async()=>({data:{history:[{student_name:'Synthetic'}]}});
 await f.c.showStudentVQHistory('SYNTHETIC');f.c.sessionToken='changed';f.timers[0].callback();assert.equal(f.calls.length,0);
});
test('VQ row delegate uses cached names and rejects stale, crew and uncached operations',()=>{
 const f=fixture();f.c.currentPage='vq-diagnosis';f.c.vqDiagnosisHistory=[{id:42,student_name:"Synthetic'\"<name>"}];
 f.c.resendVQDiagnosis=(...args)=>f.calls.push(['resend',...args]);f.c.deleteVQHistory=(...args)=>f.calls.push(['delete',...args]);
 const button={root:f.elements.content,dataset:{vqHistoryAction:'delete',vqHistoryId:'42'},closest(){return this}};
 f.c.handleVQHistoryClick({target:button});assert.deepEqual(f.calls,[['delete',42,"Synthetic'\"<name>"]]);
 for(const id of ['0','1.2','999','NaN']){button.dataset.vqHistoryId=id;f.c.handleVQHistoryClick({target:button})}
 button.dataset.vqHistoryId='42';f.c.currentUser={role:'crew'};f.c.handleVQHistoryClick({target:button});
 f.c.currentUser={role:'admin'};button.root=f.root();f.c.handleVQHistoryClick({target:button});assert.equal(f.calls.length,1);
});
test('VQ rendered actions contain only safe IDs and never interpolate stored names into handlers',()=>{
 const f=fixture();f.c.vqDiagnosisHistory=[{id:42,student_name:"Synthetic'\" onmouseover=synthetic()",student_id_code:'SYNTHETIC',total_score:'<synthetic>'},{id:'bad',student_name:'Synthetic'}];f.c.formatDateTime=()=>'-';
 const start=app.indexOf('function renderVQDiagnosisHistoryRows()'),end=app.indexOf('async function resendVQDiagnosis(id)',start);
 vm.runInContext(app.slice(start,end),f.c);const html=f.c.renderVQDiagnosisHistoryRows();
 assert.equal(html.includes('onclick='),false);assert.ok(html.includes('data-vq-history-action="delete" data-vq-history-id="42"'));
 assert.equal(html.includes('data-vq-history-id="bad"'),false);assert.ok(html.includes('&lt;synthetic&gt;'));assert.ok(html.includes('disabled'));
});
