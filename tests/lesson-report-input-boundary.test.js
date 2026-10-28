import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess, LESSON_REPORT_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
import {formatLessonLabel, resolveLessonReference} from '../src/services/lessonReferenceService.js';

const token='a'.repeat(64), headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const report={student_id:'OWN',lesson_date:'2026-10-29',lesson_result:'実施済み',lesson_number:'1'};
let sequence=0;
async function fixture(role='crew') {
  const state={parses:0,owned:0,queries:[]};
  const deps={Hono,formatLessonLabel,resolveLessonReference,query:async(sql,params)=>{
    state.queries.push({sql,params});return {rows:sql.includes('COUNT(*)')?[{total:'1'}]:[report]};
  }};
  let source=await readFile(new URL('../src/routes/lessonReports.js',import.meta.url),'utf8');
  source=source.replace("import { Hono } from 'hono';",'const {Hono}=deps;')
    .replace("import { query } from '../db/connection.js';",'const {query}=deps;')
    .replace(/import \{\s*formatLessonLabel,\s*resolveLessonReference\s*\} from '..\/services\/lessonReferenceService.js';/,'const {formatLessonLabel,resolveLessonReference}=deps;');
  const key='reportInputBoundary'+sequence++;globalThis[key]=deps;
  let routes;
  try {routes=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const console={log(){},error(){}};\n`+source).toString('base64'))).default;}
  finally {delete globalThis[key];}
  const app=new Hono();
  app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async(sql,params)=>{
    if(sql.includes('FROM sessions'))return {rows:[{id:1,role,email:'synthetic@example.invalid',notion_name:'Synthetic Tutor',tutor_name:'Synthetic Tutor',must_change_password:false}]};
    if(sql.includes('FROM students')){state.owned++;return {rows:params[0]==='OWN'?[{student_id:'OWN'}]:[]};}
    throw Error('Unexpected authentication query');
  }});
  app.route('/api/lesson-reports',routes);
  return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const post=(body,extra={})=>new Request('http://fixture.invalid/api/lesson-reports',{method:'POST',headers:{...headers,...extra},body,duplex:'half'});

test('report byte limit follows authentication and precedes ownership JSON parsing or SQL',async()=>{
  const f=await fixture();
  const anonymous=stream([new Uint8Array(1)]);
  assert.equal((await f.app.request(new Request('http://fixture.invalid/api/lesson-reports',{method:'POST',body:anonymous.body,duplex:'half'}))).status,401);
  assert.equal(anonymous.seen.pulls,0);
  const declared=stream([new Uint8Array(1)]);
  const r=await f.app.request(post(declared.body,{'Content-Length':String(LESSON_REPORT_REQUEST_MAX_BYTES+1)}));
  assert.equal(r.status,413);assert.equal((await r.json()).error,'Lesson report request too large');
  assert.equal(declared.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.owned,0);assert.equal(f.state.queries.length,0);
});

test('missing or false length is counted from actual chunks and oversized report never reaches parser',async()=>{
  for(const length of [undefined,'1']) {
    const f=await fixture('leader'), s=stream([new Uint8Array(128*1024),new Uint8Array(128*1024+1)]);
    assert.equal((await f.app.request(post(s.body,length?{'Content-Length':length}:{}))).status,413);
    assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.queries.length,0);
  }
});

test('exact byte boundary and normal PRO reports preserve trusted identities and ownership',async()=>{
  const base=JSON.stringify({...report,padding:''});
  const exact=JSON.stringify({...report,padding:'x'.repeat(LESSON_REPORT_REQUEST_MAX_BYTES-Buffer.byteLength(base))});
  assert.equal(Buffer.byteLength(exact),LESSON_REPORT_REQUEST_MAX_BYTES);
  for(const role of ['crew','leader']) {
    const f=await fixture(role); assert.equal((await f.app.request(post(exact))).status,200);
    assert.equal(f.state.owned,role==='crew'?1:0);assert.equal(f.state.queries[0].params[6],'synthetic@example.invalid');
  }
  const own=await fixture();assert.equal((await own.app.request(post(JSON.stringify({...report,student_id:'OTHER'})))).status,403);assert.equal(own.state.queries.length,0);
  const f=await fixture();assert.equal((await f.app.request(post(JSON.stringify({...report,lesson_number:'PROプラン',pro_curriculum:'バズコンテンツ量産術',pro_text_number:'1'})))).status,200);
});

test('broken streams and invalid JSON/object shapes fail privately without business writes',async()=>{
  const f=await fixture('admin');const body=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});
  const r=await f.app.request(post(body));assert.equal(r.status,400);assert.ok(!(await r.text()).includes('PRIVATE_SENTINEL'));
  for(const json of ['{','null','[]','"string"','1'])assert.equal((await f.app.request(post(json))).status,400);
  assert.equal(f.state.queries.length,0);
});

test('read references retain shared crew access but reject invalid calendar dates and identifiers before SQL',async()=>{
  const f=await fixture();
  for(const path of ['/by-date/2026-02-30','/by-date/2026-13-01','/OWN/2026-02-29','/OWN/not-date','/%20/2026-10-29','/'+('x'.repeat(256))+'/2026-10-29']) {
    assert.equal((await f.app.request('/api/lesson-reports'+path,{headers})).status,400);
  }
  assert.equal(f.state.queries.length,0);
  for(const path of ['/by-date/2024-02-29','/OWN/2026-10-29'])assert.equal((await f.app.request('/api/lesson-reports'+path,{headers})).status,200);
  assert.equal(f.state.queries.length,2);
});

test('management pagination bounds invalid filters without SQL and preserves bound search params',async()=>{
  const f=await fixture('leader');
  for(const query of ['limit=0','limit=1001','limit=1.5','limit=1e2','limit=','offset=-1','offset=1.5','offset=9007199254740992','start_date=2026-02-30','start_date=2026-10-29&end_date=2026-10-28','tutor_name='+('a'.repeat(256))])assert.equal((await f.app.request('/api/lesson-reports?'+query,{headers})).status,400);
  assert.equal(f.state.queries.length,0);
  for(const query of ['','limit=1000&offset=0','limit=50&offset=100&student_id=OWN&tutor_name=Synthetic&start_date=2026-10-01&end_date=2026-10-29'])assert.equal((await f.app.request('/api/lesson-reports?'+query,{headers})).status,200);
  assert.deepEqual(f.state.queries.at(-2).params,['2026-10-01','2026-10-29','%OWN%','%Synthetic%','50','100']);
  const crew=await fixture();assert.equal((await crew.app.request('/api/lesson-reports?limit=1001',{headers})).status,403);assert.equal(crew.state.queries.length,0);
});
