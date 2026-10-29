import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64)};
const row=id=>({calendar_event_id:id,student_id:'SYNTHETIC',tutor_email:'synthetic@example.test',tutor_name:'Synthetic',lesson_date:'2026-10-30',title:'Updated'});
let sequence=0;
async function fixture({sheet=[row('ONE')],failAt=0,failSql,connectFail=false,rollbackFail=false,role='leader'}={}){
 const state={rows:new Map([['ONE','Original'],['OMITTED','Keep']]),staged:null,calls:[],writes:0,releases:0,acquired:0,failAt,failSql};
 const query=async(sql,params)=>{state.calls.push([sql,params]);if(sql.includes('FROM students s'))return{rows:[{student_id:'SYNTHETIC',tutor_email:'synthetic@example.test'}]};throw Error('Unexpected nontransaction query')};
 const client={query:async(sql,params)=>{
  state.calls.push([sql,params]);if(sql==='ROLLBACK'){state.staged=null;if(rollbackFail)throw Error('PRIVATE_SENTINEL');return{rows:[]}}
  if(sql===state.failSql)throw Error('PRIVATE_SENTINEL');
  if(sql==='BEGIN'){state.staged=new Map(state.rows);return{rows:[]}}
  if(sql==='COMMIT'){state.rows=new Map(state.staged);state.staged=null;return{rows:[]}}
  if(sql.includes('INSERT INTO lessons')){assert.ok(state.staged);state.writes++;if(state.writes===state.failAt)throw Error('PRIVATE_SENTINEL');state.staged.set(params[0],params[4]);return{rows:[]}}
  throw Error('Unexpected transaction SQL');
 },release(){state.releases++}};
 const deps={Hono,query,getClient:async()=>{state.acquired++;if(connectFail)throw Error('PRIVATE_SENTINEL');return client},process:{env:{GOOGLE_SHEET_ID:'synthetic'}},console:{log(){},warn(){},error(){}},fetchLessonsFromSheet:async()=>sheet,getLastSyncTime:async()=>({lastSync:'synthetic'}),fetchLessonsForMonth:async()=>[]};
 const source=(await readFile(new URL('../src/routes/lessons.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 const key='atomicLessonSync'+sequence++;globalThis[key]=deps;let routes;
 try{routes=(await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis[${JSON.stringify(key)}];\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
 const app=new Hono();installApiAccess(app,{db:async()=>({rows:[{id:7,email:'synthetic@example.test',role,must_change_password:false}]})});app.route('/api/lessons',routes);return{app,state};
}
test('nonempty partial Sheet updates present rows and keeps omitted lessons without cleanup SQL',async()=>{
 const f=await fixture();const response=await f.app.request('/api/lessons/sync-from-sheet',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.count,1);assert.equal(data.deleted,0);assert.equal(data.cleanup_skipped,true);
 assert.deepEqual([...f.state.rows],[['ONE','Updated'],['OMITTED','Keep']]);assert.equal(f.state.releases,1);assert.deepEqual(f.state.calls.filter(([sql])=>['BEGIN','COMMIT','ROLLBACK'].includes(sql)).map(([sql])=>sql),['BEGIN','COMMIT']);assert.equal(f.state.calls.some(([sql])=>/DELETE|SELECT calendar_event_id/.test(sql)),false);
});
test('late upsert error rolls back earlier updates and releases the same client',async()=>{
 const f=await fixture({sheet:[row('ONE'),row('TWO')],failAt:2});const response=await f.app.request('/api/lessons/sync-from-sheet',{headers});assert.equal(response.status,500);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.deepEqual([...f.state.rows],[['ONE','Original'],['OMITTED','Keep']]);assert.equal(f.state.staged,null);assert.equal(f.state.releases,1);assert.equal(f.state.calls.some(([sql])=>sql==='COMMIT'),false);assert.ok(f.state.calls.some(([sql])=>sql==='ROLLBACK'));
});
test('connection BEGIN COMMIT and rollback errors remain private and release acquired clients',async()=>{
 for(const options of [{connectFail:true},{failSql:'BEGIN'},{failSql:'COMMIT'},{failAt:1,rollbackFail:true}]){
  const f=await fixture(options),response=await f.app.request('/api/lessons/sync-from-sheet',{headers});assert.equal(response.status,500);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.deepEqual([...f.state.rows],[['ONE','Original'],['OMITTED','Keep']]);assert.equal(f.state.releases,options.connectFail?0:1);
 }
});
test('normal manager retry after rollback commits all valid source rows',async()=>{
 const f=await fixture({sheet:[row('ONE'),row('TWO')],failAt:2});assert.equal((await f.app.request('/api/lessons/sync-from-sheet',{headers})).status,500);f.state.failAt=0;assert.equal((await f.app.request('/api/lessons/sync-from-sheet',{headers})).status,200);assert.deepEqual([...f.state.rows],[['ONE','Updated'],['OMITTED','Keep'],['TWO','Updated']]);assert.equal(f.state.releases,2);
});
test('empty source and crew GET HEAD never acquire transaction clients',async()=>{
 for(const method of ['GET','HEAD']){const empty=await fixture({sheet:[]});assert.equal((await empty.app.request('/api/lessons/sync-from-sheet',{headers,method})).status,400);assert.equal(empty.state.acquired,0);const crew=await fixture({role:'crew'});assert.equal((await crew.app.request('/api/lessons/sync-from-sheet',{headers,method})).status,403);assert.equal(crew.state.acquired,0);assert.equal(crew.state.calls.length,0)}
});
