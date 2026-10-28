import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../public/red-list-card-events.js', import.meta.url), 'utf8');
const escapeHtml = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
test('real current/history cards escape stored text, quote boundaries and unsafe links', () => {
  const id = `S'\"><img src=x onerror=alert(1)>`;
  const c = { URL, escapeHtml, students: [{student_id:id,name:'<svg onload=alert(2)>',homeroom_tutor:'<script>x</script>',notion_url:'javascript:alert(3)',discord_url:'https://example.test/" onmouseover="x',youtube_channel_id:'https://example.test/"',x_account_id:'https://example.test/"'}], cachedNotionUrls:{}, redListDiscordLogs:{},surveyStatsCache:{},getTutorDisplayName:v=>v,formatYouTubeUrl:v=>v,formatXUrl:v=>v,renderRedListDiscordLogs:()=>'' };
  vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function renderRedListStudentCard('), app.indexOf('\nfunction ',app.indexOf('function renderRedListStudentCard(')+10)),c);
  for (const history of [false,true]) {
    const html = c.renderRedListStudentCard({student_id:id,year_month:'2026-10',assigned_to:'" autofocus onfocus="alert(4)'},history);
    assert.ok(html.includes('&lt;svg onload=alert(2)&gt;'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('value="&quot; autofocus onfocus=&quot;alert(4)"'));
    assert.ok(!html.includes('<img'));assert.ok(!html.includes('javascript:'));assert.ok(!/on(?:click|change)="/.test(html));
    assert.ok(html.includes('href="https://example.test/%22%20onmouseover=%22x"'));assert.equal((html.match(/data-red-list-card-action=/g)||[]).length,4);
  }
});
test('fixed actions use verified cache identity and exact values; crew, stale roots and invalid controls deny', () => {
 const calls=[]; const content={contains:n=>n.active}; const row={student_id:`S'"`,year_month:'2026-10',student_name:'<svg>',ex_rank:true};
 const c={document:{getElementById:()=>content,addEventListener(){}},sessionToken:'synthetic',currentUser:{role:'admin'},currentPage:'red-list',currentRedListData:[row],historyRedListData:[],students:[]};
 for(const name of ['updateRedListStatus','updateRedListAssigned','openRedListDiscordModal','toggleExRank'])c[name]=(...args)=>calls.push([name,...args]);vm.createContext(c);vm.runInContext(events,c);
 const control={active:true,dataset:{redListStudentId:row.student_id,redListYearMonth:row.year_month},closest(){return this},value:'対応中'};
 const fire=(action,type)=>{control.dataset.redListCardAction=action;c.handleRedListCardEvent({target:control,type})};
 fire('status','change');control.value='"<value>';fire('assigned','change');fire('send-prepare','click');fire('ex','click');assert.equal(calls.length,4);assert.deepEqual(calls[2],['openRedListDiscordModal',row.student_id,'<svg>','2026-10']);
 c.currentUser.role='crew';fire('status','change');c.currentUser.role='admin';control.active=false;fire('ex','click');control.active=true;control.dataset.redListYearMonth='2026-13';fire('ex','click');control.dataset.redListYearMonth='2026-10';control.dataset.redListStudentId='missing';fire('ex','click');assert.equal(calls.length,4);
});
test('Discord sender is escaped and missing message content is safe',()=>{
 const c={escapeHtml,redListDiscordLogs:{'S_2026-10':[{sent_by:'<svg onload=x>',sent_at:'2026-10-01',message_content:null}]}};vm.createContext(c);const start=app.indexOf('function renderRedListDiscordLogs(');vm.runInContext(app.slice(start,app.indexOf('\nfunction ',start+10)),c);const html=c.renderRedListDiscordLogs('S','2026-10');assert.ok(html.includes('&lt;svg onload=x&gt;'));assert.ok(!html.includes('<svg'));
});
