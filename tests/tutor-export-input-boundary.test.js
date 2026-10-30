import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess,TUTOR_EXPORT_REQUEST_MAX_BYTES} from '../src/security/apiAccess.js';
const headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
const valid={rows:[['Tutor','Metric','2026/10'],['Synthetic','Satisfaction','81.25']],sortedMonths:['2026/10'],isManualExport:true};
let sequence=0;
async function fixture(role='leader',mode='manual'){
 const state={google:[],exports:[],parses:0};
 const spreadsheets={batchUpdate:async args=>{state.google.push(['batch',args]);return{data:{replies:[{addSheet:{properties:{sheetId:42}}}]}}},get:async()=>({data:{sheets:mode==='auto-new'?[]:[{properties:{title:'Tutor満足度',sheetId:42}}]}}),values:{get:async()=>({data:{values:[['Tutor','Metric',mode==='same'?'2026/10':'2026/09']]}}),update:async args=>{state.google.push(['values',args]);return{}}}};
 const deps={Hono,query:async()=>({rows:[{}]}),exportTutorQualitySnapshot:async(...args)=>{state.exports.push(args);return{count:1}},process:{env:{GOOGLE_CREDENTIALS_JSON:'{}',TUTOR_SATISFACTION_SHEET_ID:'synthetic-sheet'}},console:{log(){},warn(){},error(){}},google:{sheets:()=>{state.google.push(['init']);return{spreadsheets}},auth:{GoogleAuth:class{async getClient(){return 'synthetic'}}}}};
 const source=(await readFile(new URL('../src/routes/tutors.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\r?\n/gm,'').replace("await import('googleapis')",'deps');
 const key='tutorExportBoundary'+sequence++;globalThis[key]=deps;let routes;
 try{routes=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const {Hono,query,exportTutorQualitySnapshot,process,console}=deps;\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
 const app=new Hono();app.use('/api/*',async(c,next)=>{const parse=c.req.json.bind(c.req);c.req.json=(...args)=>{state.parses++;return parse(...args)};return next()});installApiAccess(app,{db:async()=>({rows:[{id:7,email:'synthetic@example.test',role,must_change_password:false}]})});app.route('/api/tutors',routes);return{app,state};
}
const request=(path,body,extra={})=>new Request('http://fixture.invalid/api/tutors'+path,{method:'POST',headers:{...headers,...extra},body,duplex:'half'});
function stream(parts){let i=0;const seen={pulls:0,canceled:false};return{seen,body:new ReadableStream({pull(c){seen.pulls++;if(i<parts.length)c.enqueue(parts[i++]);else c.close()},cancel(){seen.canceled=true}},{highWaterMark:0})}}
test('Tutor exports enforce role then actual byte limits before JSON or external writes',async()=>{
 assert.equal(TUTOR_EXPORT_REQUEST_MAX_BYTES,1048576);
 for(const path of ['/quality/export','/export-satisfaction']){
  const anon=await fixture(),a=stream([new Uint8Array(1)]);assert.equal((await anon.app.request(new Request('http://fixture.invalid/api/tutors'+path,{method:'POST',body:a.body,duplex:'half'}))).status,401);assert.equal(a.seen.pulls,0);
  const crew=await fixture('crew'),c=stream([new Uint8Array(1)]);assert.equal((await crew.app.request(request(path,c.body,{'Content-Length':'1048577'}))).status,403);assert.equal(c.seen.pulls,0);
  const f=await fixture(),d=stream([new Uint8Array(1)]);assert.equal((await f.app.request(request(path,d.body,{'Content-Length':'1048577'}))).status,413);assert.equal(d.seen.pulls,0);assert.equal(f.state.parses,0);
  for(const length of [undefined,'1']){const f=await fixture(),s=stream([new Uint8Array(524288),new Uint8Array(524289)]);assert.equal((await f.app.request(request(path,s.body,length?{'Content-Length':length}:{}))).status,413);assert.equal(s.seen.canceled,true);assert.equal(f.state.parses,0);assert.equal(f.state.google.length,0);assert.equal(f.state.exports.length,0)}
 }
});
test('invalid export shapes formulas and dimensions stop before initializing Google',async()=>{
 const f=await fixture();
 for(const raw of ['{','null','[]','1','"text"','{"rows":[[1e999]],"sortedMonths":["2026/10"]}'])assert.equal((await f.app.request(request('/export-satisfaction',raw))).status,400);
 for(const change of [{rows:[]},{rows:[[]]},{rows:[{}]},{rows:[[{}]]},{rows:[['x\u0000']]},{rows:[['=1+2']]},{rows:[[' \t=1+2']]},{rows:Array.from({length:10001},()=>['x'])},{rows:[Array(513).fill('x')]},{sortedMonths:[]},{sortedMonths:Array(501).fill('2026/10')},{sortedMonths:['=1+2']},{sortedMonths:[1]},{isManualExport:'false'}]){
  assert.equal((await f.app.request(request('/export-satisfaction',JSON.stringify({...valid,...change})))).status,400);
 }
 assert.equal(f.state.google.length,0);
});
test('quality export rejects coerced object and boolean date fields and retains normal numeric strings',async()=>{
 const f=await fixture();for(const raw of ['{','null','[]','1'])assert.equal((await f.app.request(request('/quality/export',raw))).status,400);
 for(const value of [{year:[2026],month:10},{year:2026,month:true},{year:2026,month:[10]},{year:1999,month:10},{year:2026,month:13}])assert.equal((await f.app.request(request('/quality/export',JSON.stringify(value)))).status,400);
 assert.equal(f.state.exports.length,0);assert.equal((await f.app.request(request('/quality/export','{"year":"2026","month":"10"}'))).status,200);assert.deepEqual(f.state.exports,[[2026,10]]);
});
test('normal manual and automatic export branches keep values parsing and formatting contracts',async()=>{
 for(const mode of ['manual','auto-new','auto-existing','same']){
  const f=await fixture('leader',mode),data={...valid,isManualExport:mode==='manual'};const response=await f.app.request(request('/export-satisfaction',JSON.stringify(data)));assert.equal(response.status,200,mode);
  const writes=f.state.google.filter(([kind])=>kind==='values');assert.equal(writes.length,mode==='auto-existing'?2:mode==='same'?0:1);
  for(const [,args]of writes)assert.equal(args.valueInputOption,'USER_ENTERED');
  if(mode==='manual'||mode==='auto-new')assert.deepEqual(writes[0][1].resource.values,data.rows);
 }
});
test('exact byte limit permits normal export and broken streams conceal details',async()=>{
 const f=await fixture('admin'),body={...valid,padding:''};body.padding='x'.repeat(1048576-Buffer.byteLength(JSON.stringify(body)));assert.equal((await f.app.request(request('/export-satisfaction',JSON.stringify(body)))).status,200);
 const g=await fixture(),broken=new ReadableStream({pull(c){c.error(Error('PRIVATE_SENTINEL'))}});const response=await g.app.request(request('/quality/export',broken));assert.equal(response.status,400);assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));assert.equal(g.state.google.length,0);assert.equal(g.state.exports.length,0);
});
