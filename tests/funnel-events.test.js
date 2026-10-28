import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/funnel-events.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners=[];
 const root=()=>({contains(node){return node.root===this}});
 const elements={content:root(),'funnel-student-details-modal':root()};
 const context={currentUser:{role:'admin'},sessionToken:'synthetic-session',currentPage:'funnel',document:{getElementById:id=>elements[id]||null,addEventListener:(type,callback)=>listeners.push({type,callback})},renderFunnelPage:async()=>calls.push(['reload']),showFunnelStudentDetails:(...args)=>calls.push(['details',...args]),closeFunnelStudentDetails:()=>calls.push(['close-details']),changeFunnelMonth:async delta=>calls.push(['month',delta]),setFunnelMonth:async value=>calls.push(['set-month',value])};
 vm.createContext(context);vm.runInContext(source,context);
 const button=(action,attrs={},at=elements.content)=>{const node={root:at,disabled:false,dataset:{funnelAction:action,...attrs}};node.closest=selector=>selector==='button[data-funnel-action]'?node:null;return node};
 const input=(value,at=elements.content)=>{const node={root:at,disabled:false,value};node.closest=selector=>selector==='input[data-funnel-month]'?node:null;return node};
 const click=(node,nested=false)=>context.handleFunnelReadClick({target:nested?{closest:()=>node}:node});
 return {context,calls,listeners,elements,root,button,input,click};
}
test('funnel migrates only six read attributes and retains escaped detail data and Discord update handler',()=>{
 for(const old of ['onclick="renderFunnelPage()"','onclick="showFunnelStudentDetails(','onclick="closeFunnelStudentDetails()"','onclick="changeFunnelMonth(','onchange="setFunnelMonth('])assert.equal(appSource.includes(old),false);
 assert.ok(appSource.includes('onclick="refreshFunnelDiscordInsights()"'));
 assert.ok(appSource.includes('data-detail-key="${escapeHtml(options.detailKey)}" data-detail-label="${escapeHtml(label)}" data-funnel-action="details"'));
 assert.equal((appSource.match(/data-funnel-action=/g)||[]).length,5);assert.equal((appSource.match(/data-funnel-month/g)||[]).length,1);
});
test('fixed read actions handle nested targets and use only their current root, including modal close',async()=>{
 const f=fixture();assert.deepEqual(f.listeners.map(l=>l.type),['click','change']);
 await f.click(f.button('reload'),true);
 await f.click(f.button('details',{detailKey:'synthetic-key',detailLabel:'Synthetic <label>'}),true);
 await f.click(f.button('previous-month'));await f.click(f.button('next-month'));
 await f.click(f.button('close-details',{},f.elements['funnel-student-details-modal']));
 await f.click(f.button('reload',{},f.elements['funnel-student-details-modal']));
 await f.click(f.button('close-details'));await f.click(f.button('details'));
 for(const action of ['refresh','refreshFunnelDiscordInsights','__proto__','constructor','unknown'])await f.click(f.button(action));
 assert.deepEqual(f.calls,[['reload'],['details','synthetic-key','Synthetic <label>'],['month',-1],['month',1],['close-details']]);
 const old=f.button('reload');f.elements.content=f.root();await f.click(old);await f.click(f.button('reload'));
 assert.equal(f.calls.length,6);
});
test('funnel events reject unauthorized roles, missing session, wrong page, disabled and outside controls',async()=>{
 const f=fixture();const click=f.button('reload'),input=f.input('2026-10');
 for(const user of [null,{role:'crew'},{role:'unknown'}]){f.context.currentUser=user;await f.click(click);await f.context.handleFunnelMonthChange({target:input});}
 f.context.currentUser={role:'admin'};f.context.sessionToken='';await f.click(click);await f.context.handleFunnelMonthChange({target:input});
 f.context.sessionToken='synthetic-session';f.context.currentPage='today';await f.click(click);await f.context.handleFunnelMonthChange({target:input});
 f.context.currentPage='funnel';click.disabled=true;input.disabled=true;await f.click(click);await f.context.handleFunnelMonthChange({target:input});
 await f.click(f.button('reload',{},f.root()));await f.context.handleFunnelMonthChange({target:f.input('2026-10',f.root())});
 await f.context.handleFunnelReadClick({target:{}});await f.context.handleFunnelMonthChange({target:{}});
 assert.equal(f.calls.length,0);
 f.context.currentUser={role:'leader'};await f.click(f.button('reload'));assert.deepEqual(f.calls,[['reload']]);
});
test('month input accepts valid month values only and current-root changes survive content recreation',async()=>{
 const f=fixture();
 for(const value of ['', '2026-00','2026-13','2026-1',' 2026-10','2026-10;generate()'])await f.context.handleFunnelMonthChange({target:f.input(value)});
 const stale=f.input('2026-10');f.elements.content=f.root();await f.context.handleFunnelMonthChange({target:stale});
 await f.context.handleFunnelMonthChange({target:f.input('2026-01')});await f.context.handleFunnelMonthChange({target:f.input('2026-12')});
 assert.deepEqual(f.calls,[['set-month','2026-01'],['set-month','2026-12']]);
});
test('real month functions preserve year rollover, clear cached data and request render once',async()=>{
 const f=fixture();f.context.funnelSelectedYear=2026;f.context.funnelSelectedMonth=1;f.context.funnelData={synthetic:true};
 const start=appSource.indexOf('async function changeFunnelMonth('),end=appSource.indexOf('async function refreshFunnelDiscordInsights(',start);
 vm.runInContext(appSource.slice(start,end),f.context);
 await f.click(f.button('previous-month'));assert.equal(f.context.funnelSelectedYear,2025);assert.equal(f.context.funnelSelectedMonth,12);assert.equal(f.context.funnelData,null);
 await f.click(f.button('next-month'));assert.equal(f.context.funnelSelectedYear,2026);assert.equal(f.context.funnelSelectedMonth,1);
 await f.context.handleFunnelMonthChange({target:f.input('2027-07')});assert.equal(f.context.funnelSelectedYear,2027);assert.equal(f.context.funnelSelectedMonth,7);
 assert.deepEqual(f.calls,[['reload'],['reload'],['reload']]);
});
