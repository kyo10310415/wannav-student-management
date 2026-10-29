import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).split('// State')[0];
const oldToken='a'.repeat(64),newToken='b'.repeat(64);
function fixture(){
 const requests=[],removed=[],screens=[];let requestInterceptor,responseError;
 const c={URL,Request,Headers,localStorage:{getItem:()=>oldToken,removeItem:key=>removed.push(key)},window:{location:{href:'https://app.example.invalid/',origin:'https://app.example.invalid'},fetch:(input,options)=>new Promise(resolve=>requests.push({input,options,resolve}))},axios:{interceptors:{request:{use:fn=>requestInterceptor=fn},response:{use:(_ok,error)=>responseError=error}}},showLoginPage:()=>screens.push(true)};
 vm.createContext(c);vm.runInContext(source,c);
 const token=()=>vm.runInContext('sessionToken',c),change=()=>vm.runInContext(`sessionToken=${JSON.stringify(newToken)};currentUser={id:8}`,c);
 return {c,requests,removed,screens,token,change,request:config=>requestInterceptor(config),error:config=>responseError({response:{status:401},config})};
}

test('old axios 401 cannot log out a replacement session but the current request 401 still does',async()=>{
 const f=fixture(),old=f.request({url:'/api/students'});f.change();await assert.rejects(()=>f.error(old));assert.equal(f.token(),newToken);assert.equal(f.removed.length,0);assert.equal(f.screens.length,0);
 const current=f.request({url:'/api/students'});await assert.rejects(()=>f.error(current));assert.equal(f.token(),null);assert.deepEqual(f.removed,['sessionToken']);assert.equal(f.screens.length,1);
});

test('axios resolves baseURL and handles header containers without logging out foreign/no-auth/login requests',async()=>{
 for(const config of [{url:'/api/students'}, {url:'/api/students',headers:{Authorization:'Bearer '+oldToken},baseURL:'https://foreign.example.invalid/'}, {url:'/api/auth/login',headers:{Authorization:'Bearer '+oldToken}}]){
  const f=fixture();await assert.rejects(()=>f.error(config));assert.equal(f.token(),oldToken);assert.equal(f.screens.length,0);
 }
 for(const headers of [{authorization:'Bearer '+oldToken},new Headers({Authorization:'Bearer '+oldToken}),{get:name=>name==='Authorization'?'Bearer '+oldToken:undefined}]){
  const f=fixture();await assert.rejects(()=>f.error({url:'students',baseURL:'/api/',headers}));assert.equal(f.token(),null);
 }
});

test('fetch response uses token captured at dispatch; old 401 preserves new session and current 401 clears it',async()=>{
 const f=fixture();const old=f.c.window.fetch('/api/students');assert.equal(f.requests[0].options.headers.get('Authorization'),'Bearer '+oldToken);f.change();f.requests[0].resolve(new Response('{}',{status:401}));await old;assert.equal(f.token(),newToken);assert.equal(f.screens.length,0);
 const current=f.c.window.fetch('/api/students');assert.equal(f.requests[1].options.headers.get('Authorization'),'Bearer '+newToken);f.requests[1].resolve(new Response('{}',{status:401}));await current;assert.equal(f.token(),null);assert.equal(f.screens.length,1);
});

test('fetch foreign, missing session and existing auth-prefix exceptions preserve the session policy',async()=>{
 for(const path of ['https://foreign.example.invalid/api/students','/api/auth/login','/api/auth/verify']){
  const f=fixture(),pending=f.c.window.fetch(path);f.requests[0].resolve(new Response('{}',{status:401}));await pending;assert.equal(f.token(),oldToken);assert.equal(f.screens.length,0);
  if(path.startsWith('https://foreign'))assert.equal(f.requests[0].options.headers,undefined);
 }
 const f=fixture();vm.runInContext('sessionToken=null',f.c);const pending=f.c.window.fetch('/api/students');assert.equal(f.requests[0].options.headers,undefined);f.requests[0].resolve(new Response('{}',{status:401}));await pending;assert.equal(f.screens.length,0);
});
