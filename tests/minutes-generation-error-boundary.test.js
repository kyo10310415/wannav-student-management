import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Hono} from 'hono';
import {installApiAccess} from '../src/security/apiAccess.js';
import {resolveLessonReference} from '../src/services/lessonReferenceService.js';
const marker='<b data-synthetic="minutes-error">SYNTHETIC</b>';
let sequence=0;
async function fixture(role='leader'){
 const calls={drive:[],db:0,logs:[]},deps={Hono,resolveLessonReference,fetchTranscript:async(...args)=>{calls.drive.push(args);return null},query:async()=>{calls.db++;throw Error('Unexpected business SQL')},console:Object.fromEntries(['log','warn','error'].map(level=>[level,(...args)=>calls.logs.push(args.join(' '))]))};
 const source=(await readFile(new URL('../src/routes/minutes.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\r?\n/gm,'');
 const key='minutesErrorBoundary'+sequence++;globalThis[key]=deps;let router;
 try{router=(await import('data:text/javascript;base64,'+Buffer.from(`const {Hono,resolveLessonReference,fetchTranscript,query,console}=globalThis[${JSON.stringify(key)}];\n`+source).toString('base64'))).default}finally{delete globalThis[key]}
 const app=new Hono();installApiAccess(app,{db:async()=>({rows:[{id:7,role,email:'synthetic@example.test',must_change_password:false}]})});app.route('/api/minutes',router);return{app,calls};
}
const body={studentId:marker,studentName:'Synthetic',lessonDate:'2026-10-30',lessonNumber:3};
const options={method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(body)};
test('real authenticated missing-transcript route keeps 404 without reflecting student identifiers',async()=>{
 for(const role of ['admin','leader']){const f=await fixture(role),response=await f.app.request('/api/minutes/generate',options);assert.equal(response.status,404);const value=await response.json();assert.deepEqual(value,{success:false,error:'Google Drive に文字起こしファイルが見つかりませんでした。対象の生徒とレッスン日を確認してください。'});assert.equal(JSON.stringify(value).includes(marker),false);assert.deepEqual(f.calls.drive,[[marker,'2026-10-30']]);assert.equal(f.calls.db,0);assert.equal(f.calls.logs.join('\n').includes(marker),false);}
});
test('real global role boundary stops anonymous and crew before transcript or business SQL',async()=>{
 const f=await fixture('crew');assert.equal((await f.app.request('/api/minutes/generate',{...options,headers:{'Content-Type':'application/json'}})).status,401);assert.equal((await f.app.request('/api/minutes/generate',options)).status,403);assert.equal(f.calls.drive.length+f.calls.db,0);
});
