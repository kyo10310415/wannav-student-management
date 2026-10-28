import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/extension-review.js',import.meta.url),'utf8');
function fixture(){
 const requests=[],notices=[],listeners=[],prompts=[];
 const element=()=>({innerHTML:'',textContent:'',value:'',disabled:false,isConnected:true,contains(node){return node.root===this}});
 const ids=['content','extension-review-nav','er-panel','er-start','er-round','er-tutor','er-notion','er-doc','er-edit-json','er-diagnosis','er-criteria','er-template','er-mapping','er-speaker-aliases','er-target','er-limits',...Array.from({length:4},(_,i)=>'er-script-'+i)];
 const elements=Object.fromEntries(ids.map(id=>[id,element()]));
 const context={currentUser:null,sessionToken:null,API_BASE:'',document:{getElementById:id=>elements[id],addEventListener:(type,callback)=>listeners.push({type,callback})},console:{log(){},error(){}},setTimeout(){},showNotification:(...args)=>notices.push(args),confirm:message=>{prompts.push(message);return true},axios:async options=>{requests.push(options);return {data:{data:{id:'synthetic-result',result:{score:70}}}}}};
 vm.createContext(context);vm.runInContext(source,context);
 context.currentUser={role:'admin'};context.sessionToken='synthetic-session';vm.runInContext('extensionReviewFeatureEnabled=true',context);
 const node=(action,root=elements.content)=>{const n={dataset:{erAction:action},root,disabled:false};n.closest=selector=>selector==='button[data-er-action]'?n:null;return n};
 const click=(n,nested=false)=>context.erHandleActionClick({target:nested?{closest:()=>n}:n});
 const run=code=>vm.runInContext(code,context);
 return {context,elements,requests,notices,listeners,prompts,node,click,run,element};
}
const actions=['generate','regrade','diagnose','copy','download','review','confirm','edit','save-edit','save-settings'];
test('fixed action dispatcher passes exact booleans and handles nested buttons once',async()=>{
 const f=fixture(),calls=[];
 for(const name of ['erGenerate','erDiagnose','erCopy','erDownload','erReview','erEdit','erSaveEdit','erSaveSettings'])f.context[name]=(...args)=>calls.push([name,...args]);
 assert.equal(f.listeners.filter(l=>l.callback===f.context.erHandleActionClick).length,1);
 for(const action of actions)await f.click(f.node(action),true);
 assert.deepEqual(calls,[['erGenerate'],['erGenerate',true],['erDiagnose'],['erCopy'],['erDownload'],['erReview',false],['erReview',true],['erEdit'],['erSaveEdit'],['erSaveSettings']]);
 assert.equal(f.requests.length,0);assert.equal(/\bon(?:click|change)=/.test(source),false);
});
test('all actions reject unauthorized, disabled, obsolete roots and arbitrary function names',async()=>{
 const f=fixture();let count=0;
 for(const name of ['erGenerate','erDiagnose','erCopy','erDownload','erReview','erEdit','erSaveEdit','erSaveSettings'])f.context[name]=()=>count++;
 for(const action of actions){
  const old=f.node(action);f.elements.content=f.element();await f.click(old);
  const disabled=f.node(action);disabled.disabled=true;await f.click(disabled);
  await f.click(f.node(action,f.elements['extension-review-nav']));
  for(const user of [null,{role:'crew'},{role:'leader'}]){f.context.currentUser=user;await f.click(f.node(action));}
  f.context.currentUser={role:'admin'};f.context.sessionToken='';await f.click(f.node(action));
  f.context.sessionToken='synthetic-session';f.run('extensionReviewFeatureEnabled=false');await f.click(f.node(action));f.run('extensionReviewFeatureEnabled=true');
 }
 for(const action of ['__proto__','constructor','erGenerate','generate(true)','unknown'])await f.click(f.node(action));
 await f.context.erHandleActionClick({target:{}});
 assert.equal(count,0);assert.equal(f.requests.length,0);
});
test('regrade and confirmation cancellation send nothing; accepted review/confirm preserve endpoints',async()=>{
 const f=fixture();f.run("erResult={id:'synthetic-result'};erLastInput={round:2,tutorId:'T1',notionUrl:'synthetic-notion',documentUrl:'synthetic-document'}");
 f.context.confirm=message=>{f.prompts.push(message);return false};
 await f.click(f.node('regrade'));await f.click(f.node('confirm'));
 assert.equal(f.prompts.length,2);assert.equal(f.requests.length,0);
 f.context.confirm=()=>true;f.context.erRenderResult=()=>{};
 await f.click(f.node('review'));await f.click(f.node('confirm'));
 assert.deepEqual(f.requests.map(r=>[r.method,r.url]),[['post','/api/extension-review/results/synthetic-result/review'],['post','/api/extension-review/results/synthetic-result/confirm']]);
});
test('grading preserves payload, busy guard, button recovery and changed-session response discard',async()=>{
 const f=fixture();f.elements['er-round'].value='2';f.elements['er-tutor'].value='T1';f.elements['er-notion'].value=' synthetic-notion ';f.elements['er-doc'].value=' synthetic-document ';
 let resolve;f.context.axios=options=>{f.requests.push(options);return new Promise(done=>resolve=done)};
 let renders=0;f.context.renderExtensionReviewPage=()=>renders++;
 const pending=f.click(f.node('generate'));await f.click(f.node('generate'));await f.click(f.node('regrade'));
 assert.equal(f.requests.length,1);assert.equal(f.elements['er-start'].disabled,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].data)),{round:2,tutorId:'T1',notionUrl:'synthetic-notion',documentUrl:'synthetic-document',force:false,regradeConfirmed:false});
 resolve({data:{data:{id:'synthetic-result'}}});await pending;
 assert.equal(renders,1);assert.equal(f.elements['er-start'].disabled,false);assert.equal(f.run('erBusy'),false);
 const stale=f.click(f.node('regrade'));assert.equal(f.requests[1].data.force,true);assert.equal(f.requests[1].data.regradeConfirmed,true);
 f.context.sessionToken='changed-session';resolve({data:{data:{id:'stale-result'}}});await stale;
 assert.equal(f.run('erResult.id'),'synthetic-result');assert.equal(renders,1);
});
test('edit/save use existing GET/PUT and invalid JSON never writes',async()=>{
 const f=fixture();f.run("erResult={id:'synthetic-result',result:{score:70}}");
 f.context.axios=async options=>{f.requests.push(options);return {data:{data:options.method==='get'?[]:{id:'synthetic-result'}}}};
 await f.click(f.node('edit'));assert.equal(f.requests[0].url,'/api/extension-review/results/synthetic-result/edits');
 assert.match(f.elements['er-panel'].innerHTML,/data-er-action="save-edit"/);
 f.elements['er-edit-json'].value='{';await f.click(f.node('save-edit'));assert.equal(f.requests.length,1);assert.equal(f.notices.length,1);
 f.context.erRenderResult=()=>{};f.elements['er-edit-json'].value='{"score":75}';await f.click(f.node('save-edit'));
 assert.equal(f.requests[1].method,'put');assert.equal(f.requests[1].url,'/api/extension-review/results/synthetic-result');assert.equal(f.requests[1].data.score,75);
});
test('settings save and diagnostics preserve payloads while diagnostics renders text',async()=>{
 const f=fixture();for(const id of ['er-mapping','er-speaker-aliases','er-target','er-limits'])f.elements[id].value='{}';
 f.elements['er-criteria'].value='synthetic';let refresh=0;f.context.erRenderSettings=()=>refresh++;
 await f.click(f.node('save-settings'));assert.equal(f.requests[0].url,'/api/extension-review/settings');assert.equal(f.requests[0].method,'post');assert.equal(f.requests[0].data.criteria,'synthetic');assert.equal(refresh,1);
 f.elements['er-notion'].value=' synthetic-notion ';f.elements['er-doc'].value=' synthetic-document ';
 await f.click(f.node('diagnose'));assert.equal(f.requests[1].url,'/api/extension-review/diagnostics');assert.equal(f.requests[1].method,'post');assert.equal(f.requests[1].data.notionUrl,'synthetic-notion');assert.ok(f.elements['er-diagnosis'].textContent.includes('synthetic-result'));assert.equal(f.elements['er-diagnosis'].innerHTML,'');
});

