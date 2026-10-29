import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
const headers = { Authorization: 'Bearer ' + 'a'.repeat(64) };
let sequence = 0;
const lesson = { calendar_event_id:'SYNTHETIC_EVENT', student_id:'SYNTHETIC', tutor_email:'synthetic@example.test', tutor_calendar_id:'synthetic@example.test', tutor_name:'Synthetic', lesson_date:'2026-10-29', lesson_time:'12:00' };
async function fixture({ role='leader', sheet=[], calendar=[lesson], sheetFails=false } = {}) {
  const state={queries:[],sheetReads:0,calendarReads:0,metadataReads:0};
  const deps={Hono,process:{env:{GOOGLE_SHEET_ID:'synthetic-sheet'}},console:{log(){},warn(){},error(){}},
    query:async(sql,params)=>{state.queries.push({sql,params});if(sql.includes('FROM students s'))return{rows:[{student_id:lesson.student_id,tutor_email:lesson.tutor_email,homeroom_tutor:'Synthetic'}]};if(sql.includes('SELECT email, notion_name'))return{rows:[{email:lesson.tutor_email,notion_name:'Synthetic'}]};if(sql==='SELECT calendar_event_id FROM lessons')return{rows:[{calendar_event_id:'STALE'}]};return{rows:[]}},
    fetchLessonsForMonth:async()=>{state.calendarReads++;return calendar},fetchLessonsFromSheet:async()=>{state.sheetReads++;if(sheetFails)throw Error('PRIVATE_SENTINEL');return sheet},getLastSyncTime:async()=>{state.metadataReads++;return{lastSync:'synthetic'}}};
  const source=(await readFile(new URL('../src/routes/lessons.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const key='lessonSourceBoundary'+sequence++;globalThis[key]=deps;let routes;
  try{routes=(await import('data:text/javascript;base64,'+Buffer.from(`const {Hono,query,fetchLessonsForMonth,fetchLessonsFromSheet,getLastSyncTime,process,console}=globalThis[${JSON.stringify(key)}];\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
  const app=new Hono();installApiAccess(app,{db:async()=>({rows:[{id:7,email:'synthetic@example.test',role,must_change_password:false}]})});app.route('/api/lessons',routes);return{app,state};
}
test('empty or missing-identifier Sheet source is rejected before any business SQL on GET and HEAD',async()=>{
  for(const sheet of [[],[{}],[{...lesson,calendar_event_id:null}],[{...lesson,calendar_event_id:''}],[{...lesson,calendar_event_id:' '}],[lesson,{...lesson,calendar_event_id:'x\u0000'}]])for(const method of ['GET','HEAD']){
    const f=await fixture({sheet});const response=await f.app.request('/api/lessons/sync-from-sheet',{method,headers});assert.equal(response.status,400);assert.equal(f.state.queries.length,0);assert.equal(f.state.sheetReads,1);
  }
});
test('anonymous and crew stateful GET/HEAD endpoints stop before providers and SQL',async()=>{
  for(const path of ['/sync-from-sheet','/sync/2026/10'])for(const method of ['GET','HEAD']){
    const f=await fixture({role:'crew',sheet:[lesson]});assert.equal((await f.app.request('/api/lessons'+path,{method})).status,401);assert.equal((await f.app.request('/api/lessons'+path,{method,headers})).status,403);assert.equal(f.state.sheetReads+f.state.calendarReads+f.state.metadataReads,0);assert.equal(f.state.queries.length,0);
  }
});
test('normal manager Sheet and Calendar sync preserve upsert and current stale-event cleanup',async()=>{
  for(const role of ['admin','leader']){
    const f=await fixture({role,sheet:[lesson]});const response=await f.app.request('/api/lessons/sync-from-sheet',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.count,1);assert.equal(data.deleted,1);assert.ok(f.state.queries.some(row=>row.sql.includes('INSERT INTO lessons')));assert.deepEqual(f.state.queries.find(row=>row.sql.startsWith('DELETE FROM lessons')).params,['STALE']);
    const g=await fixture({role});assert.equal((await g.app.request('/api/lessons/sync/2026/10',{headers})).status,200);assert.ok(g.state.queries.some(row=>row.sql.includes('INSERT INTO lessons')));
  }
});
test('provider failure keeps prior cache fallback without SQL or private details',async()=>{
  const f=await fixture({sheetFails:true});const response=await f.app.request('/api/lessons/sync-from-sheet',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.cache_error,true);assert.ok(!JSON.stringify(data).includes('PRIVATE_SENTINEL'));assert.equal(f.state.queries.length,0);
});
