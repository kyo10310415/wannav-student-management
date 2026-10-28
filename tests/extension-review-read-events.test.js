import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/extension-review.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fixture() {
  const calls = [], requests = [], writes = [], notices = [], listeners = [];
  const element = () => ({ innerHTML: '', textContent: '', value: '', contains(button) { return button.root === this; } });
  const elements = Object.fromEntries(['content','extension-review-nav','er-panel','er-history-list','er-search','er-filter-tutor','er-filter-round','er-from','er-to','er-sort'].map(id => [id, element()]));
  const context = { currentUser: null, sessionToken: null, API_BASE: '', URLSearchParams,
    document: { getElementById: id => elements[id] || null, addEventListener: (type, callback) => listeners.push({type, callback}) },
    console: {log(){},error(){}}, setTimeout(){}, showNotification: (...args) => notices.push(args),
    axios: async options => { requests.push(options); return {data:{data:[]}}; },
    changePage: async page => calls.push(['open-page',page]) };
  vm.createContext(context); vm.runInContext(source, context);
  context.currentUser = {role:'admin'}; context.sessionToken = 'synthetic-session';
  vm.runInContext('extensionReviewFeatureEnabled = true;',context);
  for (const name of ['erGenerate','erReview','erEdit','erSaveEdit','erSaveSettings','erDiagnose']) context[name] = (...args) => writes.push([name,...args]);
  function stubReads() {
    context.erSelectTab = async tab => calls.push(['select-tab',tab]);
    context.erSearchHistory = async offset => calls.push(['search-history',offset]);
    context.erOpenResult = async id => calls.push(['open-result',id]);
  }
  function button(action, data={}, root=elements.content) {
    const node={dataset:{erReadAction:action,...data},disabled:false,root};
    node.closest=selector => selector === 'button[data-er-read-action]' ? node : null;
    return node;
  }
  const click = (node,nested=false) => listeners[0].callback({target:nested?{closest:()=>node}:node});
  return {context,elements,calls,requests,writes,notices,listeners,element,button,click,stubReads};
}
const row = (id='synthetic-result') => ({id,created_at:'2026-10-28T00:00:00Z',student_name:'Synthetic <student>',student_id:'SYNTHETIC',tutor_name:'Synthetic Tutor',round:1,score:75,state:'succeeded',total:100});

