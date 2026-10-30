import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const marker='<b data-synthetic="tutor">fixture</b>';
const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(){
 const root={contains:node=>node.root===root},quality={innerHTML:''},calls=[];
 const tutor={employee_id:'Synthetic\'" '+marker,tutor_name:marker,notion_name:marker,team:marker,status:'アクティブ',job_type:'Tutor',student_capacity:3,responsible_section:'A'};
 const c={currentUser:{role:'leader'},sessionToken:'synthetic',currentPage:'tutors',selectedTeam:'all',selectedTutorYear:2026,selectedTutorMonth:10,tutors:[tutor],students:[],tutorWeeklySnapshotData:{},tutorMonthlyStats:{byEmployeeId:{},rescheduleByName:{}},escapeHtml,canViewOverallSatisfactionMetrics:()=>false,getTutorSatisfactionData:()=>({}),getSatisfactionDenominator:()=>0,getOverallSatisfactionDenominator:()=>0,getTutorLessonProgressStatus:()=>({color:'',normal:0,slow:0,slowRate:0,verySlow:0,verySlowRate:0}),document:{getElementById:id=>id==='content'?root:quality,addEventListener(){}},minutesQualityMetricDefinitions:[{key:'synthetic',label:'固定指標'}],getMinutesQualityStatusDisplay:()=>({badge:'badge',icon:'fa-check',label:'達成'}),updateTutorCapacity:(...args)=>calls.push(['capacity',...args]),updateTutorSection:(...args)=>calls.push(['section',...args])};
 vm.createContext(c);for(const name of ['studentDisplayText','studentDisplayAttribute','renderTutorRows','handleTutorSettingChange','renderTutorMinutesQualityModal'])vm.runInContext(extract(name),c);
 const control=(setting,value)=>({root,disabled:false,value,dataset:{tutorSetting:setting,tutorSettingId:tutor.employee_id},closest(){return this}});
 return{c,tutor,root,quality,calls,control};
}
test('real Tutor rows render cached text/IDs literally and keep fixed setting values',()=>{
 const f=fixture(),html=f.c.renderTutorRows();assert.equal(html.includes(marker),false);assert.ok(html.includes('&lt;b data-synthetic="tutor"&gt;fixture&lt;/b&gt;'));assert.ok(html.includes('data-tutor-setting-id="Synthetic\'&quot; &lt;b data-synthetic=&quot;tutor&quot;&gt;fixture&lt;/b&gt;"'));assert.ok(html.includes('data-tutor-notion-name="&lt;b data-synthetic=&quot;tutor&quot;&gt;fixture&lt;/b&gt;"'));assert.ok(html.includes('value="3"'));assert.ok(html.includes('value="A" selected'));assert.equal(/onchange="updateTutor(?:Section|Capacity)/.test(html),false);
 f.c.selectedTeam='other';assert.ok(f.c.renderTutorRows().includes('アクティブなTutorが見つかりません'));
});
test('fixed capacity/section entry passes exact cached ID and original values without changing roles',()=>{
 for(const role of ['crew','leader','admin']){const f=fixture();f.c.currentUser.role=role;f.c.handleTutorSettingChange({target:f.control('capacity','5')});f.c.handleTutorSettingChange({target:f.control('section','B')});assert.deepEqual(f.calls,[['capacity',f.tutor.employee_id,'5'],['section',f.tutor.employee_id,'B']]);}
 for(const mutate of [f=>f.c.sessionToken='',f=>f.c.currentPage='students',f=>f.c.currentUser=null,f=>f.c.selectedTeam='other',f=>f.c.tutors=[]]){const f=fixture();mutate(f);f.c.handleTutorSettingChange({target:f.control('capacity','5')});assert.equal(f.calls.length,0)}
 const f=fixture();for(const [setting,value] of [['section','other'],['unknown','5']])f.c.handleTutorSettingChange({target:f.control(setting,value)});const stale=f.control('capacity','5');stale.root={};f.c.handleTutorSettingChange({target:stale});assert.equal(f.calls.length,0);
});
test('real quality detail protects stored evidence quotes as an attribute while labels and normal links remain',()=>{
 const f=fixture(),data={totalMinutes:1,evaluatedMinutes:1,metrics:[{targetAchieved:true,rate:90,monthlyLabel:'固定指標',asanaUrl:'https://app.asana.com/synthetic',targetRate:80,metCount:1,applicableCount:1}],lessons:[{lesson_date:'2026-10-01',student_name:marker,quality_evaluation:{metrics:{synthetic:{status:'met',evidence:'" '+marker}}}}]};
 f.c.renderTutorMinutesQualityModal(data);const html=f.quality.innerHTML;assert.equal(html.includes(marker),false);assert.ok(html.includes('title="&quot; &lt;b data-synthetic=&quot;tutor&quot;&gt;fixture&lt;/b&gt;"'));assert.ok(html.includes('90.00%'));assert.ok(html.includes('href="https://app.asana.com/synthetic"'));assert.ok(html.includes('固定指標'));
});

const decodeAttribute=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
test('real row attributes round-trip through fixed change to real capacity and section saves',async()=>{
 const f=fixture(),sends=[],renders=[];
 Object.assign(f.c,{API_BASE:'',console:{log(){},error(){}},alert:message=>{throw Error(message)},renderTutorsPage:()=>renders.push('render'),axios:{put:async(url,body)=>{sends.push({url,body});return{data:{success:true}}}}});
 vm.runInContext(extract('updateTutorCapacity')+'\n'+extract('updateTutorSection'),f.c);
 const html=f.c.renderTutorRows();
 for(const [setting,value] of [['section','B'],['capacity','5']]){
  const match=html.match(new RegExp('data-tutor-setting="'+setting+'" data-tutor-setting-id="([^\"]*)"'));assert.ok(match);
  const control=f.control(setting,value);control.dataset.tutorSettingId=decodeAttribute(match[1]);assert.equal(control.dataset.tutorSettingId,f.tutor.employee_id);
  await f.c.handleTutorSettingChange({target:control});
 }
 assert.equal(sends.length,2);assert.equal(sends[0].url,'/api/tutors/'+encodeURIComponent(f.tutor.employee_id)+'/section');assert.equal(sends[0].body.responsible_section,'B');
 assert.equal(sends[1].url,'/api/tutors/'+encodeURIComponent(f.tutor.employee_id)+'/capacity');assert.equal(sends[1].body.student_capacity,5);assert.equal(f.tutor.responsible_section,'B');assert.equal(f.tutor.student_capacity,5);assert.deepEqual(renders,['render']);
});
