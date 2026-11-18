import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {installVnetTalents} from '../src/integrations/vnetTalents.js';
test('vnet feed: dedicated auth, active-only minimum fields, no mutations or PII',async()=>{
 const app=new Hono();let calls=0;
 installVnetTalents(app,{token:()=> 'test-token-'.repeat(4),db:async(sql,args)=>{calls++;assert.match(sql,/WHERE status = \$1/);assert.deepEqual(args,['アクティブ']);return {rows:[{student_id:'s1',character_name:'Talent',name:'Private name',email:'private',status:'アクティブ',youtube_channel_id:'UCtest',x_account_id:'handle'},{student_id:'s2',status:'退会'}]};}});
 const url='/integrations/vnet/v1/talents',headers={authorization:'Bearer '+'test-token-'.repeat(4)};
 assert.equal((await app.request(url)).status,401);assert.equal(calls,0);
 assert.equal((await app.request(url,{method:'POST',headers})).status,405);assert.equal(calls,0);
 const res=await app.request(url,{headers});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
 const body=await res.json();assert.deepEqual(body.talents,[{id:'s1',name:'Talent',status:'アクティブ',youtubeId:'UCtest',xId:'handle'}]);assert.ok(!JSON.stringify(body).includes('Private'));
 const off=new Hono();installVnetTalents(off,{token:()=>'',db:()=>{throw Error();}});assert.equal((await off.request(url,{headers})).status,503);
});