test('read-only entry/tab/history controls use namespaced data and preserve write controls for later migration', () => {
  assert.match(appSource, /<button data-er-read-action="open-page"/);
  assert.match(source, /data-er-read-action="select-tab" data-er-tab=/);
  assert.match(source, /data-er-read-action="search-history" data-er-offset="0"/);
  assert.equal(/onclick="(?:erSelectTab|erSearchHistory|erOpenResult)\(/.test(source),false);
  for (const action of ['erGenerate()','erReview(false)','erReview(true)','erSaveEdit()','erSaveSettings()']) assert.ok(source.includes(`onclick="${action}"`));
  assert.ok(appSource.includes('data-er-read-action="open-tutor-analysis"'));
  assert.equal(appSource.includes('onclick="erOpenTutorAnalysis(this.dataset.tutor)"'),false);
});

test('one stable delegated listener handles nested targets and newly recreated navigation/content roots once', async () => {
  const f=fixture(); f.stubReads();
  assert.equal(f.listeners.filter(l=>l.type==='click').length,1); assert.equal(f.listeners[0].type,'click'); assert.equal(f.listeners.filter(l=>l.type==='change').length,1);
  await f.click(f.button('open-page',{},f.elements['extension-review-nav']),true);
  const old=f.elements.content;
  const obsolete=f.button('search-history',{erOffset:'0'},old);
  f.elements.content=f.element(); f.elements['extension-review-nav']=f.element();
  await f.click(obsolete);
  await f.click(f.button('select-tab',{erTab:'history'}),true);
  await f.click(f.button('open-page',{},f.elements['extension-review-nav']));
  assert.deepEqual(f.calls,[['open-page','extension-review'],['select-tab','history'],['open-page','extension-review']]);
  assert.equal(f.listeners.filter(l=>l.type==='click').length,1); assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
});

test('disabled, outside, non-admin, missing-session and disabled-feature clicks do not dispatch or request', async () => {
  const f=fixture(); f.stubReads();
  const disabled=f.button('open-page'); disabled.disabled=true; await f.click(disabled);
  await f.click(f.button('open-page',{},f.element()));
  await f.listeners[0].callback({target:{}});
  for (const user of [null,{role:'crew'},{role:'leader'},{role:'unknown'}]) {
    f.context.currentUser=user;
    await f.click(f.button('search-history',{erOffset:'0'}));
  }
  f.context.currentUser={role:'admin'}; f.context.sessionToken='';
  await f.click(f.button('open-result',{erResultId:'synthetic'}));
  f.context.sessionToken='synthetic-session'; vm.runInContext('extensionReviewFeatureEnabled=false;',f.context);
  await f.click(f.button('select-tab',{erTab:'history'}));
  assert.equal(f.calls.length,0); assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
});

test('dispatcher allows only fixed read actions, tabs, safe integer offsets and nonempty result IDs', async () => {
  const f=fixture(); f.stubReads();
  for (const action of ['generate','erGenerate','confirm','save-settings','__proto__','constructor','unknown']) await f.click(f.button(action));
  for (const erTab of ['', 'unknown', '__proto__', 'run;erGenerate()']) await f.click(f.button('select-tab',{erTab}));
  for (const erOffset of ['', '-1', '1.5', '2e2', 'Infinity', '9007199254740992', ' 50', '50 ']) await f.click(f.button('search-history',{erOffset}));
  await f.click(f.button('open-result',{})); await f.click(f.button('open-result',{erResultId:''}));
  assert.equal(f.calls.length,0); assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
  for (const erTab of ['run','result','history','analysis','settings','diagnostics']) await f.click(f.button('select-tab',{erTab}));
  for (const erOffset of ['0','50']) await f.click(f.button('search-history',{erOffset}));
  await f.click(f.button('open-result',{erResultId:"synthetic'\"<&>"}));
  assert.deepEqual(f.calls.slice(0,6).map(call=>call[1]),['run','result','history','analysis','settings','diagnostics']);
  assert.deepEqual(f.calls.slice(6),[['search-history',0],['search-history',50],['open-result',"synthetic'\"<&>"]]);
  assert.equal(f.writes.length,0);
});

test('real history reader preserves filters/query, escapes result attributes and retains pagination disabled contracts', async () => {
  const f=fixture();
  Object.assign(f.elements['er-search'],{value:'Synthetic & query'}); f.elements['er-filter-tutor'].value='T1';
  f.elements['er-filter-round'].value='2'; f.elements['er-from'].value='2026-09-01'; f.elements['er-to'].value='2026-10-28'; f.elements['er-sort'].value='score';
  const special="synthetic'\"<&>";
  let rows=Array.from({length:50},(_,i)=>row(i===0?special:`synthetic-${i}`));
  f.context.axios=async options=>{f.requests.push(options);return {data:{data:rows}}};
  await f.context.erSearchHistory(0);
  const query=new URL(f.requests[0].url,'https://fixture.invalid').searchParams;
  assert.equal(query.get('student'),'Synthetic & query'); assert.equal(query.get('tutor'),'T1');
  assert.equal(query.get('round'),'2'); assert.equal(query.get('from'),'2026-09-01'); assert.equal(query.get('to'),'2026-10-28');
  assert.equal(query.get('sort'),'score'); assert.equal(query.get('offset'),'0'); assert.equal(query.get('limit'),'50');
  const first=f.elements['er-history-list'].innerHTML;
  assert.ok(first.includes(`data-er-result-id="${f.context.erEscape(special)}"`)); assert.ok(first.includes('Synthetic &lt;student&gt;'));
  assert.match(first,/data-er-offset="0" disabled/); assert.match(first,/data-er-offset="50" >次へ/);
  assert.equal(/onclick="er(?:OpenResult|SearchHistory)/.test(first),false);
  rows=[row()]; await f.context.erSearchHistory(50);
  const next=f.elements['er-history-list'].innerHTML;
  assert.match(next,/data-er-offset="0" >前へ/); assert.match(next,/data-er-offset="100" disabled/);
  assert.equal(vm.runInContext('erHistoryOffset',f.context),50);
  assert.ok(f.requests.every(r=>r.method==='get')); assert.equal(f.writes.length,0);
});

test('history renderer performs initial search once and reports empty/read failure without dispatching writes', async () => {
  const f=fixture(); await f.context.erRenderHistory();
  assert.equal(f.requests.length,1); assert.match(f.requests[0].url,/offset=0/);
  assert.match(f.elements['er-panel'].innerHTML,/data-er-read-action="search-history" data-er-offset="0"/);
  assert.ok(f.elements['er-history-list'].innerHTML.includes('該当なし'));
  const before=f.elements['er-history-list'].innerHTML;
  f.context.axios=async()=>{throw Error('synthetic read failure')};
  await f.context.erSearchHistory(50);
  assert.equal(f.elements['er-history-list'].innerHTML,before);
  assert.equal(f.notices[0][0],'検索に失敗しました'); assert.equal(f.writes.length,0);
});

test('result action keeps encoded GET and cached input/result navigation without grading or saving', async () => {
  const f=fixture(); const special="synthetic'\"<&>";
  f.context.axios=async options=>{f.requests.push(options);return {data:{data:{id:special,round:2,tutor_id:'T1',notion_page_id:'11111111-2222-3333-4444-555555555555',document_id:'synthetic-document'}}}};
  f.context.renderExtensionReviewPage=async()=>f.calls.push(['render-result']);
  await f.click(f.button('open-result',{erResultId:special}),true);
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].method,'get');
  assert.equal(f.requests[0].url,'/api/extension-review/results/'+encodeURIComponent(special));
  assert.equal(vm.runInContext('erTab',f.context),'result'); assert.equal(vm.runInContext('erLastInput.round',f.context),2);
  assert.equal(vm.runInContext('erLastInput.tutorId',f.context),'T1'); assert.deepEqual(f.calls,[['render-result']]); assert.equal(f.writes.length,0);
});

