import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fn(name){let a=source.indexOf(`async function ${name}(`);if(a<0)a=source.indexOf(`function ${name}(`);return source.slice(a,source.indexOf('\n}',a)+2)}
function fixture(){
 const requests=[],notices=[],logs=[],renders=[];
 const node=parent=>({parent,innerHTML:'Original',value:'',disabled:false,classList:{hidden:false,add(){this.hidden=true},remove(){this.hidden=false},contains(){return this.hidden}},contains(n){for(;n;n=n.parent)if(n===this)return true;return false},insertAdjacentHTML(_where,html){this.html=html}});
 const elements={content:node(),loading:node()};
 for(const id of ['dailyReportModal','dailyReportHistoryModal'])elements[id]=node(elements.content);
 for(const id of ['drModalDate','drModalContent','drModalSubmitBtn','drModalTutorName'])elements[id]=node(elements.dailyReportModal);
 for(const id of ['drCommentInput-1','drComments-1'])elements[id]=node(elements.dailyReportHistoryModal);
 elements.drModalDate.value='2026-10-29';elements.drModalContent.value='Synthetic report';elements['drCommentInput-1'].value='Synthetic comment';
 const history={tutorId:7,reports:[{id:1}]};
 const c={sessionToken:'synthetic-session',currentUser:{id:7,role:'crew'},currentPage:'daily-reports',_drCurrentTutorId:7,_drCurrentTutorName:'Synthetic',dailyReportViewTutorId:7,dailyReportHistory:history,dailyReportTutors:[],dailyReportReminderEnabled:true,Date,
  document:{getElementById:id=>elements[id]??null},
  dailyHistoryTutorAllowed:id=>Number(id)===7,escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  showNotification:(...args)=>notices.push(args),console:{error:(...args)=>logs.push(args)},
  renderDailyReportsPage:async current=>renders.push(current),_renderDailyReportsContent:()=>renders.push('render'),
  axios:{post:(url,body,options)=>new Promise((resolve,reject)=>requests.push({url,body,options,resolve,reject})),get:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let dailyReportModalGeneration ='),source.indexOf('function openDailyReportModal(')),c);
 for(const name of ['openDailyReportModal','closeDailyReportModal','submitDailyReport','submitDailyReportComment'])vm.runInContext(fn(name),c);
 const resolve=(i=0,data={})=>requests[i].resolve({data:{success:true,data:{id:2,content:'Synthetic comment',commenter_name:'<b>Synthetic</b>',created_at:'2026-10-29'},...data}});
 return {c,elements,history,requests,notices,logs,renders,node,resolve};
}

test('daily submit preserves actor, payload and normal successful completion',async()=>{
 const f=fixture();const pending=f.c.submitDailyReport();assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');
 assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].body)),{tutor_id:7,report_date:'2026-10-29',content:'Synthetic report'});
 f.resolve();await pending;assert.equal(f.elements.dailyReportModal.classList.hidden,true);assert.equal(f.notices[0][0],'日報を提出しました');assert.equal(f.renders.length,1);assert.equal(f.renders[0](),true);assert.equal(f.elements.drModalSubmitBtn.disabled,false);
});

test('daily submit prevents duplicate pending writes and rejects old replacement controls',async()=>{
 const f=fixture();const pending=f.c.submitDailyReport();await f.c.submitDailyReport();assert.equal(f.requests.length,1);
 f.elements.drModalSubmitBtn=f.node(f.elements.dailyReportModal);await f.c.submitDailyReport();assert.equal(f.requests.length,1);
 f.resolve();await pending;assert.equal(f.notices.length,0);assert.equal(f.renders.length,0);
});

