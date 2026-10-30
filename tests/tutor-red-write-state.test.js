import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const extract=name=>{const a=source.indexOf(`function ${name}(`);assert.ok(a>=0,name);return(source.slice(a-6,a)==='async '?'async ':'')+source.slice(a,source.indexOf('\n}',a)+2)};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const calls=[],notices=[],logs=[],renders=[],confirmations=[],controls=[],entry={tutor_id:'fixture/id"',tutor_name:'Synthetic <b>name</b>',correspondence_status:'未対応',assigned_to:'old owner'};
 const root={contains:node=>controls.includes(node)&&node.connected,querySelectorAll:selector=>{assert.equal(selector,'[data-tutor-red-id]');return controls}},elements={content:root};
 function control(action,value='',id=entry.tutor_id){const node={disabled:false,connected:true,value,className:'border-gray-300 text-gray-600',classList:{add(...args){node.added=args}},dataset:{tutorRedAction:action,tutorRedId:id},closest(){return this}};controls.push(node);return node}
 const status=control('status','対応中'),assigned=control('assigned','new owner'),remove=control('delete');elements[`trl-status-${entry.tutor_id}`]=status;
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'admin'},currentPage:'tutor-red-list',tutorRedListYear:2026,tutorRedListMonth:10,tutorRedListData:[entry],API_BASE:'',document:{getElementById:id=>elements[id]??null},confirm:text=>{confirmations.push(text);return true},console:{error:m=>logs.push(m)},showNotification:(...args)=>notices.push(args),studentDisplayText:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),_renderTutorRedListContent:()=>renders.push('render')};
 const send=(method,args)=>{const d=defer();calls.push({method,args,...d});return d.promise};c.axios={patch:(...args)=>send('patch',args),delete:(...args)=>send('delete',args)};
 vm.createContext(c);vm.runInContext('const tutorRedPendingWrites=new Set();\n'+['beginTutorRedWrite','updateTutorRedListStatus','updateTutorRedListAssigned','deleteTutorRedListEntry','tutorRedCardEntry','handleTutorRedCardChange','handleTutorRedCardClick'].map(extract).join('\n'),c);
 return{c,calls,notices,logs,renders,confirmations,controls,control,status,assigned,remove,entry,root,elements};
}
const ok={data:{success:true}};
const start=(f,action)=>action==='status'?f.c.updateTutorRedListStatus(f.entry.tutor_id,f.status.value,f.status):action==='assigned'?f.c.updateTutorRedListAssigned(f.entry.tutor_id,f.assigned.value,f.assigned):f.c.deleteTutorRedListEntry(f.entry.tutor_id,'ignored',f.remove);
test('normal fixed status and assignment preserve payload and encoded ID while mutually disabling same Tutor controls',async()=>{
 const f=fixture(),p=f.c.handleTutorRedCardChange({target:f.status});assert.equal(f.controls.every(c=>c.disabled),true);assert.equal(f.calls[0].args[0],'/api/tutor-red-list/'+encodeURIComponent(f.entry.tutor_id)+'/status');assert.equal(f.calls[0].args[1].correspondence_status,'対応中');assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer fixture-token');await start(f,'assigned');await start(f,'delete');assert.equal(f.calls.length,1);f.calls[0].resolve(ok);await p;assert.equal(f.entry.correspondence_status,'対応中');assert.ok(f.status.added.includes('border-blue-400'));assert.equal(f.controls.some(c=>c.disabled),false);
 f.assigned.value='';const q=f.c.handleTutorRedCardChange({target:f.assigned});assert.equal(f.calls[1].args[1].assigned_to,'');f.calls[1].resolve(ok);await q;assert.equal(f.entry.assigned_to,'');assert.equal(f.notices.length,2);
});
test('all three existing status choices remain accepted and unknown values rejected',async()=>{
 for(const value of ['未対応','対応中','対応済み']){const f=fixture();f.status.value=value;const p=start(f,'status');f.calls[0].resolve(ok);await p;assert.equal(f.entry.correspondence_status,value)}
 const f=fixture();f.status.value='invalid';await start(f,'status');assert.equal(f.calls.length,0);
});
test('stale status assignment and delete success/error never mutate new context or notify',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='leader',f=>f.c.currentPage='today',f=>f.elements.content={},f=>f.c.tutorRedListYear=2027,f=>f.c.tutorRedListMonth=11,f=>f.c.tutorRedListData=[{...f.entry}],f=>f.entry.tutor_name='changed',f=>f.status.connected=false,f=>f.assigned.dataset.tutorRedId='other'];
 for(const action of ['status','assigned','delete'])for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=start(f,action);change(f);const cache=f.c.tutorRedListData,beforeStatus=f.entry.correspondence_status,beforeAssigned=f.entry.assigned_to;if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(ok);await p;assert.equal(f.c.tutorRedListData,cache);assert.equal(f.entry.correspondence_status,beforeStatus);assert.equal(f.entry.assigned_to,beforeAssigned);assert.equal(f.notices.length,0);assert.equal(f.logs.length,0);assert.equal(f.renders.length,0)}
});
test('delete confirmation cancel and confirmation-time auth change send nothing; normal deletion keeps escaped toast',async()=>{
 const f=fixture();f.c.confirm=()=>false;await start(f,'delete');assert.equal(f.calls.length,0);assert.equal(f.controls.some(c=>c.disabled),false);
 f.c.confirm=()=>{f.c.sessionToken='new';return true};await start(f,'delete');assert.equal(f.calls.length,0);
 const g=fixture(),p=g.c.handleTutorRedCardClick({target:g.remove});assert.equal(g.confirmations.length,1);assert.match(g.confirmations[0],/次回の再計算/);assert.equal(g.calls[0].args[0],'/api/tutor-red-list/'+encodeURIComponent(g.entry.tutor_id));g.calls[0].resolve(ok);await p;assert.equal(g.c.tutorRedListData.length,0);assert.equal(g.renders.length,1);assert.equal(g.notices[0][0].includes('<b>'),false);assert.match(g.notices[0][0],/&lt;b&gt;/);
});
test('current failure restores captured value releases lock and uses fixed private messages',async()=>{
 for(const action of ['status','assigned','delete']){const f=fixture(),p=start(f,action);f.calls[0].reject(Error('private synthetic'));await p;assert.equal(f.notices.length,1);assert.equal(f.logs.length,1);assert.equal(f.notices[0][0].includes('private'),false);assert.equal(f.controls.some(c=>c.disabled),false);if(action==='status')assert.equal(f.status.value,'未対応');if(action==='assigned')assert.equal(f.assigned.value,'old owner');const q=start(f,action);f.calls[1].resolve(ok);await q;assert.equal(f.calls.length,2)}
});
test('different Tutor writes can complete independently while duplicate and delete conflicts remain blocked',async()=>{
 const f=fixture(),other={tutor_id:'other',tutor_name:'Other',correspondence_status:'未対応',assigned_to:''};f.c.tutorRedListData.push(other);const input=f.control('assigned','Other owner','other');const p=start(f,'status'),q=f.c.updateTutorRedListAssigned('other',input.value,input);assert.equal(f.calls.length,2);await start(f,'delete');assert.equal(f.calls.length,2);f.calls[1].resolve(ok);await q;f.calls[0].resolve(ok);await p;assert.equal(other.assigned_to,'Other owner');assert.equal(f.entry.correspondence_status,'対応中');
});
test('entry and operation gates reject non-admin unknown target detached and disabled controls',async()=>{
 for(const change of [f=>f.c.sessionToken=null,f=>f.c.currentUser.role='leader',f=>f.c.currentUser.role='crew',f=>f.c.currentPage='today',f=>f.c.tutorRedListData=[],f=>f.status.connected=false,f=>f.status.disabled=true,f=>f.status.dataset.tutorRedId='other']){const f=fixture();change(f);await start(f,'status');assert.equal(f.calls.length,0);}
});
