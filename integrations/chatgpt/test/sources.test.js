import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Sources,sourceConfiguration} from '../src/sources.js';
test('six-source HTTP reads use fixed routes and dedicated tokens; failures stay unavailable',async t=>{
 const calls=[];
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture'),source=req.headers.authorization?.slice(7).split('-')[0];calls.push({path:url.pathname,source});res.setHeader('Content-Type','application/json');
  if(source==='ep'){res.writeHead(503);return res.end('{}')}
  if(url.pathname==='/integrations/chatgpt/v1/catalog')return res.end(JSON.stringify({version:1,datasets:{students:{title:source,fields:{student_id:'text'}}}}));
  if(url.pathname==='/integrations/chatgpt/v1/query'){const input=JSON.parse(url.searchParams.get('request'));assert.equal(input.dataset,'students');return res.end(JSON.stringify({version:1,dataset:'students',rows:[{student_id:'FIXTURE1'}],truncated:false}))}
  res.writeHead(404);res.end('{}');
 });server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const config=Object.fromEntries(['central','extension','ep','sales','payment','evaluation'].map(name=>[name,{url:'http://127.0.0.1:'+server.address().port,token:name+'-fixture-token'}]));
 const sources=new Sources(config),catalog=await sources.catalog();assert.equal(Object.keys(catalog.datasets).length,5);assert.deepEqual(catalog.unavailable,['ep']);assert.equal((await sources.query('central.students',{filters:[]})).rows[0].student_id,'FIXTURE1');assert.deepEqual(new Set(calls.map(c=>c.source)),new Set(Object.keys(config)));assert.ok(calls.every(c=>c.path.startsWith('/integrations/chatgpt/v1/')));await assert.rejects(sources.query('evil.students',{}),/Unknown source/);
});
test('source configuration rejects insecure URL, credentials, path injection and missing tokens',()=>{
 const env=Object.fromEntries(['CENTRAL','EXTENSION','EP','SALES','PAYMENT','EVALUATION'].flatMap(s=>[[s+'_URL','https://source.example'],[s+'_TOKEN','x'.repeat(40)]]));assert.equal(sourceConfiguration(env).sales.url,'https://source.example');
 for(const url of ['http://source.example','https://a:b@source.example','https://source.example/api','https://source.example?url=evil'])assert.throws(()=>sourceConfiguration({...env,SALES_URL:url}));assert.throws(()=>sourceConfiguration({...env,SALES_TOKEN:''}));
});
test('source transport forbids redirects and refuses oversized responses',async()=>{
 let options;const sources=new Sources({central:{url:'https://source.example',token:'secret'}},async(_url,opts)=>{options=opts;return new Response(new Uint8Array(4*1024*1024+1))});await assert.rejects(sources.request('central','query',{}),/4MiB/);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer secret');
});