test('delegated history response is discarded when authentication changes during the request', async () => {
  const f=fixture(); let resolve;
  f.context.axios=options=>{f.requests.push(options);return new Promise(done=>{resolve=done})};
  vm.runInContext('erHistoryOffset=100;',f.context);
  const pending=f.click(f.button('search-history',{erOffset:'0'}));
  f.context.sessionToken='new-synthetic-session'; resolve({data:{data:[row()]}}); await pending;
  assert.equal(f.elements['er-history-list'].innerHTML,''); assert.equal(vm.runInContext('erHistoryOffset',f.context),100);
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].method,'get'); assert.equal(f.writes.length,0);
});


test('settings version changes use the current content root and enforce admin/session/feature/disabled guards', async () => {
  const f=fixture();
  f.context.erRenderSettings=async version=>f.calls.push(['settings',version]);
  const change=f.listeners.find(l=>l.type==='change').callback;
  const node={value:'synthetic & version',disabled:false,root:f.elements.content};
  node.closest=selector=>selector==='select[data-er-settings-version]'?node:null;
  await change({target:node});
  assert.deepEqual(f.calls,[['settings','synthetic & version']]);
  node.disabled=true; await change({target:node}); node.disabled=false;
  f.elements.content=f.element(); await change({target:node}); node.root=f.elements.content;
  for (const role of ['crew','leader']) { f.context.currentUser={role}; await change({target:node}); }
  f.context.currentUser={role:'admin'}; f.context.sessionToken=''; await change({target:node});
  f.context.sessionToken='synthetic-session'; vm.runInContext('extensionReviewFeatureEnabled=false',f.context); await change({target:node});
  await change({target:{}});
  assert.equal(f.calls.length,1); assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
});

test('mapping and preview remain local, render text safely and report malformed JSON without saving', async () => {
  const f=fixture();
  for (const id of ['er-criteria','er-script-0','er-script-1','er-script-2','er-script-3','er-template','er-mapping','er-speaker-aliases','er-target','er-limits','er-settings-preview']) f.elements[id]=f.element();
  for (const id of ['er-mapping','er-speaker-aliases','er-target','er-limits']) f.elements[id].value='{}';
  f.elements['er-criteria'].value='<script>synthetic</script>';
  await f.click(f.button('apply-mapping'),true);
  assert.equal(JSON.parse(f.elements['er-mapping'].value).age.transform,'ageFromBirthDate');
  await f.click(f.button('preview-settings'),true);
  assert.equal(JSON.parse(f.elements['er-settings-preview'].textContent).criteria,'<script>synthetic</script>');
  assert.equal(f.elements['er-settings-preview'].innerHTML,'');
  const previous=f.elements['er-settings-preview'].textContent;
  f.elements['er-mapping'].value='{'; await f.click(f.button('preview-settings'));
  assert.equal(f.notices.length,1); assert.equal(f.elements['er-settings-preview'].textContent,previous);
  f.context.currentUser={role:'crew'}; await f.click(f.button('apply-mapping'));
  assert.equal(f.elements['er-mapping'].value,'{');
  assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
});