test('copy and download retain Markdown text and release the temporary URL',async()=>{
 const f=fixture(),copies=[],blobs=[],revoked=[],timers=[],downloads=[];
 f.run("erResult={id:'synthetic-result',markdown:'Synthetic markdown'}");
 f.context.navigator={clipboard:{writeText:async text=>copies.push(text)}};
 f.context.Blob=class{constructor(parts,options){blobs.push({parts,options})}};
 f.context.URL={createObjectURL:()=> 'blob:synthetic',revokeObjectURL:url=>revoked.push(url)};
 f.context.setTimeout=(fn,delay)=>timers.push({fn,delay});
 f.context.document.createElement=tag=>{assert.equal(tag,'a');const a={click(){downloads.push({href:a.href,download:a.download})}};return a};
 await f.click(f.node('copy'));await f.click(f.node('download'));
 assert.deepEqual(copies,['Synthetic markdown']);assert.equal(blobs[0].parts[0],'Synthetic markdown');assert.equal(blobs[0].options.type,'text/markdown;charset=utf-8');
 assert.deepEqual(downloads,[{href:'blob:synthetic',download:'extension-review-synthetic-result.md'}]);assert.equal(timers[0].delay,1000);timers[0].fn();assert.deepEqual(revoked,['blob:synthetic']);assert.equal(f.requests.length,0);
});
