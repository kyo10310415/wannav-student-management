import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)};
const marker='<b data-synthetic="red-card">SYNTHETIC</b>';
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function fixture(){
 const entry={tutor_id:`Synthetic'"/${marker}`,tutor_name:`Tutor'" ${marker}`,assigned_to:`Owner" ${marker}`,snapshot_team:marker,total_score:7,current_helper_request_count:2,helper_request_score:2,attendance_score:3,correspondence_status:'未対応'},root={contains:n=>n.root===root},calls=[],notices=[],confirmations=[];
 const c={URL,API_BASE:'',sessionToken:'synthetic',currentUser:{role:'admin'},currentPage:'tutor-red-list',tutorRedListData:[entry],escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),document:{getElementById:id=>id==='content'?root:null,addEventListener(){}},console:{error(){}},confirm:s=>{confirmations.push(s);return true},showNotification:(...args)=>notices.push(args),_renderTutorRedListContent:()=>{},axios:{patch:async(url,body,options)=>{calls.push({url,body,options});return{data:{success:true}}},delete:async(url,options)=>{calls.push({url,options});return{data:{success:true}}}}};
 vm.createContext(c);for(const name of ['studentDisplayText','studentDisplayAttribute','_renderTutorRedListCard','updateTutorRedListStatus','updateTutorRedListAssigned','deleteTutorRedListEntry'])vm.runInContext(extract(name),c);
 const control=(action,value='')=>({root,disabled:false,value,dataset:{tutorRedAction:action,tutorRedId:entry.tutor_id},closest(){return this}});
 const install=()=>{for(const name of ['tutorRedCardEntry','handleTutorRedCardChange','handleTutorRedCardClick'])vm.runInContext(extract(name),c)};
 return{c,entry,root,calls,notices,confirmations,control,install};
}
test('actual Tutor red card escapes quoted attributes and replaces all three dynamic inline handlers',()=>{
 const f=fixture(),html=f.c._renderTutorRedListCard(f.entry,{text:'text-red-600'});
 assert.equal(html.includes(marker),false);
 assert.equal(/on(?:click|change)="(?:updateTutorRedListStatus|updateTutorRedListAssigned|deleteTutorRedListEntry)/.test(html),false);
 assert.equal(decode(html.match(/data-tutor-red-action="assigned"[^>]*data-tutor-red-id="([^"]*)"/)[1]),f.entry.tutor_id);
 assert.equal(decode(html.match(/value="([^"]*)"\s+placeholder="担当者名"/)[1]),f.entry.assigned_to);
});
test('real rendered attributes reach fixed entry and actual status, assigned and delete methods with encoded ID',async()=>{
 const f=fixture();f.install();const html=f.c._renderTutorRedListCard(f.entry,{text:'text-red-600'}),id=decode(html.match(/data-tutor-red-action="status"[^>]*data-tutor-red-id="([^"]*)"/)[1]);
 const status=f.control('status','対応中');status.dataset.tutorRedId=id;await f.c.handleTutorRedCardChange({target:status});assert.equal(f.entry.correspondence_status,'対応中');
 const assigned=f.control('assigned','');await f.c.handleTutorRedCardChange({target:assigned});assert.equal(f.entry.assigned_to,'');
 await f.c.handleTutorRedCardClick({target:f.control('delete')});assert.equal(f.calls.length,3);for(const call of f.calls){assert.ok(call.url.startsWith('/api/tutor-red-list/'+encodeURIComponent(id)));assert.equal(call.options.headers.Authorization,'Bearer synthetic')};assert.equal(f.calls[0].body.correspondence_status,'対応中');assert.equal(f.calls[1].body.assigned_to,'');assert.ok(f.confirmations[0].includes(f.entry.tutor_name));assert.equal(f.c.tutorRedListData.length,0);
});
test('fixed Tutor red entry rejects stale cache/root/page, non-admin, disabled and unknown status/actions',async()=>{
 const variants=[f=>f.c.tutorRedListData=[],f=>f.c.currentPage='students',f=>f.c.sessionToken='',f=>f.c.currentUser=null,f=>f.c.currentUser.role='leader',f=>f.c.currentUser.role='crew'];
 for(const mutate of variants){const f=fixture();f.install();mutate(f);await f.c.handleTutorRedCardChange({target:f.control('status','対応中')});await f.c.handleTutorRedCardClick({target:f.control('delete')});assert.equal(f.calls.length+f.confirmations.length,0)}
 const f=fixture();f.install();for(const change of [n=>n.root={},n=>n.disabled=true,n=>n.dataset.tutorRedId='missing',n=>n.value='invalid']){const n=f.control('status','対応中');change(n);await f.c.handleTutorRedCardChange({target:n})}await f.c.handleTutorRedCardChange({target:f.control('unknown')});assert.equal(f.calls.length,0);
});
