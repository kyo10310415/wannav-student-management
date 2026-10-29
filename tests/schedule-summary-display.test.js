import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2)};
const benign='<b data-synthetic="keyword">fixture</b>';
const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
test('real schedule summary escapes imported keywords and counts prototype-like names normally',()=>{
 const schedules=[benign,benign,'__proto__','constructor'].map(matched_keyword=>({matched_keyword}));
 const c={getFilteredSchedules:()=>schedules,escapeHtml};vm.createContext(c);vm.runInContext(extract('renderScheduleStatistics'),c);
 const html=c.renderScheduleStatistics();assert.equal(html.includes(benign),false);assert.ok(html.includes('&lt;b data-synthetic="keyword"&gt;fixture&lt;/b&gt;'));assert.ok(html.includes('2件'));assert.ok(html.includes('4件'));assert.ok(html.includes('__proto__'));assert.ok(html.includes('constructor'));
});
test('real dynamic leader and attendee filters preserve cached values as escaped text and attributes',()=>{
 const name='" '+benign;
 const c={schedules:[{leader_name:name,attendee_names:[name,name]}],selectedLeader:name,selectedAttendee:name,escapeHtml};vm.createContext(c);vm.runInContext(extract('renderLeaderFilterOptions')+'\n'+extract('renderAttendeeFilterOptions'),c);
 for(const html of [c.renderLeaderFilterOptions(),c.renderAttendeeFilterOptions()]){assert.equal(html.includes(benign),false);assert.ok(html.includes('value="&quot; &lt;b data-synthetic=&quot;keyword&quot;&gt;fixture&lt;/b&gt;" selected'));assert.equal((html.match(/ selected/g)||[]).length,1)}
});
