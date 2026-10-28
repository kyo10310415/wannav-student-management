import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/booking-prepare-events.js',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],requests=[],notices=[],logs=[],listeners=[],submits=[];
 const root=parent=>({root:parent,innerHTML:'',value:'',disabled:false,contains(n){for(let at=n;at;at=at.root)if(at===this)return true;return false},remove(){this.removed=true},addEventListener:(type,callback)=>submits.push({type,callback})});
 const elements={content:root(),'edit-booking-links-modal':root()};elements['booking-links-history']=root(elements['edit-booking-links-modal']);
 for(const id of ['edit-booking-links-form','booking-links-user-id','booking-links-regular-url','booking-links-pro-url','booking-links-original-regular-url','booking-links-original-pro-url'])elements[id]=root(elements['edit-booking-links-modal']);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'users',API_BASE:'',document:{getElementById:id=>elements[id]?.removed?null:elements[id],createElement:()=>{const n=root();Object.defineProperty(n,'id',{set(v){elements[v]=n}});return n},body:{appendChild:modal=>{for(const [id,n]of Object.entries(elements))if(id.startsWith('booking-links-')||id==='edit-booking-links-form')n.root=modal}},addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),formatDateTime:value=>String(value),showNotification:(...args)=>notices.push(args),saveTutorBookingLinks:()=>calls.push(['save']),axios:{get:async(...args)=>{requests.push(args);return{data:{data:[]}}}}};
 for(const fn of ['showEditBookingLinksModal','closeEditBookingLinksModal','restoreTutorBookingLinksFromHistory'])c[fn]=(...args)=>calls.push([fn,...args]);vm.createContext(c);vm.runInContext(source,c);
 const node=(action,data={},at=elements.content)=>{const n=root(at);n.dataset={bookingPrepareAction:action,...data};n.closest=s=>s==='button[data-booking-prepare-action]'?n:null;return n};
 const click=n=>c.handleBookingPrepareClick({target:n});const install=(start,end)=>{const i=app.indexOf(start),j=app.indexOf(end,i);assert.ok(i>=0&&j>i);vm.runInContext(app.slice(i,j),c)};
 return{c,elements,calls,requests,notices,logs,listeners,submits,root,node,click,install};
}
test('booking preparation delegates only fixed actions and passes the existing button unchanged',()=>{
 const f=fixture(),open=f.node('open',{userId:'7'}),restore=f.node('restore',{},f.elements['booking-links-history']);
 f.click(open);f.click(restore);f.click(f.node('close',{},f.elements['edit-booking-links-modal']));
 assert.equal(f.calls[0][0],'showEditBookingLinksModal');assert.equal(f.calls[0][1],open);assert.equal(f.calls[1][1],restore);assert.deepEqual(f.calls[2],['closeEditBookingLinksModal']);
 for(const action of ['save','constructor','__proto__','showEditBookingLinksModal'])f.click(f.node(action,{userId:'7'}));assert.equal(f.calls.length,3);assert.equal(f.listeners.length,1);assert.equal(f.requests.length,0);
});
test('booking controls enforce admin/session/current root/disabled, open page and safe ID boundaries',()=>{
 const f=fixture();for(const id of ['','0','-1','1.5','2e2','9007199254740992','7;save()'])f.click(f.node('open',{userId:id}));
 const old=f.node('open',{userId:'7'});f.elements.content=f.root();f.click(old);const n=f.node('open',{userId:'7'});n.disabled=true;f.click(n);n.disabled=false;
 for(const user of [null,{role:'crew'},{role:'leader'},{role:'unknown'}]){f.c.currentUser=user;f.click(n)}f.c.currentUser={role:'admin'};f.c.sessionToken='';f.click(n);f.c.sessionToken='synthetic';f.c.currentPage='today';f.click(n);
 f.click(f.node('close'));f.click(f.node('restore',{},f.elements['edit-booking-links-modal']));const stale=f.node('close',{},f.elements['edit-booking-links-modal']);f.elements['edit-booking-links-modal']=f.root();f.click(stale);
 assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
});
test('real booking modal encodes attribute quotes, preserves submit registration and loads history once without submitting',async()=>{
 const f=fixture();f.install('function showEditBookingLinksModal(', 'async function saveTutorBookingLinks(');let loaded=[];f.c.loadTutorBookingLinkHistory=id=>loaded.push(id);
 const special='Synthetic" autofocus data-injected="<&';await f.click(f.node('open',{userId:'7',email:special,tutorName:special,regularUrl:special,proUrl:special}));
 const html=f.elements['edit-booking-links-modal'].innerHTML;assert.ok(html.includes('value="Synthetic&quot; autofocus data-injected=&quot;&lt;&amp;"'));assert.ok(html.includes('data-booking-prepare-action="close"'));assert.ok(html.includes('Synthetic" autofocus data-injected="&lt;&amp;'));
 assert.deepEqual(loaded,['7']);assert.equal(f.submits.length,1);assert.equal(f.submits[0].type,'submit');assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
 f.click(f.node('close',{},f.elements['edit-booking-links-modal']));assert.equal(f.elements['edit-booking-links-modal'].removed,true);
});
test('real history reads only the existing GET endpoint and restores exact values locally',async()=>{
 const f=fixture();f.install('async function loadTutorBookingLinkHistory(', 'async function saveTutorBookingLinks(');const regular='https://fixture.invalid/regular?text="<&',pro='https://fixture.invalid/pro?text="<&';
 f.c.axios.get=async(...args)=>{f.requests.push(args);return{data:{data:[{changed_at:'Synthetic time',changed_by:'Synthetic admin',new_regular_url:regular,new_pro_url:pro}]}}};await f.c.loadTutorBookingLinkHistory('7');
 assert.equal(f.requests.length,1);assert.equal(f.requests[0][0],'/api/users/7/booking-links/history');assert.equal(f.requests[0][1].headers.Authorization,'Bearer synthetic-session');const html=f.elements['booking-links-history'].innerHTML;
 assert.ok(html.includes('data-regular-url="https://fixture.invalid/regular?text=&quot;&lt;&amp;"'));assert.match(html,/data-booking-prepare-action="restore"/);
 f.click(f.node('restore',{regularUrl:regular,proUrl:pro},f.elements['booking-links-history']));assert.equal(f.elements['booking-links-regular-url'].value,regular);assert.equal(f.elements['booking-links-pro-url'].value,pro);assert.equal(f.requests.length,1);assert.equal(f.notices.length,1);assert.equal(f.calls.length,0);
});
test('real history preserves empty/failure display and does not log raw exceptions',async()=>{
 const f=fixture();f.install('async function loadTutorBookingLinkHistory(', 'async function saveTutorBookingLinks(');await f.c.loadTutorBookingLinkHistory('7');assert.ok(f.elements['booking-links-history'].innerHTML.includes('保存済みの変更履歴はありません'));
 f.c.axios.get=async()=>{throw Error('Synthetic private error')};await f.c.loadTutorBookingLinkHistory('7');assert.deepEqual(f.logs,[['予約URL変更履歴の取得エラー']]);assert.ok(f.elements['booking-links-history'].innerHTML.includes('変更履歴を取得できませんでした'));assert.equal(f.elements['booking-links-history'].innerHTML.includes('Synthetic private error'),false);
});
test('exactly four booking attributes migrate while save confirmation and Discord configuration remain untouched',()=>{
 assert.equal((app.match(/data-booking-prepare-action=/g)||[]).length,4);for(const fn of ['showEditBookingLinksModal','closeEditBookingLinksModal','restoreTutorBookingLinksFromHistory'])assert.equal(new RegExp('onclick="'+fn+'\\(').test(app),false);
 assert.ok(app.includes("onclick=\"showEditDiscordModal(${user.id}, '${user.email}'"));assert.ok(app.includes("document.getElementById('edit-booking-links-form').addEventListener('submit', saveTutorBookingLinks)"));
 for(const expr of ['user.email','user.tutor_name',"user.funnel_regular_booking_url || ''","user.funnel_pro_booking_url || ''"]){assert.ok(app.includes('${escapeHtml('+expr+').replace(/"/g, \'&quot;\')}"'))}
});
