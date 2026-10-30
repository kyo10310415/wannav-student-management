import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const block=source.slice(source.indexOf('const minutesPendingWrites ='),source.indexOf('async function deleteMinutes(',source.indexOf('const minutesPendingWrites =')));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(edit=false){
 const calls=[],notices=[],listWrites=[],detailWrites=[],callbacks=[];const nodes=[];
 const classes=hidden=>({values:new Set(hidden?['hidden']:[]),contains(key){return this.values.has(key)},add(key){this.values.add(key)},remove(key){this.values.delete(key)}});
 const node=(value='',hidden=false)=>{const n={value,disabled:false,innerHTML:'original',textContent:'',classList:classes(hidden),connected:true};nodes.push(n);return n};
 const elements={content:{contains:n=>nodes.includes(n)&&n.connected}};
 for(const id of ['minutes-gen-date','minutes-gen-number','minutes-gen-btn','minutes-gen-status','minutes-detail-modal','minutes-modal-text','minutes-modal-save-btn'])elements[id]=node('',id==='minutes-detail-modal'&&!edit);
 elements['minutes-gen-date'].value='2026-10-30';elements['minutes-gen-number'].value=' L3 ';elements['minutes-modal-text'].value=' edited body\n';
 const modal=elements['minutes-detail-modal'];modal.contains=n=>[elements['minutes-modal-text'],elements['minutes-modal-save-btn']].includes(n)&&n.connected;
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'leader'},currentPage:'minutes',minutesCurrentStudentId:'synthetic',minutesCurrentStudentName:'Synthetic',minutesEditingId:edit?27:null,minutesCurrentDetail:edit?{id:27,generated_text:'old'}:null,document:{getElementById:id=>elements[id]??null},showNotification:(...args)=>notices.push(args),studentDisplayText:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 const send=(method,args=[])=>{const d=defer();calls.push({method,args,...d});return d.promise};c.axios={post:(...args)=>send('post',args),put:(...args)=>send('put',args)};
 c.loadMinutesList=async(parent=()=>true)=>{callbacks.push(parent);await send('list');if(!parent())return false;listWrites.push(c.minutesCurrentStudentId);return true};
 c.openMinutesDetail=async(id,parent=()=>true)=>{callbacks.push(parent);await send('detail',[id]);if(!parent())return false;detailWrites.push(id);c.minutesEditingId=id;c.minutesCurrentDetail={id};modal.classList.remove('hidden');return true};
 c.closeMinutesModal=()=>{modal.classList.add('hidden');c.minutesEditingId=null;c.minutesCurrentDetail=null};
 vm.createContext(c);vm.runInContext(block,c);return{c,calls,notices,listWrites,detailWrites,callbacks,elements,nodes,node,modal};
}
const generated={data:{success:true,data:{id:27}}},saved={data:{success:true}},tick=()=>new Promise(r=>setImmediate(r));
test('normal generation preserves payload and chains guarded list then detail with warning escaped',async()=>{
 const f=fixture(),p=f.c.generateMinutes();assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'post');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args[1])),{studentId:'synthetic',studentName:'Synthetic',lessonDate:'2026-10-30',lessonNumber:'L3'});assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer fixture-token');assert.equal(f.calls[0].args[2].timeout,120000);f.calls[0].resolve({data:{...generated.data,warning:'<b>synthetic</b>'}});await tick();assert.equal(f.calls[1].method,'list');f.calls[1].resolve({});await tick();assert.equal(f.calls[2].method,'detail');f.calls[2].resolve({});await p;assert.deepEqual(f.listWrites,['synthetic']);assert.deepEqual(f.detailWrites,[27]);assert.equal(f.notices[0][0].includes('<b>'),false);assert.equal(f.elements['minutes-gen-btn'].disabled,false);assert.equal(f.elements['minutes-gen-btn'].innerHTML,'original');
});
test('generation duplicates are suppressed including same-student/date after control replacement',async()=>{
 const f=fixture(),p=f.c.generateMinutes();await f.c.generateMinutes();assert.equal(f.calls.length,1);f.elements['minutes-gen-btn']=f.node();await f.c.generateMinutes();assert.equal(f.calls.length,1);f.calls[0].resolve(generated);await p;assert.equal(f.notices.length,0);
});
test('stale generation success or failure never changes target status or starts list/detail',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentId='other',f=>f.c.minutesCurrentStudentName='Other',f=>f.elements.content={},f=>f.elements['minutes-gen-date'].value='2026-10-31',f=>f.elements['minutes-gen-number'].value='L4',f=>f.elements['minutes-gen-status']=f.node(),f=>f.c.minutesEditingId=99,f=>f.c.minutesCurrentDetail={id:99}];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),status=f.elements['minutes-gen-status'],p=f.c.generateMinutes();change(f);status.textContent='new draft';if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(generated);await p;assert.equal(f.notices.length,0);assert.equal(f.calls.length,1);assert.equal(status.textContent,'new draft');}
});
test('generation-owned list callback prevents old list write and detail open after switching student',async()=>{
 const f=fixture(),p=f.c.generateMinutes();f.calls[0].resolve(generated);await tick();f.c.minutesCurrentStudentId='other';f.calls[1].resolve({});await p;assert.equal(f.calls.length,2);assert.equal(f.listWrites.length,0);assert.equal(f.detailWrites.length,0);
});
test('normal edit save preserves exact text payload and refreshes only the closed owned modal context',async()=>{
 const f=fixture(true);f.c.minutesCurrentStudentId=null;f.c.minutesCurrentStudentName=null;const p=f.c.saveMinutesEdit();await f.c.saveMinutesEdit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[0],'/api/minutes/27');assert.equal(f.calls[0].args[1].generated_text,' edited body\n');assert.equal(f.elements['minutes-modal-save-btn'].disabled,true);f.calls[0].resolve(saved);await tick();assert.equal(f.calls[1].method,'list');assert.equal(f.c.minutesEditingId,null);f.calls[1].resolve({});await p;assert.equal(f.listWrites.length,1);assert.equal(f.elements['minutes-modal-save-btn'].disabled,false);
});
test('stale edit save completion cannot close a changed modal or clear a new draft',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.c.minutesCurrentStudentId='other',f=>f.elements.content={},f=>f.c.minutesEditingId=99,f=>f.c.minutesCurrentDetail={id:27},f=>f.elements['minutes-modal-text'].value='new draft',f=>f.modal.classList.add('hidden'),f=>f.elements['minutes-detail-modal']=f.node()];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(true),p=f.c.saveMinutesEdit();change(f);const id=f.c.minutesEditingId;if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(saved);await p;assert.equal(f.c.minutesEditingId,id);assert.equal(f.notices.length,0);assert.equal(f.calls.length,1);}
});
test('edit-owned list callback ignores reopened detail and private failures keep current draft retryable',async()=>{
 const f=fixture(true),p=f.c.saveMinutesEdit();f.calls[0].resolve(saved);await tick();f.c.minutesEditingId=99;f.c.minutesCurrentDetail={id:99};f.modal.classList.remove('hidden');f.calls[1].resolve({});await p;assert.equal(f.listWrites.length,0);assert.equal(f.c.minutesEditingId,99);
 const g=fixture(true),q=g.c.saveMinutesEdit();g.calls[0].reject(Error('private synthetic'));await q;assert.equal(g.notices.length,1);assert.equal(g.notices[0][0].includes('private'),false);assert.equal(g.elements['minutes-modal-text'].value,' edited body\n');assert.equal(g.elements['minutes-modal-save-btn'].disabled,false);const r=g.c.saveMinutesEdit();g.calls[1].reject(Error('private synthetic'));await r;assert.equal(g.calls.length,2);
});
test('write gates reject crew unknown context disabled hidden modal and current generation failure stays fixed',async()=>{
 for(const mutate of [f=>f.c.sessionToken=null,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='today',f=>f.elements['minutes-gen-btn'].disabled=true]){const f=fixture();mutate(f);await f.c.generateMinutes();assert.equal(f.calls.length,0);}
 for(const mutate of [f=>f.c.currentUser.role='crew',f=>f.modal.classList.add('hidden'),f=>f.elements['minutes-modal-save-btn'].classList.add('hidden'),f=>f.elements['minutes-modal-save-btn'].disabled=true]){const f=fixture(true);mutate(f);await f.c.saveMinutesEdit();assert.equal(f.calls.length,0);}
 const f=fixture(),p=f.c.generateMinutes();f.calls[0].reject(Error('private synthetic'));await p;assert.equal(f.notices[0][0].includes('private'),false);assert.equal(f.elements['minutes-gen-status'].textContent.includes('private'),false);assert.equal(f.elements['minutes-gen-btn'].disabled,false);
});
