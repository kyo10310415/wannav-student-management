import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const block=source.slice(source.indexOf('let minutesBackfillStatusGeneration ='),source.indexOf('let minutesListReadGeneration ='));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){const calls=[],notices=[],timers=new Map(),canceled=[],listWrites=[],nodes=[],elements={};let next=1;
 const node=()=>{const n={value:'',disabled:false,innerHTML:'original',textContent:'',className:'',connected:true};nodes.push(n);return n};
 elements.content={contains:n=>nodes.includes(n)&&n.connected};for(const id of ['minutes-backfill-start','minutes-backfill-end','minutes-backfill-btn','minutes-backfill-status'])elements[id]=node();elements['minutes-backfill-start'].value='2026-10-01';elements['minutes-backfill-end'].value='2026-10-30';
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'leader'},currentPage:'minutes',minutesCurrentStudentId:null,minutesCurrentStudentName:null,minutesBackfillPollTimer:null,document:{getElementById:id=>elements[id]??null},confirm:()=>true,showNotification:(...args)=>notices.push(args),setTimeout:(fn,ms)=>{assert.equal(ms,5000);const id=next++;timers.set(id,fn);return id},clearTimeout:id=>canceled.push(id)};
 const send=(method,args=[])=>{const d=defer();calls.push({method,args,...d});return d.promise};c.axios={get:(...args)=>send('get',args),post:(...args)=>send('post',args)};c.loadMinutesList=async(parent=()=>true)=>{await send('list');if(!parent())return false;listWrites.push('list');return true};vm.createContext(c);vm.runInContext(block,c);return{c,calls,notices,timers,canceled,listWrites,elements,node,fire:id=>timers.get(id)()};}
