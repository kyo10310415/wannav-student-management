import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';
import {uploadRequestBodyLimit} from '../src/security/uploadBodyLimit.js';
const FILE_MAX=8*1024*1024,BODY_MAX=9*1024*1024,headers={Authorization:'Bearer '+'a'.repeat(64)};
let sequence=0;
async function fixture(role='admin'){
 const state={writes:[],routeSessions:0,outerSessions:0,json:0,multipart:0};
 const query=async(sql,params)=>{if(sql.includes('FROM sessions')){state.routeSessions++;return{rows:[{id:1,email:'synthetic@example.invalid',role}]}}state.writes.push({sql,params});return{rows:[{id:7}]}};
 const deps={Hono,uploadRequestBodyLimit,query};
 const source=(await readFile(new URL('../src/routes/redList.js',import.meta.url),'utf8')).replace(/import \{\s*([^}]+)\} from '[^']+';/g,(_,names)=>`const {${names}}=deps;`);
 const key='redUploadLimit'+sequence++;globalThis[key]=deps;let route;
 try{route=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const console={error(){}};\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
 const app=new Hono();installApiAccess(app,{db:async()=>{state.outerSessions++;return{rows:[{id:1,email:'synthetic@example.invalid',role,must_change_password:false}]}}});
 app.use('/api/red-list/*',async(c,next)=>{const json=c.req.json.bind(c.req),formData=c.req.formData.bind(c.req);c.req.json=(...args)=>{state.json++;return json(...args)};c.req.formData=(...args)=>{state.multipart++;return formData(...args)};return next()});
 app.route('/api/red-list',route);return{app,state};
}
const path=method=>'/api/red-list/messages'+(method==='PUT'?'/7':'');
function form(file,remove=false){const value=new FormData();value.set('title',' Synthetic title ');value.set('content',' Synthetic body ');if(file)value.set('image',file);if(remove)value.set('removeImage','true');return value}
function stream(chunks){const seen={pulls:0,canceled:false};let index=0;const body=new ReadableStream({pull(controller){seen.pulls++;if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close()},cancel(){seen.canceled=true}},{highWaterMark:0});return{body,seen};}
function streamed(method,body,extra={}){return new Request('http://fixture.invalid'+path(method),{method,headers:{...headers,...extra},body,duplex:'half'})}

test('redlist JSON create/update and multipart image removal keep their SQL contracts',async()=>{
 for(const method of['POST','PUT']){const f=await fixture();assert.equal((await f.app.request(path(method),{method,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({title:' Synthetic title ',content:' Synthetic body '})})).status,200);assert.deepEqual(f.state.writes[0].params.slice(0,2),['Synthetic title','Synthetic body']);assert.equal(f.state.json,1)}
 const f=await fixture('leader');assert.equal((await f.app.request(path('PUT'),{method:'PUT',headers,body:form(undefined,true)})).status,200);assert.ok(f.state.writes[0].sql.includes('image_data = NULL'));assert.equal(f.state.multipart,1);
});

test('documented 8 MiB images retain exact bytes and image MIME for POST and PUT',async()=>{
 const bytes=new Uint8Array(FILE_MAX);bytes.set([137,80,78,71,13,10,26,10]);
 for(const method of['POST','PUT']){const f=await fixture();const response=await f.app.request(path(method),{method,headers,body:form(new File([bytes],'synthetic.png',{type:'image/png'}))});assert.equal(response.status,200);assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].params[2].length,FILE_MAX);assert.equal(f.state.writes[0].params[4],'image/png')}
});

test('file above the editor 8 MiB cap rejects without writing or loading the attachment into SQL',async()=>{
 const bytes=new Uint8Array(FILE_MAX+1);
 for(const method of['POST','PUT']){const f=await fixture();const response=await f.app.request(path(method),{method,headers,body:form(new File([bytes],'synthetic.svg',{type:'image/svg+xml'}))});assert.equal(response.status,400);assert.equal(f.state.multipart,1);assert.equal(f.state.writes.length,0);assert.ok((await response.json()).error.includes('8MB'))}
});

test('declared excessive JSON or multipart bodies reject before any body pull or parser',async()=>{
 for(const method of['POST','PUT'])for(const type of['application/json','multipart/form-data; boundary=synthetic']){const f=await fixture();const s=stream([new Uint8Array(1)]);const response=await f.app.request(streamed(method,s.body,{'Content-Type':type,'Content-Length':String(BODY_MAX+1)}));assert.equal(response.status,413);assert.equal(s.seen.pulls,0);assert.equal(s.seen.canceled,true);assert.equal(f.state.multipart+f.state.json,0);assert.equal(f.state.writes.length,0)}
});

test('actual oversized stream with absent falsely small or chunked length cannot reach either parser',async()=>{
 const bytes=new Uint8Array(BODY_MAX);
 for(const method of['POST','PUT'])for(const type of['application/json','multipart/form-data; boundary=synthetic'])for(const extra of[{}, {'Content-Length':'1'}, {'Transfer-Encoding':'chunked'}]){const f=await fixture();const s=stream([bytes,new Uint8Array(1),new Uint8Array(1)]);assert.equal((await f.app.request(streamed(method,s.body,{'Content-Type':type,...extra}))).status,413);assert.equal(s.seen.pulls,2);assert.equal(s.seen.canceled,true);assert.equal(f.state.multipart+f.state.json,0);assert.equal(f.state.writes.length,0)}
});

test('anonymous and crew writes reject before route authentication body reads or parsing',async()=>{
 for(const method of['POST','PUT']){const f=await fixture();const anonymous=stream([new Uint8Array(1)]);const request=streamed(method,anonymous.body,{'Content-Length':String(BODY_MAX+1)});request.headers.delete('Authorization');assert.equal((await f.app.request(request)).status,401);assert.equal(anonymous.seen.pulls,0);assert.equal(f.state.outerSessions,0);assert.equal(f.state.routeSessions,0);assert.equal(f.state.multipart+f.state.json,0);const crew=await fixture('crew'),s=stream([new Uint8Array(1)]);assert.equal((await crew.app.request(streamed(method,s.body,{'Content-Length':String(BODY_MAX+1)}))).status,403);assert.equal(s.seen.pulls,0);assert.equal(crew.state.routeSessions,0);assert.equal(crew.state.writes.length,0)}
});

test('body cap stays scoped to the two message saves; ordinary sender JSON contract is unchanged',async()=>{
 const f=await fixture();const response=await f.app.request('/api/red-list/senders',{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':String(BODY_MAX+1)},body:JSON.stringify({name:'Synthetic',booking_url:'https://fixture.invalid/booking'})});assert.equal(response.status,200);assert.equal(f.state.writes.length,1);assert.ok(f.state.writes[0].sql.includes('INSERT INTO red_list_senders'));
});
