import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess,SETTINGS_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
let sequence=0;
async function fixture(role='admin',email='trusted@example.invalid') {
  const state={queries:[],parses:0};
  const deps={Hono,getPool:()=>({query:async(sql,params)=>{
    state.queries.push({sql,params});
    return {rows:[{setting_key:params[2],setting_value:params[0],updated_by:params[1]}]};
  }})};
  let source=await readFile(new URL('../src/routes/settings.js',import.meta.url),'utf8');source=source.replace("import { Hono } from 'hono';",'const {Hono}=deps;').replace("import { getPool } from '../db/connection.js';",'const {getPool}=deps;');
  const key='settingsBoundary'+sequence++;globalThis[key]=deps;let routes;
  try{routes=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const console={log(){},error(){}};\n`+source).toString('base64'))).default;}finally{delete globalThis[key];}
  const app=new Hono();app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async()=>({rows:[{id:7,email,role,must_change_password:false}]})});app.route('/api/settings',routes);return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const request=(path,body,extra={})=>new Request('http://fixture.invalid'+path,{method:'PUT',headers:{...headers,...extra},body,duplex:'half'});

test('settings auth/manager checks precede body reads and declared excess precedes JSON or settings SQL',async()=>{
  assert.equal(SETTINGS_REQUEST_MAX_BYTES,262144);
  const f=await fixture(),s=stream([new Uint8Array(1)]);
  assert.equal((await f.app.request(new Request('http://fixture.invalid/api/settings/key',{method:'PUT',body:s.body,duplex:'half'}))).status,401);assert.equal(s.seen.pulls,0);
  const crew=await fixture('crew'),c=stream([new Uint8Array(1)]);assert.equal((await crew.app.request(request('/api/settings/key',c.body,{'Content-Length':'262145'}))).status,403);assert.equal(c.seen.pulls,0);
  for(const role of ['admin','leader']){
    const f=await fixture(role),s=stream([new Uint8Array(1)]);assert.equal((await f.app.request(request('/api/settings/key',s.body,{'Content-Length':'262145'}))).status,413);assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.queries.length,0);
  }
});

test('settings stream limits cover actual bytes and encoded slash parameters',async()=>{
  for(const path of ['/api/settings/key','/api/settings/%2F'])for(const declared of [undefined,'1','262145']){
    const f=await fixture('leader'),s=stream([new Uint8Array(131072),new Uint8Array(131073)]);
    assert.equal((await f.app.request(request(path,s.body,declared?{'Content-Length':declared}:{}))).status,413);assert.equal(f.state.parses,0);assert.equal(f.state.queries.length,0);if(declared==='262145')assert.equal(s.seen.pulls,0);
  }
});

test('settings normal values and exact body limit preserve parameters but always use trusted updater',async()=>{
  for(const value of ['false',false,0,{synthetic:'value'}]){
    const f=await fixture();const response=await f.app.request(request('/api/settings/key',JSON.stringify({value,updatedBy:'forged'})));assert.equal(response.status,200);assert.deepEqual(f.state.queries[0].params,[value,'trusted@example.invalid','key']);assert.equal((await response.json()).data.updated_by,'trusted@example.invalid');
  }
  const f=await fixture(),data={value:'normal',padding:''};data.padding='x'.repeat(262144-Buffer.byteLength(JSON.stringify(data)));assert.equal((await f.app.request(request('/api/settings/key',JSON.stringify(data)))).status,200);
});

test('settings malformed JSON and missing trusted actor never reach settings SQL',async()=>{
  const f=await fixture();for(const body of ['{','null','[]','1','"value"','{}'])assert.equal((await f.app.request(request('/api/settings/key',body))).status,400);assert.equal(f.state.queries.length,0);
  const missing=await fixture('admin',null);assert.equal((await missing.app.request(request('/api/settings/key',JSON.stringify({value:'safe',updatedBy:'forged'})))).status,503);assert.equal(missing.state.queries.length,0);
  const broken=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});const response=await f.app.request(request('/api/settings/key',broken));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(f.state.queries.length,0);
});
