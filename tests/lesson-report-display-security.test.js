import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start, source.indexOf('\n}', start) + 2);
}

test('lesson report rows render stored values as text while preserving PRO layout', () => {
  const context = vm.createContext({escapeHtml, Date});
  vm.runInContext(functionSource('renderLessonReportRow'), context);
  const marker = '<b data-synthetic="stored">value</b>';
  const report = Object.fromEntries(['lesson_date','student_id','student_name','tutor_name','lesson_result','lesson_number','reported_by','pro_curriculum','pro_text_number'].map(key => [key, marker]));
  report.reported_at = '2026-10-28T00:00:00Z';
  const html = context.renderLessonReportRow(report);
  assert.ok(!html.includes(marker));
  assert.equal(html.split(escapeHtml(marker)).length - 1, 7);
  report.lesson_number = 'PROプラン';
  const pro = context.renderLessonReportRow(report);
  assert.ok(pro.includes(escapeHtml(marker) + '<br><span class="text-xs">テキスト' + escapeHtml(marker)));
  assert.ok(!pro.includes('<b data-synthetic'));
});

function statusFixture() {
  const requests = [], logs = [];
  const context = vm.createContext({lessonReportStatusLoadId:0,lessonReportStatus:{},sessionToken:'synthetic-session',currentUser:{id:1},API_BASE:'',
    console:{error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},
    axios:{get:(url, config)=>new Promise((resolve,reject)=>requests.push({url,config,resolve,reject}))}});
  vm.runInContext(functionSource('loadLessonReportStatus'),context);
  return {context, requests, logs};
}
const response = id => ({data:{success:true,data:[{student_id:id,lesson_date:'2026-10-28T00:00:00Z',lesson_result:'synthetic'}]}});

test('lesson report status uses captured credentials and keeps date keys without logging report data', async () => {
  const f=statusFixture(); const pending=f.context.loadLessonReportStatus('2026-10-28');
  assert.equal(f.requests[0].config.headers.Authorization,'Bearer synthetic-session');
  f.requests[0].resolve(response('SYNTHETIC')); await pending;
  assert.equal(f.context.lessonReportStatus['SYNTHETIC-2026-10-28'].lesson_result,'synthetic');
  assert.equal(f.logs.length,0);
});

test('older report status success and failure cannot overwrite a newer request', async () => {
  for (const reject of [false,true]) {
    const f=statusFixture(); const old=f.context.loadLessonReportStatus('old'); const latest=f.context.loadLessonReportStatus('new');
    f.requests[1].resolve(response('NEW')); await latest;
    if(reject)f.requests[0].reject(new Error('PRIVATE_SENTINEL'));else f.requests[0].resolve(response('OLD'));
    await old;
    assert.deepEqual(Object.keys(f.context.lessonReportStatus),['NEW-2026-10-28']); assert.equal(f.logs.length,0);
  }
});

test('changed session or user discards status responses and unauthenticated calls make no request', async () => {
  for(const change of [c=>c.sessionToken='other',c=>c.currentUser={id:2},c=>c.currentUser=null]) {
    const f=statusFixture(); const pending=f.context.loadLessonReportStatus('date'); change(f.context);
    f.requests[0].resolve(response('STALE')); await pending; assert.equal(Object.keys(f.context.lessonReportStatus).length,0);
  }
  const f=statusFixture(); f.context.sessionToken=''; f.context.lessonReportStatus={old:true};
  await f.context.loadLessonReportStatus('date'); assert.equal(f.requests.length,0); assert.equal(Object.keys(f.context.lessonReportStatus).length,0);
});

test('current status failure clears cache and logs only fixed diagnostics', async () => {
  const f=statusFixture(); f.context.lessonReportStatus={old:true}; const pending=f.context.loadLessonReportStatus('date');
  f.requests[0].reject({message:'PRIVATE_SENTINEL',response:{status:500,data:'PRIVATE_SENTINEL'}}); await pending;
  assert.equal(Object.keys(f.context.lessonReportStatus).length,0); assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_SENTINEL'));
});

test('management search is manager-only while existing crew date/detail reads remain available', async () => {
  for(const role of ['crew','admin','leader']) {
    let business=0; const app=new Hono(); installApiAccess(app,{db:async()=>({rows:[{id:1,role,must_change_password:false}]})});
    app.all('/api/*',c=>{business++;return c.json({success:true})});
    for(const path of ['/api/lesson-reports','/api/lesson-reports/','/api/%6cesson-reports']) {
      for(const method of ['GET','HEAD'])assert.equal((await app.request(path,{method,headers:{Authorization:'Bearer '+'a'.repeat(64)}})).status,role==='crew'?403:200);
    }
    if(role==='crew')assert.equal(business,0);
    for(const path of ['/api/lesson-reports/by-date/2026-10-28','/api/lesson-reports/1'])assert.equal((await app.request(path,{headers:{Authorization:'Bearer '+'a'.repeat(64)}})).status,200);
    assert.equal((await app.request('/api/lesson-reports')).status,401);
  }
});

test('daily history and new comments escape author names without changing existing manager controls', async () => {
  const marker='<b data-synthetic="author">author</b>';
  const comment={id:2,commenter_name:marker,content:'Synthetic comment',created_at:'2026-10-28T00:00:00Z'};
  for(const role of ['crew','leader']) {
    const node=parent=>({parent,contains(n){for(;n;n=n.parent)if(n===this)return true;return false},classList:{contains(){return false}}});
    const elements={content:node()};elements.dailyReportHistoryModal=node(elements.content);
    elements.drHistoryBody=Object.assign(node(elements.dailyReportHistoryModal),{innerHTML:''});
    elements['drCommentInput-1']=Object.assign(node(elements.dailyReportHistoryModal),{value:'Synthetic comment'});
    elements['drComments-1']=Object.assign(node(elements.dailyReportHistoryModal),{insertAdjacentHTML(_position,html){this.html=html}});
    const context=vm.createContext({escapeHtml,Date,currentUser:{id:1,role},sessionToken:'synthetic-session',currentPage:'daily-reports',dailyReportViewTutorId:7,dailyHistoryTutorAllowed:()=>true,dailyReportHistoryReadId:0,dailyReportHistory:{tutorId:7,reports:[{id:1,report_date:'2026-10-28',content:'Synthetic report',comments:[comment]}]},document:{getElementById:id=>elements[id]},axios:{post:async()=>({data:{success:true,data:comment}})},showNotification(){},console:{error(){}}});
    vm.runInContext(source.slice(source.indexOf('const dailyReportPendingWrites ='),source.indexOf('function openDailyReportModal(')),context);
    vm.runInContext(functionSource('_renderDailyReportHistoryBody'),context);
    vm.runInContext(functionSource('submitDailyReportComment'),context);
    context._renderDailyReportHistoryBody(); await context.submitDailyReportComment(1);
    for(const html of [elements.drHistoryBody.innerHTML,elements['drComments-1'].html]) {
      assert.ok(html.includes(escapeHtml(marker)));assert.ok(!html.includes(marker));
      assert.equal(html.includes('deleteDailyReportComment('),role==='leader');
    }
    assert.equal(elements['drCommentInput-1'].value,'');
  }
});
