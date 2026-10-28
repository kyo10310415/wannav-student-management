import test from 'node:test';import assert from 'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../public/minutes-template-events.js',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],requests=[],listeners=[];const root=parent=>({root:parent,innerHTML:'',contains(n){for(let p=n;p;p=p.root)if(p===this)return true;return false},classList:{hidden:true,add(){this.hidden=true},remove(){this.hidden=false},contains(){return this.hidden}}});
 const elements={content:root()};elements['minutes-template-modal']=root(elements.content);elements['minutes-template-editor']=root(elements['minutes-template-modal']);elements['minutes-template-save-btn']=root(elements['minutes-template-modal']);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'minutes',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),axios:{get:async(...args)=>{requests.push(args);return{data:{data:[]}}}},showMinutesTemplateModal:()=>calls.push(['open']),closeMinutesTemplateModal:()=>calls.push(['close'])};vm.createContext(c);vm.runInContext(source,c);
 const button=(action,at=elements.content)=>{const n={root:at,disabled:false,dataset:{minutesTemplateAction:action}};n.closest=s=>s==='button[data-minutes-template-action]'?n:null;return n};
 const click=n=>c.handleMinutesTemplateClick({target:n});const real=()=>vm.runInContext(app.slice(app.indexOf('async function showMinutesTemplateModal()'),app.indexOf('async function saveMinutesTemplate()')),c);
 return{c,elements,calls,requests,listeners,root,button,click,real};
}
test('template open/close use one fixed listener and close only the current dedicated modal',async()=>{
 const f=fixture();assert.equal(f.listeners.length,1);await f.click(f.button('open'));await f.click(f.button('close',f.elements['minutes-template-modal']));await f.click(f.button('close'));await f.click(f.button('constructor'));assert.deepEqual(f.calls,[['open'],['close']]);
});
test('template guards reject crew, missing session, disabled, obsolete content and wrong page',async()=>{
 const f=fixture();const old=f.button('open');f.elements.content=f.root();await f.click(old);const n=f.button('open');n.disabled=true;await f.click(n);n.disabled=false;
 for(const user of [null,{role:'crew'},{role:'unknown'}]){f.c.currentUser=user;await f.click(n)}f.c.currentUser={role:'admin'};f.c.sessionToken='';await f.click(n);f.c.sessionToken='synthetic';f.c.currentPage='students';await f.click(n);assert.equal(f.calls.length,0);
 f.c.currentPage='minutes';f.c.currentUser={role:'leader'};await f.click(n);assert.deepEqual(f.calls,[['open']]);
});
test('real template GET renders only the first template with protected ID/name attributes and text',async()=>{
 const f=fixture();f.real();const special='Synthetic" autofocus data-injected="<&';f.c.axios.get=async(...args)=>{f.requests.push(args);return{data:{data:[{id:special,name:special,template_text:'Synthetic </textarea><script>'},{id:'other',name:'Other template'}]}}};
 await f.click(f.button('open'));assert.equal(f.requests.length,1);assert.equal(f.requests[0][0],'/api/minutes/templates');assert.equal(f.requests[0][1].headers.Authorization,'Bearer synthetic');
 const html=f.elements['minutes-template-editor'].innerHTML;assert.equal((html.match(/value="Synthetic&quot; autofocus data-injected=&quot;&lt;&amp;"/g)||[]).length,2);assert.ok(html.includes('Synthetic &lt;/textarea&gt;&lt;script&gt;'));assert.equal(html.includes('Other template'),false);assert.equal(f.elements['minutes-template-modal'].classList.hidden,false);
 await f.click(f.button('close',f.elements['minutes-template-modal']));assert.equal(f.elements['minutes-template-modal'].classList.hidden,true);
});
test('empty and failed template reads retain safe states without exposing raw error contents',async()=>{
 const f=fixture();f.real();await f.click(f.button('open'));assert.ok(f.elements['minutes-template-editor'].innerHTML.includes('テンプレートが見つかりません'));
 f.c.axios.get=async()=>{throw Error('Synthetic private <img src=x>')};await f.click(f.button('open'));const html=f.elements['minutes-template-editor'].innerHTML;assert.ok(html.includes('テンプレートを読み込めませんでした'));assert.equal(html.includes('Synthetic private'),false);assert.equal(html.includes('<img'),false);
});
test('only three template attributes migrate and all generation/save/delete controls remain',()=>{
 assert.equal((app.match(/data-minutes-template-action=/g)||[]).length,4);for(const old of ['onclick="showMinutesTemplateModal()"','onclick="closeMinutesTemplateModal()"'])assert.equal(app.includes(old),false);
 for(const unchanged of ['onclick="generateMinutes()"','onclick="startMinutesBackfillFromPage()"','onclick="saveMinutesEdit()"','onclick="event.stopPropagation(); deleteMinutes(${m.id})"'])assert.ok(app.includes(unchanged));
});
