import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {installApiAccess,DAILY_REPORT_REQUEST_MAX_BYTES,HELPER_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';

const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
const cases=[
  ['POST','/api/daily-reports',{tutor_id:7,report_date:'2026-10-29',content:'Synthetic report'},'crew'],
  ['POST','/api/daily-reports/1/comments',{content:'Synthetic comment'},'crew'],
  ['PUT','/api/daily-reports/reminder-setting',{enabled:false},'admin'],
  ['POST','/api/helper-requests',{requesting_tutor_id:'E7',student_id:'OWN',reason:'Synthetic'},'crew'],
  ['POST','/api/helper-requests/1/accept',{tutor_id:'E7'},'crew']
];
function fixture(role='crew') {
  const state={parses:0,owners:0,business:0};const app=new Hono();
  app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async(sql,params)=>{
    if(sql.includes('FROM sessions'))return {rows:[{id:7,tutor_id:7,employee_id:'E7',notion_name:'Synthetic Tutor',tutor_name:'Synthetic Tutor',email:'synthetic@example.invalid',role,must_change_password:false}]};
    if(sql.includes('FROM students')){state.owners++;return {rows:params[0]==='OWN'?[{student_id:'OWN'}]:[]};}
    throw Error('Unexpected fixture query');
  }});
  const handler=async c=>{state.business++;return c.json({body:await c.req.json(),actor:c.get('authenticatedUser')?.id})};
  app.post('/api/daily-reports/:id/comments',handler);
  app.post('/api/helper-requests/:id/accept',handler);
  app.all('/api/*',handler);
  return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const request=(method,path,body,extra={})=>new Request('http://fixture.invalid'+path,{method,body,headers:{...headers,...extra},duplex:'half'});

test('daily/helper declared size rejection precedes all JSON parsing, ownership and business calls',async()=>{
  assert.equal(DAILY_REPORT_REQUEST_MAX_BYTES,262144);assert.equal(HELPER_REQUEST_MAX_BYTES,262144);
  for(const [method,path,,role] of cases) {
    const f=fixture(role),s=stream([new Uint8Array(1)]);
    const response=await f.app.request(request(method,path,s.body,{'Content-Length':'262145'}));
    assert.equal(response.status,413,path);assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.owners,0);assert.equal(f.state.business,0);
    assert.ok(!(await response.text()).includes('Image upload'));
  }
});

test('daily/helper missing or false declared size still counts actual chunks',async()=>{
  for(const [method,path,,role] of cases)for(const declared of [undefined,'1']) {
    const f=fixture(role),s=stream([new Uint8Array(131072),new Uint8Array(131073)]);
    assert.equal((await f.app.request(request(method,path,s.body,declared?{'Content-Length':declared}:{}))).status,413,path);
    assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.owners,0);assert.equal(f.state.business,0);
  }
});

test('encoded slash route parameters cannot bypass manager caps and crew still rejects without reading',async()=>{
  for(const path of ['/api/daily-reports/%2F/comments','/api/helper-requests/%2F/accept']){
    for(const role of ['admin','leader','crew']){
      for(const declared of [true,false]){
        const f=fixture(role),s=stream([new Uint8Array(262145)]);
        const response=await f.app.request(request('POST',path,s.body,declared?{'Content-Length':'262145'}:{}));
        assert.equal(response.status,role==='crew'?403:413);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);
        if(declared||role==='crew')assert.equal(s.seen.pulls,0);
      }
    }
  }
});

test('unauthenticated, forbidden reminder and invalid crew operations reject without reading',async()=>{
  for(const [method,path,,role] of cases) {
    const f=fixture(role),s=stream([new Uint8Array(1)]);
    assert.equal((await f.app.request(new Request('http://fixture.invalid'+path,{method,body:s.body,duplex:'half'}))).status,401);
    assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);
  }
  for(const [method,path] of [['PUT','/api/daily-reports/reminder-setting'],['POST','/api/helper-requests/not-id/accept'],['POST','/api/daily-reports/not-id/comments']]) {
    const f=fixture(),s=stream([new Uint8Array(1)]);
    assert.equal((await f.app.request(request(method,path,s.body,{'Content-Length':'262145'}))).status,403);
    assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);
  }
});

test('normal and exact-size bodies preserve trusted actor and existing owner checks',async()=>{
  for(const [method,path,body,role] of cases) {
    for(const exact of [false,true]) {
      const f=fixture(role);const data={...body,padding:''};
      if(exact)data.padding='x'.repeat(262144-Buffer.byteLength(JSON.stringify(data)));
      const encoded=JSON.stringify(data);if(exact)assert.equal(Buffer.byteLength(encoded),262144);
      const response=await f.app.request(request(method,path,encoded));assert.equal(response.status,200,path);assert.equal((await response.json()).actor,7);assert.equal(f.state.business,1);
    }
  }
  for(const [path,body] of [['/api/daily-reports',{tutor_id:8}],['/api/helper-requests',{requesting_tutor_id:'E8',student_id:'OWN'}],['/api/helper-requests',{requesting_tutor_id:'E7',student_id:'OTHER'}],['/api/helper-requests/1/accept',{tutor_id:'E8'}]]) {
    const f=fixture();assert.equal((await f.app.request(request('POST',path,JSON.stringify(body)))).status,403);assert.equal(f.state.business,0);
  }
});

test('broken bodies return private errors and unrelated authenticated bodies are not capped',async()=>{
  for(const [method,path,,role] of cases) {
    const f=fixture(role),body=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});
    const response=await f.app.request(request(method,path,body));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(f.state.business,0);
  }
  const f=fixture('admin');assert.equal((await f.app.request(request('POST','/api/unrelated',JSON.stringify({padding:'x'.repeat(262145)})))).status,200);
});
