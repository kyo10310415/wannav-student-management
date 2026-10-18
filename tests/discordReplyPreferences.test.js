import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Hono} from 'hono';

function routes(role='admin') {
  const updates=[];
  const context={Hono,console:{error(){}},query:async(sql,params)=>{
    if(sql.includes('FROM sessions'))return {rows:[{role,email:'admin@example.test'}]};
    if(sql.startsWith('UPDATE users SET discord_reply_alerts_enabled')){
      updates.push(params);return {rows:params[1]==='404'?[]:[{id:params[1],discord_reply_alerts_enabled:params[0]}]};
    }
    return {rows:[]};
  }};
  vm.createContext(context);
  const source=readFileSync(new URL('../src/routes/users.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default app;','globalThis.app=app;');
  vm.runInContext(source,context);
  return {app:context.app,updates};
}

test('only admin can change reply alert preference and only boolean values are accepted',async()=>{
  const request=(app,enabled,path='/1/reply-alerts',token=true)=>app.request(path,{method:'PUT',headers:{...(token?{Authorization:'Bearer test'}:{}),'Content-Type':'application/json'},body:JSON.stringify({enabled})});
  const admin=routes();
  assert.equal((await request(admin.app,false)).status,200);
  assert.equal((await request(admin.app,true)).status,200);
  assert.equal(admin.updates.length,2);
  assert.equal(admin.updates[0][0],false);
  for(const value of ['false',null,0])assert.equal((await request(admin.app,value)).status,400);
  assert.equal((await request(admin.app,true,'/404/reply-alerts')).status,404);
  assert.equal((await request(admin.app,false,'/1/reply-alerts',false)).status,401);
  for(const role of ['leader','crew']){
    const denied=routes(role);assert.equal((await request(denied.app,false)).status,403);assert.equal(denied.updates.length,0);
  }
});

test('preference checkbox rolls back on failed save and does not stay disabled',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function updateUserReplyAlerts(');
  const end=source.indexOf('async function updateUserJobTitle(',start);
  const context={API_BASE:'',sessionToken:'test-session',axios:{put:async()=>{throw new Error('Failure');}},alert(){},showNotification(){}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const input={checked:false,disabled:false};
  await context.updateUserReplyAlerts(1,input);
  assert.equal(input.checked,true);assert.equal(input.disabled,false);
});