test('settings renderer keeps encoded read URLs, versions and save control while removing local inline handlers', async () => {
  const f=fixture();
  const config={criteria:'synthetic',scripts:['','','',''],template:'',mapping:{},target:{},limits:{}};
  f.context.axios=async options=>{f.requests.push(options);return {data:{data:options.url.endsWith('/versions')?[{id:1,created_at:'synthetic'}]:{id:1,config}}}};
  const change=f.listeners.find(l=>l.type==='change').callback;
  const node={value:'synthetic & version',root:f.elements.content,closest:()=>node};
  await change({target:node});
  assert.equal(f.requests[0].url,'/api/extension-review/settings?id='+encodeURIComponent(node.value));
  assert.equal(f.requests[1].url,'/api/extension-review/settings/versions');
  assert.ok(f.requests.every(r=>r.method==='get'));
  const html=f.elements['er-panel'].innerHTML;
  assert.match(html,/<select data-er-settings-version/);
  assert.match(html,/data-er-read-action="apply-mapping"/); assert.match(html,/data-er-read-action="preview-settings"/);
  assert.ok(html.includes('onclick="erSaveSettings()"'));
  assert.equal(/on(?:click|change)="er(?:RenderSettings|ApplyNotionMapping|PreviewSettings)/.test(html),false);
  assert.equal(f.writes.length,0);
});


test('settings latest-version reads and changed-session response discard do not save', async () => {
  const f=fixture(); let resolve;
  f.context.axios=options=>{f.requests.push(options);return new Promise(done=>{resolve=done})};
  const node={value:'',root:f.elements.content,closest:()=>node};
  const pending=f.listeners.find(l=>l.type==='change').callback({target:node});
  assert.equal(f.requests[0].url,'/api/extension-review/settings');
  f.context.sessionToken='changed-session'; resolve({data:{data:{id:1,config:{}}}});
  await assert.rejects(pending,/SessionChanged/);
  assert.equal(f.elements['er-panel'].innerHTML,''); assert.equal(f.requests.length,1); assert.equal(f.writes.length,0);
});


test('Tutor analysis entry passes the exact ID and resets to all Tutors using GET only', async () => {
  const f=fixture(); const id="synthetic'\"<&>";
  await f.click(f.button('open-tutor-analysis',{tutor:id}),true);
  assert.equal(vm.runInContext('erAnalysisTutor',f.context),id);
  assert.equal(vm.runInContext('erTab',f.context),'analysis');
  assert.deepEqual(f.calls,[['open-page','extension-review']]);
  const tutor=(tutorId,tutorName)=>({tutorId,tutorName,score:75,scriptMatch:80,count:1,confirmed:0,rounds:{},months:{},penalties:{},improvements:{}});
  f.context.axios=async options=>{f.requests.push(options);return {data:{data:{warning:'Synthetic warning',tutors:[tutor(id,'Synthetic <one>'),tutor('other','Synthetic two')]}}}};
  await f.context.erRenderAnalysis();
  assert.ok(f.elements['er-panel'].innerHTML.includes('Synthetic &lt;one&gt;'));
  assert.equal(f.elements['er-panel'].innerHTML.includes('Synthetic two'),false);
  assert.match(f.elements['er-panel'].innerHTML,/data-er-read-action="reset-analysis"/);
  await f.click(f.button('reset-analysis'),true);
  assert.equal(vm.runInContext('erAnalysisTutor',f.context),null);
  assert.ok(f.elements['er-panel'].innerHTML.includes('Synthetic two'));
  assert.equal(f.elements['er-panel'].innerHTML.includes('data-er-read-action="reset-analysis"'),false);
  assert.equal(f.requests.length,2); assert.ok(f.requests.every(r=>r.method==='get'&&r.url==='/api/extension-review/analysis'));
  assert.equal(f.writes.length,0);
});

test('Tutor analysis entry/reset reject disabled, stale-root, missing ID and unauthorized events', async () => {
  const f=fixture(); let dispatched=0;
  f.context.erOpenTutorAnalysis=()=>dispatched++; f.context.erRenderAnalysis=()=>dispatched++;
  await f.click(f.button('open-tutor-analysis')); await f.click(f.button('open-tutor-analysis',{tutor:''}));
  for (const action of ['open-tutor-analysis','reset-analysis']) {
    const node=f.button(action,{tutor:'synthetic'}); node.disabled=true; await f.click(node);
    await f.click(f.button(action,{tutor:'synthetic'},f.element()));
    for (const role of ['crew','leader']) {f.context.currentUser={role}; await f.click(f.button(action,{tutor:'synthetic'}));}
    f.context.currentUser={role:'admin'}; f.context.sessionToken=''; await f.click(f.button(action,{tutor:'synthetic'}));
    f.context.sessionToken='synthetic-session'; vm.runInContext('extensionReviewFeatureEnabled=false',f.context); await f.click(f.button(action,{tutor:'synthetic'}));
    vm.runInContext('extensionReviewFeatureEnabled=true',f.context);
  }
  assert.equal(dispatched,0); assert.equal(f.requests.length,0); assert.equal(f.writes.length,0);
});
