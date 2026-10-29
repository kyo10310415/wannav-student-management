import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';

const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
const normal={lesson_date:'2026-10-29',lesson_time:'17:00',student_id:'OWN',student_name:'Synthetic Student',notion_url:'https://example.invalid/',requesting_tutor_id:'E7',requesting_tutor_name:'Synthetic Tutor',lesson_progress:3,reason:'Synthetic reason',notes:'Synthetic notes',deadline:'2099-01-01T12:00:00.123Z'};
let sequence=0;
async function fixture(role='admin') {
  const queries=[],notifications=[],authQueries=[];
  const actor={id:7,role,employee_id:'E7',tutor_name:'Synthetic Tutor',notion_name:'Synthetic Tutor',email:'synthetic@example.invalid',must_change_password:false};
  const deps={Hono,query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes('SELECT *')?[{id:42,deadline:'2099-01-01T00:00:00Z',status:'pending'}]:[{id:42,...normal}]};},notifyHelperRequestCreated:async row=>notifications.push(row)};
  let source=await readFile(new URL('../src/routes/helper-requests.js',import.meta.url),'utf8');
  source=source.replace(/import \{\s*([^}]+)\} from '[^']+';/g,(_,names)=>`const {${names}}=deps;`);
  const key='helperFields'+sequence++;globalThis[key]=deps;let route;
  try {route=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const console={log(){},error(){}};\n`+source).toString('base64'))).default;}
  finally {delete globalThis[key];}
  const app=new Hono();installApiAccess(app,{db:async(sql,params)=>{authQueries.push({sql,params});if(sql.includes('FROM sessions'))return {rows:[actor]};if(sql.includes('FROM students'))return {rows:params[0]==='OWN'?[{student_id:'OWN'}]:[]};throw Error('Unexpected authentication query');}});app.route('/api/helper-requests',route);
  return {app,queries,notifications,authQueries};
}
const post=(body)=>({method:'POST',headers,body:JSON.stringify(body)});

test('schema-required create text and real calendar date/deadline reject before business SQL or notification',async()=>{
  const f=await fixture();
  const changes=[{lesson_date:null},{lesson_date:'2026-02-30'},{lesson_date:'0000-01-01'},{lesson_date:'2026-1-01'},
    {student_id:''},{student_id:' '},{student_id:7},{student_name:[]},{student_name:' '},{reason:{}},{reason:''},
    {deadline:null},{deadline:'infinity'},{deadline:'2099-02-30T12:00:00Z'},{deadline:'2099-01-01T25:00:00Z'},{deadline:'2099-01-01T12:61:00Z'},{deadline:'2099-01-01T12:00:00+16:00'}];
  for(const change of changes)assert.equal((await f.app.request('/api/helper-requests',post({...normal,...change}))).status,400,JSON.stringify(change));
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);
});

test('optional SQL field types, NULs, varchar lengths and integer range reject without partial insertion',async()=>{
  const f=await fixture();
  const changes=[{lesson_time:{}},{lesson_time:'a'.repeat(51)},{student_id:'a'.repeat(101)},{student_name:'a'.repeat(201)},
    {notion_url:{}},{notes:[]},{notes:'synthetic\u0000text'},{reason:'synthetic\u0000reason'},{requesting_tutor_id:7},{requesting_tutor_id:'a'.repeat(101)},
    {requesting_tutor_name:{}},{requesting_tutor_name:'a'.repeat(201)},{lesson_progress:{}},{lesson_progress:'3.5'},{lesson_progress:3.5},{lesson_progress:2147483648},{lesson_progress:-2147483649}];
  for(const change of changes)assert.equal((await f.app.request('/api/helper-requests',post({...normal,...change}))).status,400);
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);
});

test('normal ISO/SQL date formats, past deadlines and offsets keep original values and existing counters',async()=>{
  for(const deadline of ['2099-01-01T12:00:00.123Z','2099-01-01T12:00+09:00','2099-01-01 12:00:00','2099-01-01T12:00:00-0330','2099-01-01','2000-01-01T00:00:00Z','2099-01-01T24:00:00Z']){
    const f=await fixture();const response=await f.app.request('/api/helper-requests',post({...normal,deadline}));assert.equal(response.status,200,deadline);
    assert.equal(f.queries[0].params[10],deadline);assert.equal(f.queries.length,2);assert.equal(f.notifications.length,1);
    assert.ok(f.queries[1].sql.includes('helper_request_count = COALESCE(helper_request_count, 0) + 1'));
  }
});

test('nullable schema fields remain optional, numeric integer text and Unicode varchar boundaries remain accepted',async()=>{
  const f=await fixture();const body={...normal,student_id:'😀'.repeat(100),student_name:'名'.repeat(200),lesson_progress:'-2147483648'};
  for(const field of ['lesson_time','notion_url','requesting_tutor_id','requesting_tutor_name','notes'])delete body[field];
  assert.equal((await f.app.request('/api/helper-requests',post(body))).status,200);assert.equal(f.queries[0].params[7],'-2147483648');
  const g=await fixture();assert.equal((await g.app.request('/api/helper-requests',post({...normal,lesson_progress:null,notes:null,lesson_time:null}))).status,200);assert.equal(g.queries[0].params[7],null);
});

test('crew fields come from authenticated identity and invalid remaining input still stops before writes',async()=>{
  const f=await fixture('crew');
  assert.equal((await f.app.request('/api/helper-requests',post({...normal,requesting_tutor_name:{forged:true},notes:{bad:true}}))).status,400);
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);
  assert.equal((await f.app.request('/api/helper-requests',post({...normal,requesting_tutor_name:{forged:true}}))).status,200);
  assert.deepEqual(f.queries[0].params.slice(5,7),['E7','Synthetic Tutor']);
  const denied=await fixture('crew');assert.equal((await denied.app.request('/api/helper-requests',post({...normal,student_id:'OTHER'}))).status,403);assert.equal(denied.queries.length,0);assert.equal(denied.notifications.length,0);
});

test('accept requires selected employee ID and checks schema types before pending request lookup',async()=>{
  const f=await fixture();
  for(const body of [{},{tutor_id:null},{tutor_id:' '},{tutor_id:7},{tutor_id:{}},{tutor_id:'a'.repeat(101)},{tutor_id:'EMP-1',tutor_name:{}},{tutor_id:'EMP-1',tutor_name:'a'.repeat(201)}])assert.equal((await f.app.request('/api/helper-requests/42/accept',post(body))).status,400);
  assert.equal(f.queries.length,0);assert.equal(f.notifications.length,0);
  assert.equal((await f.app.request('/api/helper-requests/42/accept',post({tutor_id:'EMP-1',tutor_name:'Synthetic Tutor'}))).status,200);
  assert.deepEqual(f.queries[1].params,['EMP-1','Synthetic Tutor','42']);assert.equal(f.notifications.length,0);
});

test('crew accept uses trusted employee/name and preserves pending predicate without notification',async()=>{
  const f=await fixture('crew');assert.equal((await f.app.request('/api/helper-requests/42/accept',post({tutor_id:'E7',tutor_name:{forged:true}}))).status,200);
  assert.deepEqual(f.queries[1].params,['E7','Synthetic Tutor','42']);assert.ok(f.queries[1].sql.includes("WHERE id = $3 AND status = 'pending'"));assert.equal(f.queries.length,3);assert.equal(f.notifications.length,0);
});
