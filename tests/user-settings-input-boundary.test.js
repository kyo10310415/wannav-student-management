import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess,USER_SETTINGS_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
const paths=[['POST','/api/users'],...['7','7/job-title','7/reply-alerts','7/discord','7/booking-links','%2F/discord'].map(id=>['PUT','/api/users/'+id])];
let sequence=0;
async function fixture(role='admin') {
  const state={business:[],transactions:[],parses:0,hashes:0,releases:0};
  const query=async(sql,params)=>{
    if(sql.includes('FROM sessions'))return {rows:[{role,email:'admin@example.invalid'}]};
    state.business.push({sql,params});
    if(sql.includes('WHERE email ='))return {rows:[]};
    if(sql.includes('INSERT INTO users'))return {rows:[{id:7,email:params[0],role:params[2]}]};
    return {rows:[{id:7,discord_reply_alerts_enabled:params?.[0]}]};
  };
  const deps={Hono,query,getClient:async()=>({query:async(sql,params)=>{state.transactions.push({sql,params});return {rows:sql.includes('SELECT u.id')?[{id:7,email:'tutor@example.invalid'}]:sql.includes('UPDATE users')?[{id:7}]:[]}},release(){state.releases++}}),bcrypt:{hash:async()=>{state.hashes++;return 'synthetic-hash'}},generateTemporaryPassword:()=> 'synthetic-'+'issued'};
  let source=await readFile(new URL('../src/routes/users.js',import.meta.url),'utf8');source=source.replace(/^import .*;\r?\n/gm,'');
  const key='userSettingsBoundary'+sequence++;globalThis[key]=deps;let routes;
  try{routes=(await import('data:text/javascript;base64,'+Buffer.from(`const {Hono,query,getClient,bcrypt,generateTemporaryPassword}=globalThis[${JSON.stringify(key)}];const console={log(){},error(){}};\n`+source).toString('base64'))).default;}finally{delete globalThis[key];}
  const app=new Hono();app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});
  installApiAccess(app,{db:async()=>({rows:[{id:1,role,email:'admin@example.invalid',must_change_password:false}]})});app.route('/api/users',routes);return {app,state};
}
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return {seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})};}
const request=(method,path,body,extra={})=>new Request('http://fixture.invalid'+path,{method,body,headers:{...headers,...extra},duplex:'half'});

test('all user JSON writes reject non-admin or anonymous before reads, oversized admin before parser/business',async()=>{
  assert.equal(USER_SETTINGS_REQUEST_MAX_BYTES,262144);
  for(const [method,path] of paths){
    const anon=await fixture(),a=stream([new Uint8Array(1)]);assert.equal((await anon.app.request(new Request('http://fixture.invalid'+path,{method,body:a.body,duplex:'half'}))).status,401);assert.equal(a.seen.pulls,0);
    for(const role of ['crew','leader']){const f=await fixture(role),s=stream([new Uint8Array(1)]);assert.equal((await f.app.request(request(method,path,s.body,{'Content-Length':'262145'}))).status,403);assert.equal(s.seen.pulls,0);assert.equal(f.state.business.length,0);}
    const f=await fixture(),s=stream([new Uint8Array(1)]);assert.equal((await f.app.request(request(method,path,s.body,{'Content-Length':'262145'}))).status,413);assert.equal(s.seen.pulls,0);assert.equal(f.state.parses,0);assert.equal(f.state.business.length,0);assert.equal(f.state.transactions.length,0);
  }
});

test('actual user write sizes cover missing/false length and encoded parameter before JSON',async()=>{
  for(const [method,path] of paths)for(const declared of [undefined,'1']){
    const f=await fixture(),s=stream([new Uint8Array(131072),new Uint8Array(131073)]);assert.equal((await f.app.request(request(method,path,s.body,declared?{'Content-Length':declared}:{}))).status,413);assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.business.length,0);
  }
});

test('normal and exact-limit user updates preserve role/title/notification and trusted audit transaction',async()=>{
  const cases=[['POST','/api/users',{email:'Synthetic@Example.Invalid',role:'crew'}],['PUT','/api/users/7',{role:'leader'}],['PUT','/api/users/7/job-title',{job_title:'クルー'}],['PUT','/api/users/7/reply-alerts',{enabled:false}],['PUT','/api/users/7/discord',{discord_webhook_url:null,discord_user_id:null}],['PUT','/api/users/7/booking-links',{regularUrl:'https://example.invalid/regular',proUrl:''}]];
  for(const [method,path,body] of cases){const f=await fixture();const data={...body,padding:''};data.padding='x'.repeat(262144-Buffer.byteLength(JSON.stringify(data)));assert.equal((await f.app.request(request(method,path,JSON.stringify(data)))).status,200,path);if(path.endsWith('booking-links')){assert.equal(f.state.releases,1);assert.deepEqual(f.state.transactions.find(x=>x.sql.includes('UPDATE users')).params,['https://example.invalid/regular',null,'7']);}if(method==='POST'){assert.equal(f.state.hashes,1);assert.equal(f.state.business.at(-1).params[0],'synthetic@example.invalid');}}
});

test('unshaped user create/booking/Discord JSON and invalid text never reach mutation or hashing',async()=>{
  for(const [method,path] of [['POST','/api/users'],['PUT','/api/users/7/booking-links'],['PUT','/api/users/7/discord']]){
    const f=await fixture();for(const body of ['{','null','[]','1','"value"'])assert.equal((await f.app.request(request(method,path,body))).status,400);assert.equal(f.state.business.length,0);assert.equal(f.state.transactions.length,0);assert.equal(f.state.hashes,0);
  }
  const f=await fixture();for(const email of [1,{},true,'   ','a'.repeat(256),'synthetic\u0000'])assert.equal((await f.app.request(request('POST','/api/users',JSON.stringify({email,role:'crew'})))).status,400);
  for(const value of [0,false,[],{},'\u0000']){
    assert.equal((await f.app.request(request('PUT','/api/users/7/booking-links',JSON.stringify({regularUrl:value})))).status,400);
    assert.equal((await f.app.request(request('PUT','/api/users/7/discord',JSON.stringify({discord_user_id:value})))).status,400);
  }
  assert.equal(f.state.business.length,0);assert.equal(f.state.transactions.length,0);assert.equal(f.state.hashes,0);
});

test('explicit null booking/Discord fields clear normally and broken stream remains private',async()=>{
  const f=await fixture();assert.equal((await f.app.request(request('PUT','/api/users/7/booking-links',JSON.stringify({regularUrl:null,proUrl:null})))).status,200);assert.deepEqual(f.state.transactions.find(x=>x.sql.includes('UPDATE users')).params,[null,null,'7']);
  assert.equal((await f.app.request(request('PUT','/api/users/7/discord',JSON.stringify({discord_webhook_url:null,discord_user_id:null})))).status,200);assert.deepEqual(f.state.business.at(-1).params,[null,null,'7']);
  const g=await fixture(),body=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});const response=await g.app.request(request('POST','/api/users',body));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(g.state.business.length,0);
});
