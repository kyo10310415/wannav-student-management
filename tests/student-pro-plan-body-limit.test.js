import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {installApiAccess,STUDENT_PRO_PLAN_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
function fixture(role='crew') {
  const state={ownership:0,parses:0,business:0};const app=new Hono();
  app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async(sql,params)=>{
    if(sql.includes('FROM sessions'))return {rows:[{id:7,role,notion_name:'Synthetic Tutor',email:'synthetic@example.invalid',must_change_password:false}]};
    if(sql.includes('FROM students')){state.ownership++;return {rows:params[0]==='OWN'?[{student_id:'OWN'}]:[]};}
    throw Error('Unexpected query');
  }});
  app.patch('/api/students/:id/pro-plan',async c=>{state.business++;return c.json({body:await c.req.json(),actor:c.get('authenticatedUser').id})});
  app.patch('/api/other',async c=>c.json({size:(await c.req.arrayBuffer()).byteLength}));
  return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const request=(path,body,extra={})=>new Request('http://fixture.invalid'+path,{method:'PATCH',headers:{...headers,...extra},body,duplex:'half'});

test('PRO cap follows authentication and crew ownership, rejects declared excess without pulling or parsing',async()=>{
  assert.equal(STUDENT_PRO_PLAN_REQUEST_MAX_BYTES,262144);
  const anon=fixture(),a=stream([new Uint8Array(1)]);
  assert.equal((await anon.app.request(new Request('http://fixture.invalid/api/students/OWN/pro-plan',{method:'PATCH',body:a.body,duplex:'half'}))).status,401);assert.equal(a.seen.pulls,0);
  const foreign=fixture(),s=stream([new Uint8Array(1)]);
  assert.equal((await foreign.app.request(request('/api/students/OTHER/pro-plan',s.body,{'Content-Length':'262145'}))).status,403);assert.equal(s.seen.pulls,0);assert.equal(foreign.state.parses,0);
  for(const role of ['crew','leader','admin']){
    const f=fixture(role),body=stream([new Uint8Array(1)]);const response=await f.app.request(request('/api/students/OWN/pro-plan',body.body,{'Content-Length':'262145'}));
    assert.equal(response.status,413);assert.equal(body.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);assert.equal(f.state.ownership,role==='crew'?1:0);
  }
});

test('actual streamed size is bounded despite missing or false length',async()=>{
  for(const declared of [undefined,'1']){
    const f=fixture(),s=stream([new Uint8Array(131072),new Uint8Array(131073)]);
    assert.equal((await f.app.request(request('/api/students/OWN/pro-plan',s.body,declared?{'Content-Length':declared}:{}))).status,413);
    assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);
  }
});

test('encoded slash parameter is capped for managers and remains forbidden for crew',async()=>{
  for(const role of ['admin','leader','crew'])for(const declared of [true,false]){
    const f=fixture(role),s=stream([new Uint8Array(262145)]);
    assert.equal((await f.app.request(request('/api/students/%2F/pro-plan',s.body,declared?{'Content-Length':'262145'}:{}))).status,role==='crew'?403:413);
    assert.equal(f.state.parses,0);assert.equal(f.state.business,0);if(declared||role==='crew')assert.equal(s.seen.pulls,0);
  }
});

test('normal and exact-limit input preserve dates/null and trusted actor',async()=>{
  for(const role of ['crew','leader','admin'])for(const proPlanStartDate of ['2026-10-29',null]){
    const f=fixture(role),body={proPlanStartDate,padding:''};const prefix=JSON.stringify(body);body.padding='x'.repeat(262144-Buffer.byteLength(prefix));
    const response=await f.app.request(request('/api/students/OWN/pro-plan',JSON.stringify(body)));assert.equal(response.status,200);const result=await response.json();assert.equal(result.body.proPlanStartDate,proPlanStartDate);assert.equal(result.actor,7);
  }
});

test('broken PRO stream is private and unrelated authenticated routes retain their existing body contract',async()=>{
  const f=fixture('admin'),body=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});
  const response=await f.app.request(request('/api/students/OWN/pro-plan',body));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(f.state.business,0);
  assert.equal((await f.app.request(request('/api/other',new Uint8Array(262145)))).status,200);
});
