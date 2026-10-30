import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
import{aggregateMinutesQualityEvaluations,normalizeMinutesQualityEvaluation,getMinutesQualityMetricDefinitions}from'../src/services/minutesQualityService.js';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const extract=name=>{const a=source.indexOf(`function ${name}(`);assert.ok(a>=0,name);return(source.slice(a-6,a)==='async '?'async ':'')+source.slice(a,source.indexOf('\n}',a)+2)};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(){const calls=[],alerts=[],logs=[],notifications=[],timers=[],button={disabled:false,innerHTML:'original'},root={contains:node=>node===button},elements={content:root};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'leader'},currentPage:'tutors',selectedTutorYear:2026,selectedTutorMonth:10,selectedTeam:'all',API_BASE:'',escapeHtml,document:{getElementById:id=>elements[id]??null,createElement:()=>({innerHTML:'',remove(){this.removed=true}}),body:{appendChild:node=>notifications.push(node)}},alert:m=>alerts.push(m),console:{error:m=>logs.push(m)},setTimeout:fn=>timers.push(fn),axios:{post:(...args)=>{const d=defer();calls.push({args,...d});return d.promise;}}};
 vm.createContext(c);vm.runInContext('const tutorQualityExportPending=new Set();\n'+['studentDisplayText','studentDisplayAttribute','studentDisplayLink','exportTutorQualityToSheet'].map(extract).join('\n'),c);return{c,calls,alerts,logs,notifications,timers,button,root,elements};}
const success={data:{success:true,tutorCount:2,spreadsheetUrl:'https://example.test/synthetic'}};
test('quality export preserves selected-month fake POST and captured button restoration',async()=>{
 const f=fixture(),p=f.c.exportTutorQualityToSheet(f.button);assert.equal(f.button.disabled,true);await f.c.exportTutorQualityToSheet(f.button);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[0],'/api/tutors/quality/export');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args[1])),{year:2026,month:10});assert.equal(f.calls[0].args[2].headers.Authorization,'Bearer fixture-token');assert.equal(f.calls[0].args[2].timeout,120000);f.calls[0].resolve(success);await p;assert.equal(f.notifications.length,1);assert.match(f.notifications[0].innerHTML,/2026年10月/);assert.match(f.notifications[0].innerHTML,/Tutor 2名分/);assert.equal(f.button.disabled,false);assert.equal(f.button.innerHTML,'original');f.timers[0]();assert.equal(f.notifications[0].removed,true);
});
test('quality export stale success/error after auth page root month team or button change never notifies',async()=>{
 const changes=[f=>f.c.sessionToken='new',f=>f.c.currentUser.id=2,f=>f.c.currentUser.role='admin',f=>f.c.currentPage='today',f=>f.elements.content={},f=>f.c.selectedTutorMonth=11,f=>f.c.selectedTutorYear=2027,f=>f.c.selectedTeam='new',f=>f.root.contains=()=>false];
 for(const change of changes)for(const fail of [false,true]){const f=fixture(),p=f.c.exportTutorQualityToSheet(f.button);change(f);if(fail)f.calls[0].reject(Error('private synthetic'));else f.calls[0].resolve(success);await p;assert.equal(f.notifications.length,0);assert.equal(f.alerts.length,0);assert.equal(f.logs.length,0);}
});
test('quality export permits only existing manager context and does not touch replacement button',async()=>{
 for(const change of [f=>f.c.sessionToken=null,f=>f.c.currentUser.role='crew',f=>f.c.currentUser.role='unknown',f=>f.c.currentPage='today',f=>f.button.disabled=true,f=>f.root.contains=()=>false]){const f=fixture();change(f);await f.c.exportTutorQualityToSheet(f.button);assert.equal(f.calls.length,0);}
 const f=fixture(),p=f.c.exportTutorQualityToSheet(f.button),replacement={disabled:true,innerHTML:'new'};f.root.contains=node=>node===replacement;f.calls[0].resolve(success);await p;assert.equal(replacement.disabled,true);assert.equal(replacement.innerHTML,'new');
});
test('quality export current rejection uses fixed failure and releases lock for retry',async()=>{
 const f=fixture();let p=f.c.exportTutorQualityToSheet(f.button);f.calls[0].reject(Error('private synthetic'));await p;assert.deepEqual(f.logs,['[Tutor Quality Export] Failed']);assert.equal(f.alerts.length,1);assert.equal(f.alerts[0].includes('private'),false);assert.equal(f.button.disabled,false);p=f.c.exportTutorQualityToSheet(f.button);f.calls[1].resolve(success);await p;assert.equal(f.notifications.length,1);
});
test('quality export notification uses escaped text and safe HTTP link',async()=>{
 const f=fixture(),p=f.c.exportTutorQualityToSheet(f.button);f.calls[0].resolve({data:{success:true,tutorCount:'<b>fixture</b>',spreadsheetUrl:'javascript:synthetic'}});await p;assert.equal(f.notifications[0].innerHTML.includes('<b>'),false);assert.equal(f.notifications[0].innerHTML.includes('javascript:'),false);assert.match(f.notifications[0].innerHTML,/&lt;b&gt;/);
});
test('quality aggregation derives numeric metrics and fixed URL definitions instead of trusting saved fields',()=>{
 const definitions=getMinutesQualityMetricDefinitions(),raw={version:2,metrics:Object.fromEntries(definitions.map(d=>[d.key,{status:'met',asanaUrl:'javascript:synthetic',rate:'synthetic',targetRate:'synthetic',evidence:'synthetic'}]))};
 const aggregate=aggregateMinutesQualityEvaluations([{quality_evaluation:raw,totalMinutes:'synthetic'}]);assert.equal(aggregate.totalMinutes,1);assert.equal(aggregate.evaluatedMinutes,1);aggregate.metrics.forEach((metric,i)=>{assert.equal(metric.rate,100);assert.equal(metric.asanaUrl,definitions[i].asanaUrl);assert.equal(typeof metric.targetRate,'number');});
});
test('actual quality aggregate connects to real renderer with escaped saved evidence and read-only contract',()=>{
 const definitions=getMinutesQualityMetricDefinitions(),evidence='synthetic" data-synthetic="quoted<&',raw={version:2,metrics:Object.fromEntries(definitions.map(d=>[d.key,{status:'met',evidence}]))};
 const record={quality_evaluation:raw},data={...aggregateMinutesQualityEvaluations([record]),lessons:[{student_name:'Synthetic',lesson_date:'2026-10-30',quality_evaluation:normalizeMinutesQualityEvaluation(raw)}]},container={innerHTML:''};
 const c={escapeHtml,minutesQualityMetricDefinitions:definitions,document:{getElementById:()=>container}};vm.createContext(c);vm.runInContext(['studentDisplayText','studentDisplayAttribute','getMinutesQualityStatusDisplay','renderTutorMinutesQualityModal'].map(extract).join('\n'),c);c.renderTutorMinutesQualityModal(data);assert.equal(container.innerHTML.includes('title="'+evidence+'"'),false);assert.match(container.innerHTML,/synthetic&quot; data-synthetic=&quot;quoted&lt;&amp;/);assert.equal(container.innerHTML.includes('javascript:synthetic'),false);assert.equal(/<(?:input|button)\b/.test(container.innerHTML),false);assert.match(container.innerHTML,/100\.00%/);
});
