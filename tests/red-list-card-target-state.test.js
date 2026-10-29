import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const extract=name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2)};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const escapeHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture(ids=['fixture']){
 const calls=[],logs=[],students=ids.map(student_id=>({student_id,status:'アクティブ',contract_plan:'通常'}));
 const cells=ids.map(id=>({dataset:{studentId:id},innerHTML:'loading',connected:true}));
 const root={contains:cell=>cells.includes(cell)&&cell.connected,querySelectorAll:selector=>{assert.equal(selector,'.red-list-loading');return cells}};
 const elements={content:root};
 const c={sessionToken:'fixture-token',currentUser:{id:1,role:'crew'},currentPage:'students',document:{getElementById:id=>elements[id]},getFilteredStudents:()=>students,API_BASE:'',console:{error:m=>logs.push(m)},escapeHtml};
 function send(method,url){const d=defer();calls.push({method,url,...d});return d.promise}
 c.axios={get:url=>send('GET',url),post:url=>send('POST',url)};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const redListReadStates ='),source.indexOf('// Red List Page'))+'\nasync '+extract('loadRedListData')+'\n'+extract('updateRedListDisplay'),c);
 return{c,calls,logs,students,cells,root,elements};
}
const row=id=>({student_id:id,rank:'high',total_score:5,satisfaction_score:2,absence_score:1,survey_score:1,reschedule_score:0,reservation_score:1});
const success=data=>({data:{success:true,data}});
test('partial retained cells cannot make an old batch update replacement targets',async()=>{
 for(const fail of [false,true]){const f=fixture(['one','two']),p=f.c.loadRedListData(),old=f.cells[0];old.connected=false;f.cells.unshift({dataset:{studentId:'one'},innerHTML:'new',connected:true});if(fail)f.calls[0].reject(Error('private fixture'));else f.calls[0].resolve(success([row('one'),row('two')]));await p;assert.equal(old.innerHTML,'loading');assert.equal(f.cells[0].innerHTML,'new');assert.equal(f.cells[2].innerHTML,'loading');assert.equal(f.logs.length,0);}
});
test('captured targets are updated exactly even when another matching cell appears',async()=>{
 const f=fixture(['quote"fixture']),p=f.c.loadRedListData(),captured=f.cells[0];f.cells.unshift({dataset:{studentId:'quote"fixture'},innerHTML:'new unrelated',connected:true});f.calls[0].resolve(success([row('quote"fixture'),row('foreign')]));await p;assert.match(captured.innerHTML,/5点/);assert.equal(f.cells[0].innerHTML,'new unrelated');assert.equal(f.logs.length,0);
});
test('cache change or target ID change stops rendering and manager auto-calculation',async()=>{
 for(const change of [f=>f.c.getFilteredStudents=()=>[],f=>f.c.getFilteredStudents=()=>[{student_id:'fixture'}],f=>f.students[0].student_id='other',f=>f.cells[0].dataset.studentId='other']){
 const f=fixture();f.c.currentUser.role='admin';const p=f.c.loadRedListData();change(f);f.calls[0].resolve(success([]));await p;assert.equal(f.calls.length,1);assert.equal(f.cells[0].innerHTML,'loading');}
});
test('manager auto-calculation rechecks target cache before retry and preserves normal path',async()=>{
 for(const stale of [false,true]){const f=fixture();f.c.currentUser.role='leader';const p=f.c.loadRedListData();f.calls[0].resolve(success([]));await new Promise(r=>setImmediate(r));assert.equal(f.calls[1].method,'POST');if(stale)f.students[0].student_id='other';f.calls[1].resolve(success({}));await new Promise(r=>setImmediate(r));if(stale){assert.equal(f.calls.length,2)}else{assert.equal(f.calls.length,3);f.calls[2].resolve(success([row('fixture')]));}await p;if(!stale)assert.match(f.cells[0].innerHTML,/5点/);}
});
test('normal crew empty data and current failure only clear captured cells',async()=>{
 const f=fixture(),p=f.c.loadRedListData();f.calls[0].resolve(success([]));await p;assert.equal(f.calls.length,1);assert.match(f.cells[0].innerHTML,/>-</);
 const g=fixture(),q=g.c.loadRedListData();g.calls[0].reject(Error('private fixture'));await q;assert.match(g.cells[0].innerHTML,/>-</);assert.deepEqual(g.logs,['[Red List] Data load failed']);
});
test('real card renderer ID attribute connects to normal red-list read and real display',async()=>{
 const f=fixture(['SYNTHETIC"ID']);Object.assign(f.c,{getResultOverallColor:()=>'',getTutorDisplayName:()=>'-',renderStudentTextTypeBadge:()=>'-',formatYouTubeUrl:()=>'',formatXUrl:()=>'',getPreviousMonth:()=> '2026-09',getLessonProgressStatus:()=>({color:''}),getLessonProgressClass:()=>'',getLessonSection:()=>null,formatDateForMonthInput:()=>'',formatDate:()=>'',calculateContinuedMonths:()=>0});
 vm.runInContext(['studentDisplayText','studentDisplayAttribute','studentDisplayLink','renderStudentRowsSimple'].map(extract).join('\n'),f.c);const html=f.c.renderStudentRowsSimple();const match=html.match(/class="red-list-loading[^\"]*" data-student-id="([^\"]*)"/);assert.ok(match);const id=match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&');assert.equal(id,f.students[0].student_id);f.cells[0].dataset.studentId=id;const p=f.c.loadRedListData();f.calls[0].resolve(success([row(id)]));await p;assert.match(f.cells[0].innerHTML,/5点/);assert.match(f.cells[0].innerHTML,/HIGH/);
});
