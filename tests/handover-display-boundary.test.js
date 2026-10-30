import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const marker='<b data-synthetic="handover">fixture</b>';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function fixture(view='handover'){
 const student={student_id:'Synthetic\'"/'+marker,name:'Synthetic\'" '+marker,notion_url:'javascript:synthetic-placeholder',discord_url:'https://example.test/discord?q="'+marker,lesson_progress:1,remaining_lessons:2,homeroom_tutor:'Synthetic',handover_tutor_name:'Tutor" '+marker,contract_plan:'normal',lesson_start_date:'2026/10/01'};
 const tutor={tutor_name:student.handover_tutor_name},calls=[],clipboard=[],notices=[],root={contains:node=>node.root===root};
 const c={URL,API_BASE:'',sessionToken:'synthetic',currentUser:{role:'leader'},currentPage:'handover',handoverActiveTab:view,handoverStudents:[student],newAssignStudents:[student],handoverTutorSidebar:[tutor],_getHandoverFiltered:()=>[student],_getNewAssignFiltered:()=>[student],getTutorDisplayName:v=>v,_handoverProgressBadge:()=>'<span>section</span>',_handoverContinuedMonthsBadge:()=>'<span>1month</span>',renderStudentTextTypeBadge:()=>'<span>旧</span>',escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),document:{getElementById:id=>id==='content'?root:null,addEventListener(){}},navigator:{clipboard:{writeText:text=>{clipboard.push(text);return Promise.resolve()}}},showNotification:(...args)=>notices.push(args),console:{error(){}},axios:{put:async(url,body,options)=>{calls.push({url,body,options});return{data:{success:true}}},get:async()=>({data:{data:[tutor]}})}};
 vm.createContext(c);for(const name of ['studentDisplayText','studentDisplayAttribute','studentDisplayLink','_renderHandoverRows','_renderNewAssignRows','handoverEntryStudent','handleHandoverEntryClick','handleHandoverEntryChange','handoverCopyInfo','handoverUpdateAssignment','newAssignUpdateAssignment'])vm.runInContext(extract(name),c);
 const control=(action,value='')=>({root,disabled:false,value,dataset:{handoverEntry:action,handoverEntryView:view,handoverEntryId:student.student_id},closest(){return this}});
 return{c,student,tutor,calls,clipboard,notices,root,control};
}
test('both actual handover workflows protect quoted option values, URLs and action attributes',()=>{
 for(const view of ['handover','new']){const f=fixture(view),html=view==='handover'?f.c._renderHandoverRows():f.c._renderNewAssignRows();assert.equal(html.includes(marker),false);assert.equal(html.includes('javascript:'),false);assert.ok(html.includes('href="https://example.test/discord?q=%22'));assert.ok(html.includes('value="Tutor&quot; &lt;b data-synthetic=&quot;handover&quot;&gt;fixture&lt;/b&gt;" selected'));assert.equal(/on(?:click|change)="(?:handoverCopyInfo|handoverUpdateAssignment|newAssignUpdateAssignment)/.test(html),false);assert.ok(html.includes('data-handover-entry-view="'+view+'"'));}
});
test('actual renderer attributes connect to fixed assignment entry and actual save preserving ID and selected Tutor',async()=>{
 for(const view of ['handover','new']){const f=fixture(view),html=view==='handover'?f.c._renderHandoverRows():f.c._renderNewAssignRows();const id=decode(html.match(/data-handover-entry="assignment"[^>]*data-handover-entry-id="([^"]*)"/)[1]);const value=decode(html.match(/<option value="([^"]*)" selected/)[1]);const control=f.control('assignment',value);control.dataset.handoverEntryId=id;await f.c.handleHandoverEntryChange({target:control});assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/handover/students/'+encodeURIComponent(f.student.student_id)+'/assignment');assert.equal(f.calls[0].body.handover_tutor_name,f.tutor.tutor_name);assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic');
 control.value='';await f.c.handleHandoverEntryChange({target:control});assert.equal(f.calls[1].body.handover_tutor_name,null);assert.equal(f.student.handover_tutor_name,'');}
});
test('fixed copy entry uses actual cached plain text rather than inline code for both workflows',async()=>{
 for(const view of ['handover','new']){const f=fixture(view),html=view==='handover'?f.c._renderHandoverRows():f.c._renderNewAssignRows(),control=f.control('copy');control.dataset.handoverEntryId=decode(html.match(/data-handover-entry="copy"[^>]*data-handover-entry-id="([^"]*)"/)[1]);f.c.handleHandoverEntryClick({target:control});await Promise.resolve();assert.equal(f.clipboard.length,1);assert.ok(f.clipboard[0].includes(f.student.name));assert.ok(f.clipboard[0].includes(f.student.discord_url));assert.equal(f.calls.length,0);}
});
test('entry rejects stale tabs/root/cache, crew, unknown Tutor and disabled controls',async()=>{
 for(const mutate of [f=>f.c.currentUser.role='crew',f=>f.c.currentPage='students',f=>f.c.sessionToken='',f=>f.c.handoverActiveTab='new',f=>f.c._getHandoverFiltered=()=>[]]){const f=fixture();mutate(f);await f.c.handleHandoverEntryChange({target:f.control('assignment',f.tutor.tutor_name)});f.c.handleHandoverEntryClick({target:f.control('copy')});assert.equal(f.calls.length+f.clipboard.length,0)}
 const f=fixture();await f.c.handleHandoverEntryChange({target:f.control('assignment','unknown')});const stale=f.control('assignment',f.tutor.tutor_name);stale.root={};await f.c.handleHandoverEntryChange({target:stale});stale.root=f.root;stale.disabled=true;await f.c.handleHandoverEntryChange({target:stale});assert.equal(f.calls.length,0);
});