test('submit ignores stale auth, targets, changed drafts and close/reopen of the same tutor',async()=>{
 for(const change of [f=>f.c.sessionToken='other',f=>f.c.currentUser={id:8,role:'crew'},f=>f.c.currentUser.role='leader',f=>f.c.currentPage='students',f=>f.elements.content=f.node(),f=>f.c._drCurrentTutorId=8,f=>f.elements.drModalDate.value='2026-10-28',f=>f.elements.drModalContent.value='NEW',f=>{f.c.closeDailyReportModal();f.c.openDailyReportModal(7,'Synthetic','2026-10-29');f.elements.drModalContent.value='Synthetic report'}]){
  const f=fixture();const pending=f.c.submitDailyReport();change(f);f.resolve();await pending;assert.equal(f.notices.length,0);assert.equal(f.renders.length,0);
 }
});

test('comment writes preserve displayed report, captured author and escaped new author markup',async()=>{
 const f=fixture();const pending=f.c.submitDailyReportComment(1);await f.c.submitDailyReportComment(1);assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].body.user_id,7);assert.equal(f.requests[0].options.headers.Authorization,'Bearer synthetic-session');
 f.resolve();await pending;assert.equal(f.elements['drCommentInput-1'].value,'');assert.equal(f.elements['drCommentInput-1'].disabled,false);assert.ok(f.elements['drComments-1'].html.includes('&lt;b&gt;Synthetic&lt;/b&gt;'));assert.equal(f.notices.length,1);
});

test('comment stale history, closed modal, input/root and auth changes never clear or append',async()=>{
 for(const change of [f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentPage='students',f=>f.c.dailyReportHistory={tutorId:7,reports:[{id:1}]},f=>f.c.dailyReportViewTutorId=8,f=>f.elements.dailyReportHistoryModal.classList.hidden=true,f=>f.elements['drCommentInput-1'].value='NEW',f=>f.elements['drComments-1']=f.node(f.elements.dailyReportHistoryModal),f=>f.elements.content=f.node()]){
  const f=fixture();const pending=f.c.submitDailyReportComment(1);change(f);f.resolve();await pending;assert.equal(f.notices.length,0);assert.equal(f.elements['drComments-1'].html,undefined);assert.notEqual(f.elements['drCommentInput-1'].value,'');
 }
});

test('non-displayed, unauthenticated, closed or unowned targets cannot start writes',async()=>{
 for(const change of [f=>f.c.currentUser={id:7,role:'unknown'},f=>f.c.currentUser=null,f=>f.c.sessionToken='',f=>f.c.currentPage='students',f=>f.c.dailyHistoryTutorAllowed=()=>false]){
  const f=fixture();change(f);await f.c.submitDailyReport();await f.c.submitDailyReportComment(1);assert.equal(f.requests.length,0);
 }
 const f=fixture();await f.c.submitDailyReportComment(2);f.elements.dailyReportModal.classList.hidden=true;await f.c.submitDailyReport();assert.equal(f.requests.length,0);
});

test('current failures keep drafts and fixed diagnostics while stale failures remain silent',async()=>{
 for(const comment of [false,true])for(const stale of [false,true]){
  const f=fixture();const pending=comment?f.c.submitDailyReportComment(1):f.c.submitDailyReport();if(stale)f.c.currentPage='students';
  f.requests[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'<b>PRIVATE_SENTINEL</b>'}}}));await pending;
  assert.equal(f.notices.length,stale?0:1);assert.ok(!JSON.stringify([f.logs,f.notices]).includes('PRIVATE_SENTINEL'));assert.notEqual(f.elements[comment?'drCommentInput-1':'drModalContent'].value,'');
 }
});

test('submit refresh cannot render or replace data after another modal opens during fetch',async()=>{
 const f=fixture();vm.runInContext(fn('renderDailyReportsPage'),f.c);const pending=f.c.submitDailyReport();f.resolve();await new Promise(setImmediate);assert.equal(f.requests.length,3);
 f.c.openDailyReportModal(7,'New preparation','2026-10-29');f.elements.drModalContent.value='NEW';
 f.requests[1].resolve({data:{success:true,data:[{tutor_id:9}]}});f.requests[2].resolve({data:{enabled:false}});await pending;
 assert.equal(f.renders.length,0);assert.equal(f.c.dailyReportTutors.length,0);assert.equal(f.elements.drModalContent.value,'NEW');
});
