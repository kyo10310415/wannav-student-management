import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const marker='<b data-synthetic="history">fixture</b>';
const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(){
 const elements={content:{contains:node=>node.root===elements.content}},calls=[],logs=[],pending=[];
 const student={student_id:'Synthetic/ID',name:marker};
 const document={getElementById:id=>elements[id],addEventListener(){},body:{appendChild(node){node.connected=true},contains:node=>!!node?.connected},createElement(){
  const node={contains:child=>child?.parent===node,remove(){node.connected=false;if(elements[node.id]===node){delete elements[node.id];delete elements['previous-lesson-targets-content']}}};
  Object.defineProperty(node,'id',{get:()=>node.key,set:id=>{node.key=id;elements[id]=node}});
  Object.defineProperty(node,'innerHTML',{get:()=>node.html,set:value=>{node.html=value;elements['previous-lesson-targets-content']={parent:node,innerHTML:'loading'}}});return node;
 }};
 const c={API_BASE:'',currentUser:{id:7,role:'admin'},sessionToken:'synthetic',currentPage:'today',currentLessonDate:new Date(2026,9,29),selectedTutor:'all',students:[student],document,escapeHtml,console:{error:(...args)=>logs.push(args)},axios:{get:(...args)=>{calls.push(args);const d=deferred();pending.push(d);return d.promise}}};
 vm.createContext(c);vm.runInContext(extract('showPreviousLessonTargets')+'\n'+extract('closePreviousLessonTargetsModal'),c);
 return{c,elements,calls,logs,pending,student};
}
const success={data:{data:{hasPreviousMinutes:true,previousLessonDate:'2026-10-01',anxietyContent:marker,smallGoal:marker}}};
test('current previous-target read preserves encoded ID/date/token and literal saved text',async()=>{
 const f=fixture();vm.runInContext(await readFile(new URL('../public/previous-targets-events.js',import.meta.url),'utf8'),f.c);
 const button={root:f.elements.content,dataset:{previousTargetsAction:'open',studentId:f.student.student_id,lessonDate:'2026-10-29'},closest(){return this}};
 const p=f.c.handlePreviousTargetsClick({target:button});
 assert.equal(f.calls.length,1);assert.ok(f.calls[0][0].endsWith('/Synthetic%2FID'));assert.equal(f.calls[0][1].params.beforeDate,'2026-10-29');assert.equal(f.calls[0][1].headers.Authorization,'Bearer synthetic');
 f.pending[0].resolve(success);await p;const html=f.elements['previous-lesson-targets-content'].innerHTML;assert.equal(html.includes(marker),false);assert.ok(html.includes('&lt;b data-synthetic="history"&gt;fixture&lt;/b&gt;'));
});
test('old previous-target completion cannot overwrite a newer same-ID modal',async()=>{
 for(const rejected of [false,true]){const f=fixture(),first=f.c.showPreviousLessonTargets(f.student.student_id,'2026-10-29'),second=f.c.showPreviousLessonTargets(f.student.student_id,'2026-10-29');const target=f.elements['previous-lesson-targets-content'];
 if(rejected)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve(success);await first;assert.equal(target.innerHTML,'loading');assert.equal(f.logs.length,0);
 f.pending[1].resolve({data:{data:{hasPreviousMinutes:false}}});await second;assert.ok(target.innerHTML.includes('議事録はありません'))}
});
test('previous-target auth/page/date/root/cache/filter changes suppress stale success and errors',async()=>{
 const changes=[f=>f.c.sessionToken='other',f=>f.c.currentUser.id=8,f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.currentLessonDate=new Date(2026,9,30),f=>f.elements.content={},f=>f.c.students=[],f=>f.student.name='changed',f=>f.student.student_id='other',f=>f.c.selectedTutor='other',f=>f.c.closePreviousLessonTargetsModal()];
 for(const change of changes)for(const rejected of [false,true]){const f=fixture(),p=f.c.showPreviousLessonTargets(f.student.student_id,'2026-10-29'),target=f.elements['previous-lesson-targets-content'];change(f);if(rejected)f.pending[0].reject(Error('PRIVATE_SENTINEL'));else f.pending[0].resolve(success);await p;assert.equal(target.innerHTML,'loading');assert.equal(f.logs.length,0)}
 const f=fixture(),p=f.c.showPreviousLessonTargets(f.student.student_id,'2026-10-29');f.pending[0].reject(Object.assign(Error('PRIVATE_SENTINEL'),{response:{data:{error:'PRIVATE_SENTINEL'}}}));await p;assert.ok(f.elements['previous-lesson-targets-content'].innerHTML.includes('前回情報の取得に失敗しました'));assert.equal(JSON.stringify(f.logs).includes('PRIVATE_SENTINEL'),false);assert.equal(f.elements['previous-lesson-targets-content'].innerHTML.includes('PRIVATE_SENTINEL'),false);
});
test('unknown student, wrong date and unauthenticated preparation do not issue reads',async()=>{
 for(const change of [f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentPage='students',f=>f.c.students=[]]){const f=fixture();change(f);await f.c.showPreviousLessonTargets('Synthetic/ID','2026-10-29');assert.equal(f.calls.length,0)}
 const f=fixture();await f.c.showPreviousLessonTargets('Synthetic/ID','2026-10-28');assert.equal(f.calls.length,0);
});
test('shared Tutor option values and names remain literal while original name sorting/selection are retained',()=>{
 const notion='" '+marker,c={students:[{homeroom_tutor:notion},{homeroom_tutor:'ordinary'},{homeroom_tutor:'unassignable'}],tutors:[{notion_name:notion,tutor_name:marker,is_assignable:true},{notion_name:'ordinary',tutor_name:'あいう',is_assignable:true}],selectedTutor:notion,escapeHtml};
 vm.createContext(c);for(const name of ['studentDisplayText','studentDisplayAttribute','getTutorDisplayName','getTutorOptions'])vm.runInContext(extract(name),c);
 const html=c.getTutorOptions();assert.equal(html.includes(marker),false);assert.ok(html.includes('value="&quot; &lt;b data-synthetic=&quot;history&quot;&gt;fixture&lt;/b&gt;" selected'));assert.equal(html.includes('unassignable'),false);assert.equal((html.match(/<option /g)||[]).length,2);assert.equal((html.match(/ selected/g)||[]).length,1);
});
