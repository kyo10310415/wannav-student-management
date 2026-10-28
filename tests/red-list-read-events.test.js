import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../public/red-list-read-events.js',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){const calls=[],requests=[],listeners=[];
 const root=parent=>({root:parent,innerHTML:'',value:'',className:'',contains(n){for(let p=n;p;p=p.root)if(p===this)return true;return false},classList:{values:new Set(['hidden']),toggle(key,force){if(force===undefined)force=!this.values.has(key);if(force)this.values.add(key);else this.values.delete(key);return force},add(key){this.values.add(key)},remove(key){this.values.delete(key)},contains(key){return this.values.has(key)}}});
 const elements={content:root()};for(const id of ['redlist-tab-current','redlist-tab-history','redlist-tab-messages','redlist-tab-senders','redlist-current-list','redlist-history-list','redlist-messages-panel','redlist-senders-panel','redlist-history-month','redlist-history-loading','redlist-history-content','score-breakdown-SYNTHETIC','rl-log-detail-SYNTHETIC','rl-log-chevron-SYNTHETIC'])elements[id]=root(elements.content);
 const c={currentUser:{role:'admin'},sessionToken:'synthetic',currentPage:'red-list',API_BASE:'',document:{getElementById:id=>elements[id]??null,addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log(){},error(){}},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 for(const name of ['switchRedListTab','loadRedListHistoryData','showScoreBreakdown','toggleRedListLogDetail'])c[name]=(...args)=>calls.push([name,...args]);
 vm.createContext(c);vm.runInContext(source,c);
 const node=(selector,dataset={},at=elements.content)=>{const n={root:at,dataset,disabled:false,value:'2026-10'};n.closest=s=>s===selector?n:null;return n};
 const button=(action,data={},at=elements.content)=>node('button[data-red-list-read-action]',{redListReadAction:action,...data},at);
 const click=n=>c.handleRedListReadClick({target:n});const install=(start,end)=>{const i=app.indexOf(start),j=app.indexOf(end,i);assert.ok(i>=0&&j>i);vm.runInContext(app.slice(i,j),c)};
 return{c,elements,calls,requests,listeners,root,node,button,click,install};
}
test('seven read attributes migrate while calculation, send and status controls remain',()=>{
 assert.equal((app.match(/data-red-list-read-action=/g)||[]).length,6);assert.equal((app.match(/data-red-list-history-month/g)||[]).length,1);
 for(const fn of ['switchRedListTab','loadRedListHistoryData','showScoreBreakdown','toggleRedListLogDetail'])assert.equal(new RegExp('on(?:click|change)="'+fn+'\\(').test(app),false);
 for(const fn of ['updateRedListData()','exportRedListCsv()'])assert.ok(app.includes('onclick="'+fn));assert.ok(app.includes('data-red-list-card-action="status"'));assert.ok(app.includes('data-red-list-card-action="ex"'));
});
test('fixed read actions forward exact IDs/month and only toggle existing current content targets',()=>{
 const f=fixture();for(const tab of ['current','history','messages','senders'])f.click(f.button('tab',{redListTab:tab}));
 f.click(f.button('score',{redListStudentId:'SYNTHETIC'}));f.click(f.button('log',{redListStudentId:'SYNTHETIC',redListYearMonth:'2026-10'}));
 assert.deepEqual(f.calls,[...['current','history','messages','senders'].map(v=>['switchRedListTab',v]),['showScoreBreakdown','SYNTHETIC'],['toggleRedListLogDetail','SYNTHETIC','2026-10']]);
 for(const action of ['constructor','__proto__','updateRedListData'])f.click(f.button(action));f.click(f.button('tab',{redListTab:'unknown'}));f.click(f.button('score',{redListStudentId:'missing'}));f.click(f.button('log',{redListStudentId:'SYNTHETIC',redListYearMonth:'2026-13'}));assert.equal(f.calls.length,6);
});
test('all three roles retain read access while missing auth/page/disabled/stale roots reject',()=>{
 const f=fixture();for(const role of ['admin','leader','crew']){f.c.currentUser={role};f.click(f.button('tab',{redListTab:'current'}))}assert.equal(f.calls.length,3);
 const old=f.button('tab',{redListTab:'history'});f.elements.content=f.root();f.click(old);const n=f.button('tab',{redListTab:'history'});n.disabled=true;f.click(n);n.disabled=false;
 for(const user of [null,{role:'unknown'}]){f.c.currentUser=user;f.click(n)}f.c.currentUser={role:'admin'};f.c.sessionToken='';f.click(n);f.c.sessionToken='synthetic';f.c.currentPage='today';f.click(n);assert.equal(f.calls.length,3);
});
test('real tab changes preserve initial message/sender reads, cached revisits and panel visibility',()=>{
 const f=fixture();f.c.redListMessages=[];f.c.redListSenders=[];f.c.updateRedListStats=()=>f.calls.push(['stats']);f.c.loadRedListMessages=()=>{f.calls.push(['messages-get']);f.c.redListMessages=[{}]};f.c.loadRedListSenders=()=>{f.calls.push(['senders-get']);f.c.redListSenders=[{}]};
 f.install('function switchRedListTab(tab)','async function loadRedListCurrentData()');for(const tab of ['messages','messages','senders','senders','history','current'])f.click(f.button('tab',{redListTab:tab}));
 assert.deepEqual(f.calls,[['messages-get'],['senders-get'],['stats'],['stats']]);assert.equal(f.c.currentRedListTab,'current');assert.equal(f.elements['redlist-current-list'].classList.contains('hidden'),false);assert.equal(f.elements['redlist-history-list'].classList.contains('hidden'),true);
});
test('month delegation accepts empty or valid month only and real history reader keeps GET/filter/failure contracts',async()=>{
 const f=fixture();let select=f.node('select[data-red-list-history-month]');select.value='';f.c.handleRedListHistoryMonthChange({target:select});select.value='2026-10';f.c.handleRedListHistoryMonthChange({target:select});for(const value of ['2026-00','2026-13','not-month','2026-1','']){if(!value)continue;select.value=value;f.c.handleRedListHistoryMonthChange({target:select})}assert.equal(f.calls.length,2);f.calls.length=0;
 f.install('async function loadRedListHistoryData()', 'function renderRedListHistoryList()');f.elements['redlist-history-month'].value='2026-10';f.c.axios={get:async url=>{f.requests.push(['get',url]);return{data:{success:true,data:[{student_id:'A',final_rank:'high'},{student_id:'B',final_rank:'none'},{student_id:'C',final_ex_rank:true}]}}}};
 f.c.fetchRedListDiscordLogs=async month=>f.calls.push(['logs-get',month]);f.c.renderRedListHistoryList=()=>f.calls.push(['render']);f.c.updateRedListStats=()=>f.calls.push(['stats']);
 await f.c.handleRedListHistoryMonthChange({target:select=Object.assign(f.elements['redlist-history-month'],{closest:()=>f.elements['redlist-history-month']})});
 assert.deepEqual(f.requests,[['get','/api/red-list/history?yearMonth=2026-10']]);assert.deepEqual(JSON.parse(JSON.stringify(f.c.historyRedListData)).map(v=>v.student_id),['A','C']);assert.deepEqual(f.calls,[['logs-get','2026-10'],['render'],['stats']]);assert.equal(f.elements['redlist-history-loading'].classList.contains('hidden'),true);
 f.c.axios.get=async()=>{throw Error('Synthetic failure')};await f.c.loadRedListHistoryData();assert.ok(f.elements['redlist-history-content'].innerHTML.includes('読み込みに失敗'));f.elements['redlist-history-month'].value='';await f.c.loadRedListHistoryData();assert.equal(f.elements['redlist-history-content'].innerHTML,'');
});
test('real score and Discord log toggles only change local visibility and chevron',()=>{
 const f=fixture();f.install('function showScoreBreakdown(studentId)','async function updateRedListStatus(');f.install('function toggleRedListLogDetail(studentId, yearMonth)','// ═══════════════════════════════════════════════════════════════');
 f.click(f.button('score',{redListStudentId:'SYNTHETIC'}));assert.equal(f.elements['score-breakdown-SYNTHETIC'].classList.contains('hidden'),false);
 for(const expected of ['fas fa-chevron-up text-xs','fas fa-chevron-down text-xs']){f.click(f.button('log',{redListStudentId:'SYNTHETIC',redListYearMonth:'2026-10'}));assert.equal(f.elements['rl-log-chevron-SYNTHETIC'].className,expected)}assert.equal(f.requests.length,0);
});
test('Discord log markup protects matching data/target IDs and month attribute quote boundaries',()=>{
 const f=fixture();f.install('function renderRedListDiscordLogs(studentId, yearMonth)','function toggleRedListLogDetail(');const id='Synthetic" <&',month='2026-10';f.c.redListDiscordLogs={[id+'_'+month]:[{sent_at:'2026-10-01T00:00:00Z',sent_by:'Synthetic',message_title:'Synthetic message',message_content:'Synthetic'}]};
 const html=f.c.renderRedListDiscordLogs(id,month),escaped='Synthetic&quot; &lt;&amp;';assert.ok(html.includes('data-red-list-student-id="'+escaped+'"'));assert.ok(html.includes('id="rl-log-detail-'+escaped+'"'));assert.ok(html.includes('id="rl-log-chevron-'+escaped+'"'));assert.ok(html.includes('data-red-list-year-month="2026-10"'));
});
