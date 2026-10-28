import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';
import {uploadRequestBodyLimit} from '../src/security/uploadBodyLimit.js';

const token='a'.repeat(64), headers={Authorization:`Bearer ${token}`};
let sequence=0;
async function fixture(role='crew') {
  const calls={get:[],all:[],calculate:[],update:[],sql:[],notification:0};
  const deps={Hono,uploadRequestBodyLimit,
    getRedList:async(...args)=>{calls.get.push(args);return null},
    getAllRedLists:async(...args)=>{calls.all.push(args);return []},
    calculateRedListScore:async(...args)=>{calls.calculate.push(args);return {total:0}},
    updateRedList:async(...args)=>{calls.update.push(args);return {total:0}},
    updateAllRedLists:async()=>{throw Error('Unexpected bulk write')},
    query:async(sql,params)=>{if(sql.includes('FROM sessions'))return{rows:[{id:1,role,email:'synthetic@example.invalid'}]};calls.sql.push({sql,params});return {rows:[]}},
    sendDiscordMessage:async()=>{calls.notification++;throw Error('Forbidden notification')},
    getStudentDiscordInfo:async()=>{calls.notification++;throw Error('Forbidden notification')},
    console:{error(){},warn(){},log(){}}
  };
  let source=await readFile(new URL('../src/routes/redList.js',import.meta.url),'utf8');
  source=source.replace(/import \{\s*([^}]+)\} from '[^']+';/g,(_,names)=>`const {${names}}=deps;`);
  const key='redListReadInput'+sequence++;globalThis[key]=deps;
  let route;try{route=(await import('data:text/javascript;base64,'+Buffer.from(`const deps=globalThis[${JSON.stringify(key)}];const console=deps.console;\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
  const app=new Hono();installApiAccess(app,{db:async()=>({rows:[{id:1,role,must_change_password:false}]})});app.route('/api/red-list',route);
  return {app,calls};
}
function noBusiness(calls) {
  for(const key of ['get','all','calculate','update','sql'])assert.equal(calls[key].length,0,key);
  assert.equal(calls.notification,0);
}

test('malformed months reject before red-list lookup, calculation or persistence for every read',async()=>{
  for(const role of ['crew','admin','leader']) {
    const f=await fixture(role);
    for(const month of ['2026-00','2026-13','2026-1','0000-01','2026-10-01',' 2026-10','2026-10 ','2026-10\u0000',"2026-10' OR '1'='1"]){
      for(const path of ['/api/red-list','/api/red-list/history','/api/red-list/SYNTHETIC','/api/red-list/discord/logs']) {
        for(const method of ['GET','HEAD'])assert.equal((await f.app.request(path+'?yearMonth='+encodeURIComponent(month),{method,headers})).status,400,path);
      }
    }
    noBusiness(f.calls);
  }
});

test('invalid student IDs reject before DB, score calculation or notifications',async()=>{
  const f=await fixture('admin');
  for(const id of [' '.repeat(3),'x'.repeat(51),'x\u0000','x\n']) {
    for(const path of ['/api/red-list/'+encodeURIComponent(id)+'?yearMonth=2026-10','/api/red-list/discord/logs?studentId='+encodeURIComponent(id)]) {
      assert.equal((await f.app.request(path,{headers})).status,400);
    }
  }
  noBusiness(f.calls);
});

test('valid quoted and Unicode IDs stay bound data and share existing read access',async()=>{
  for(const role of ['crew','admin','leader']) {
    const f=await fixture(role), id="Synthetic'\"あ";
    const res=await f.app.request('/api/red-list/'+encodeURIComponent(id)+'?yearMonth=2026-10',{headers});
    assert.equal(res.status,200);assert.deepEqual(f.calls.get,[[id,'2026-10']]);assert.deepEqual(f.calls.calculate,[[id,'2026-10']]);
    assert.equal(f.calls.update.length,role==='crew'?0:1);
    assert.equal((await f.app.request('/api/red-list/history?yearMonth=2026-09',{headers})).status,200);
    assert.equal((await f.app.request('/api/red-list/discord/logs?studentId='+encodeURIComponent(id)+'&yearMonth=2026-10',{headers})).status,200);
    assert.deepEqual(f.calls.sql.at(-1).params,[id,'2026-10']);assert.ok(f.calls.sql.at(-1).sql.includes('LIMIT 200'));
    assert.equal(f.calls.notification,0);
  }
});

test('schema character limit counts Unicode characters and preserves normal filters',async()=>{
  const f=await fixture(), id='😀'.repeat(50);
  assert.equal((await f.app.request('/api/red-list/'+encodeURIComponent(id)+'?yearMonth=2026-10',{headers})).status,200);
  assert.equal((await f.app.request('/api/red-list/'+encodeURIComponent(id+'😀')+'?yearMonth=2026-10',{headers})).status,400);
  for(const path of ['/api/red-list','/api/red-list?yearMonth=','/api/red-list/discord/logs','/api/red-list/discord/logs?studentId=&yearMonth='])assert.equal((await f.app.request(path,{headers})).status,200);
  assert.equal((await f.app.request('/api/red-list/history',{headers})).status,400);
  assert.equal((await f.app.request('/api/red-list/history?yearMonth=',{headers})).status,400);
});

test('authentication and crew write rejection precede read parameter processing',async()=>{
  const f=await fixture();
  for(const path of ['/api/red-list?yearMonth=bad','/api/red-list/history?yearMonth=bad','/api/red-list/discord/logs?studentId=bad','/api/red-list/SYNTHETIC?yearMonth=bad'])assert.equal((await f.app.request(path)).status,401);
  for(const path of ['/api/red-list/update','/api/red-list/update/SYNTHETIC'])assert.equal((await f.app.request(path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"yearMonth":"2026-10"}'})).status,403);
  noBusiness(f.calls);
});
