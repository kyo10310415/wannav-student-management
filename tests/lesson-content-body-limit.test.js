import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {installApiAccess,LESSON_CONTENT_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
const paths=[['POST','/api/lesson-contents'],['POST','/api/lesson-contents/bulk'],['PUT','/api/lesson-contents/Pro_バズ_1'],['PUT','/api/lesson-contents/%2F']];
function fixture(role='admin') {
  const state={parses:0,business:0};const app=new Hono();
  app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async()=>({rows:[{id:7,role,must_change_password:false}]})});
  const handler=async c=>{state.business++;return c.json({body:await c.req.json()})};
  app.post('/api/lesson-contents',handler);app.post('/api/lesson-contents/bulk',handler);app.put('/api/lesson-contents/:number',handler);app.put('/api/other',async c=>c.json({bytes:(await c.req.arrayBuffer()).byteLength}));
  return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const request=(method,path,body,extra={})=>new Request('http://fixture.invalid'+path,{method,body,headers:{...headers,...extra},duplex:'half'});

test('lesson content caps follow authentication and manager role, before JSON and business logic',async()=>{
  assert.equal(LESSON_CONTENT_REQUEST_MAX_BYTES,1048576);
  for(const [method,path] of paths){
    const f=fixture(),anonymous=stream([new Uint8Array(1)]);assert.equal((await f.app.request(new Request('http://fixture.invalid'+path,{method,body:anonymous.body,duplex:'half'}))).status,401);assert.equal(anonymous.seen.pulls,0);
    const crew=fixture('crew'),s=stream([new Uint8Array(1)]);assert.equal((await crew.app.request(request(method,path,s.body,{'Content-Length':'1048577'}))).status,403);assert.equal(s.seen.pulls,0);
    for(const role of ['admin','leader']){const f=fixture(role),s=stream([new Uint8Array(1)]);assert.equal((await f.app.request(request(method,path,s.body,{'Content-Length':'1048577'}))).status,413);assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);}
  }
});

test('actual size is counted despite missing or false declared length for all save routes',async()=>{
  for(const [method,path] of paths)for(const declared of [undefined,'1']){
    const f=fixture(),s=stream([new Uint8Array(524288),new Uint8Array(524289)]);
    assert.equal((await f.app.request(request(method,path,s.body,declared?{'Content-Length':declared}:{}))).status,413);assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.business,0);
  }
});

test('one MiB boundary and ordinary/bulk payloads retain existing JSON',async()=>{
  for(const [method,path] of paths){
    const f=fixture('leader'),data=path.endsWith('/bulk')?{items:[{lesson_number:'Pro_バズ_1',title:'Synthetic',content:'Synthetic'}],padding:''}:{lesson_number:'1',title:'Synthetic',content:'Synthetic',padding:''};
    data.padding='x'.repeat(1048576-Buffer.byteLength(JSON.stringify(data)));
    const response=await f.app.request(request(method,path,JSON.stringify(data)));assert.equal(response.status,200);assert.equal((await response.json()).body.title,data.title);assert.equal(f.state.business,1);
  }
});

test('broken content stream is private and unrelated manager route is not capped',async()=>{
  const f=fixture(),body=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});
  const response=await f.app.request(request('POST','/api/lesson-contents',body));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(f.state.business,0);
  assert.equal((await f.app.request(request('PUT','/api/other',new Uint8Array(1048577)))).status,200);
});