const response=status=>({data:{success:true,data:{status,progress:{processed:1,total:2,generated:1},summary:{generated:1}}}}),tick=()=>new Promise(r=>setImmediate(r));
test('normal start preserves payload and actor, blocks duplicate, and continues one running poll even after date inputs change',async()=>{
 const f=fixture(),p=f.c.startMinutesBackfillFromPage();await f.c.startMinutesBackfillFromPage();assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args[1])),{startDate:'2026-10-01',endDate:'2026-10-30'});assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer fixture-token');f.calls[0].resolve({data:{success:true}});await tick();assert.equal(f.calls[1].method,'get');f.calls[1].resolve(response('running'));await p;assert.equal(f.elements['minutes-backfill-btn'].disabled,true);const timer=f.c.minutesBackfillPollTimer;f.elements['minutes-backfill-start'].value='2026-09-01';f.fire(timer);assert.equal(f.calls.length,3);f.calls[2].resolve(response('idle'));await tick();assert.equal(f.elements['minutes-backfill-btn'].disabled,false);assert.equal(f.notices.length,1);
});
test('stale start success/error cannot notify or query another context',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentId='synthetic',f=>f.c.minutesCurrentStudentName='new',f=>f.elements.content={},f=>f.elements['minutes-backfill-start'].value='2026-09-01',f=>f.elements['minutes-backfill-btn']=f.node()];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=f.c.startMinutesBackfillFromPage();change(f);if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve({data:{success:true}});await p;assert.equal(f.calls.length,1);assert.equal(f.notices.length,0);assert.equal(f.timers.size,0);}
});
test('confirmation rechecks context and invalid roles/student contexts cannot start or read',async()=>{
 const f=fixture();f.c.confirm=()=>false;await f.c.startMinutesBackfillFromPage();assert.equal(f.calls.length,0);f.c.confirm=()=>{f.c.sessionToken='new';return true};await f.c.startMinutesBackfillFromPage();assert.equal(f.calls.length,0);
 for(const change of [f=>f.c.sessionToken=null,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentId='synthetic',f=>f.elements['minutes-backfill-status'].connected=false]){const g=fixture();change(g);await g.c.startMinutesBackfillFromPage();await g.c.loadMinutesBackfillStatus();assert.equal(g.calls.length,0);}
});
test('latest status response wins and old running response cannot restart polling after idle',async()=>{
 const f=fixture(),p=f.c.loadMinutesBackfillStatus(),q=f.c.loadMinutesBackfillStatus();f.calls[1].resolve(response('idle'));await q;const text=f.elements['minutes-backfill-status'].textContent;f.calls[0].resolve(response('running'));await p;assert.equal(f.timers.size,0);assert.equal(f.elements['minutes-backfill-status'].textContent,text);assert.equal(f.elements['minutes-backfill-btn'].disabled,false);
});
test('old timer owner or parent context never starts another GET after a new read or page/actor/DOM change',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentId='synthetic',f=>f.elements.content={},f=>f.elements['minutes-backfill-status']=f.node()];
 for(const change of changes){const f=fixture(),p=f.c.loadMinutesBackfillStatus();f.calls[0].resolve(response('running'));await p;const timer=f.c.minutesBackfillPollTimer;change(f);f.fire(timer);assert.equal(f.calls.length,1);}
 const f=fixture();let active=true;const p=f.c.loadMinutesBackfillStatus(()=>active);f.calls[0].resolve(response('running'));await p;const timer=f.c.minutesBackfillPollTimer;active=false;f.fire(timer);assert.equal(f.calls.length,1);
 const g=fixture(),q=g.c.loadMinutesBackfillStatus();g.calls[0].resolve(response('running'));await q;const old=g.c.minutesBackfillPollTimer,r=g.c.loadMinutesBackfillStatus();g.calls[1].resolve(response('idle'));await r;g.fire(old);assert.equal(g.calls.length,2);assert.ok(g.canceled.includes(old));
});
test('completed status refreshes owned list, but pending list cannot commit after student switch',async()=>{
 const f=fixture(),p=f.c.loadMinutesBackfillStatus();f.calls[0].resolve(response('completed'));await tick();assert.equal(f.calls[1].method,'list');f.calls[1].resolve({});assert.equal(await p,true);assert.equal(f.listWrites.length,1);assert.match(f.elements['minutes-backfill-status'].textContent,/完了/);
 const g=fixture(),q=g.c.loadMinutesBackfillStatus();g.calls[0].resolve(response('completed'));await tick();g.c.minutesCurrentStudentId='synthetic';g.calls[1].resolve({});assert.equal(await q,false);assert.equal(g.listWrites.length,0);
});
test('stale status success/error leaves replacement panel and button unchanged',async()=>{
 for(const fail of [false,true]){const f=fixture(),p=f.c.loadMinutesBackfillStatus(),old=f.elements['minutes-backfill-status'];f.elements['minutes-backfill-status']=f.node();f.elements['minutes-backfill-status'].textContent='new';if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(response('running'));await p;assert.equal(old.innerHTML,'original');assert.equal(f.elements['minutes-backfill-status'].textContent,'new');assert.equal(f.timers.size,0);}
});
test('current start conflict failure reads existing job with private fixed notification and permits polling',async()=>{
 const f=fixture(),p=f.c.startMinutesBackfillFromPage();f.calls[0].reject(Error('private synthetic'));await tick();assert.equal(f.notices.length,1);assert.equal(f.notices[0][0].includes('private'),false);f.calls[1].resolve(response('running'));await p;assert.equal(f.elements['minutes-backfill-btn'].disabled,true);assert.equal(f.timers.size,1);
});
test('manual status during pending POST cannot unlock start and current read failure stays fixed',async()=>{
 const f=fixture(),p=f.c.startMinutesBackfillFromPage(),q=f.c.loadMinutesBackfillStatus();f.calls[1].resolve(response('idle'));await q;assert.equal(f.elements['minutes-backfill-btn'].disabled,true);f.calls[0].resolve({data:{success:true}});await tick();f.calls[2].reject(Error('private synthetic'));await p;assert.equal(f.elements['minutes-backfill-btn'].disabled,false);assert.equal(f.elements['minutes-backfill-status'].textContent.includes('private'),false);assert.equal(f.c.minutesBackfillPollTimer,null);
});
test('replacement panel polls while an old-context start is pending and unlocks after it settles',async()=>{
 for(const fail of [false,true]){const f=fixture(),p=f.c.startMinutesBackfillFromPage();f.elements['minutes-backfill-btn']=f.node();f.elements['minutes-backfill-status']=f.node();const q=f.c.loadMinutesBackfillStatus();if(fail)f.calls[1].reject(Error('private synthetic'));else f.calls[1].resolve(response('idle'));await q;assert.equal(f.elements['minutes-backfill-btn'].disabled,true);const timer=f.c.minutesBackfillPollTimer;assert.ok(timer);f.calls[0].resolve({data:{success:true}});await p;assert.equal(f.notices.length,0);f.fire(timer);f.calls[2].resolve(response('idle'));await tick();assert.equal(f.elements['minutes-backfill-btn'].disabled,false);}
});
