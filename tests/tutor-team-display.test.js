import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const events=await readFile(new URL('../public/tutor-read-events.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2)};
const team='Synthetic" <b data-synthetic="team">fixture</b>';
function fixture(){
 const renders=[],root={contains:node=>node.root===root};
 const c={sessionToken:'synthetic',currentUser:{role:'crew'},currentPage:'tutors',selectedTeam:team,tutors:[{status:'アクティブ',job_type:'Tutor',team},{status:'アクティブ',job_type:'tutor',team},{status:'アクティブ',job_type:'Tutor',team:null},{status:'退職',job_type:'Tutor',team:'Excluded former'},{status:'アクティブ',job_type:'Staff',team:'Excluded staff'}],escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),document:{getElementById:()=>root,addEventListener(){}},renderTutorsPage:()=>renders.push(c.selectedTeam)};
 vm.createContext(c);for(const name of ['studentDisplayText','studentDisplayAttribute','renderTeamFilterOptions','handleTeamFilterChange'])vm.runInContext(extract(name),c);vm.runInContext(events,c);
 return{c,renders,root};
}
test('shared team options escape saved text and quotes while retaining active Tutor candidates and selection',()=>{
 const f=fixture(),html=f.c.renderTeamFilterOptions();assert.equal(html.includes('<b data-synthetic='),false);assert.ok(html.includes('value="Synthetic&quot; &lt;b data-synthetic=&quot;team&quot;&gt;fixture&lt;/b&gt;" selected'));assert.ok(html.includes('Synthetic" &lt;b data-synthetic="team"&gt;fixture&lt;/b&gt;</option>'));
 assert.equal((html.match(/<option /g)||[]).length,3);assert.ok(html.includes('未所属'));assert.equal(html.includes('Excluded'),false);assert.equal((html.match(/ selected/g)||[]).length,1);
 f.c.selectedTeam='all';assert.match(f.c.renderTeamFilterOptions(),/value="all" selected/);
});
test('existing fixed team-change entry retains exact saved value for all authorized roles and rerenders once',()=>{
 for(const role of ['crew','leader','admin']){const f=fixture();f.c.currentUser.role=role;const select={root:f.root,value:team,closest(){return this}};f.c.handleTutorTeamChange({target:select});assert.equal(f.c.selectedTeam,team);assert.deepEqual(f.renders,[team]);}
 const f=fixture(),select={root:{},value:team,closest(){return this}};f.c.handleTutorTeamChange({target:select});assert.equal(f.renders.length,0);
});
