import test from 'node:test';import assert from 'node:assert/strict';import{Hono}from'hono';import{installApiAccess}from'../src/security/apiAccess.js';
const token='a'.repeat(64),authorized={Authorization:'Bearer '+token};
function fixture(role='crew'){
 const state={user:{id:1,email:'synthetic@example.test',role,must_change_password:false},sessions:0,business:0};const app=new Hono();
 installApiAccess(app,{db:async sql=>{assert.ok(sql.includes('FROM sessions'));state.sessions++;return{rows:[state.user]}}});
 app.all('/api/*',c=>{state.business++;return c.json({success:true})});return{app,state};
}
const paths=['/api/handover/students','/api/handover/tutor-sidebar','/api/handover/new-assignments?month=next'];
test('anonymous handover requests are denied before all lookups/handlers',async()=>{const f=fixture();for(const path of paths)assert.equal((await f.app.request(path)).status,401);assert.equal(f.state.sessions,0);assert.equal(f.state.business,0)});
test('crew handover reads, HEAD and all child paths are denied before business handlers',async()=>{const f=fixture();for(const path of [...paths,'/api/handover','/api/handover/','/api/handover/future-child','/api/%68andover/students'])for(const method of ['GET','HEAD'])assert.equal((await f.app.request(path,{method,headers:authorized})).status,403,path+' '+method);assert.equal(f.state.business,0);assert.ok(f.state.sessions>0)});
test('handover manager access is retained and role demotion applies immediately',async()=>{for(const role of ['admin','leader']){const f=fixture(role);for(const path of paths)assert.equal((await f.app.request(path,{headers:authorized})).status,200);f.state.user.role='crew';assert.equal((await f.app.request(paths[0],{headers:authorized})).status,403);assert.equal(f.state.business,3)}});
test('handover prefix does not restrict unrelated lookalike API names',async()=>{const f=fixture();for(const path of ['/api/handover-other','/api/handover2/students'])assert.equal((await f.app.request(path,{headers:authorized})).status,200);assert.equal(f.state.business,2)});
