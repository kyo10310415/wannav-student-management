import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
const marker = '<b data-synthetic="display">fixture</b>';
function fixture(role = 'crew') {
  const student = { student_id: 'synthetic\'" ' + marker, name: marker, status: marker, contract_plan: marker, character_name: marker, homeroom_tutor: marker, lesson_progress: marker, result_overall: marker, absence_count: 2, pro_plan_start_date: '2026-10-01', pro_plan_continued_months: 1, notion_url: 'javascript:synthetic-placeholder', discord_url: 'https://example.test/discord?q="' + marker, youtube_channel_id: '@synthetic', x_account_id: '@synthetic' };
  const root = { contains: node => node.root === root }, calls = [], listeners = [];
  const context = { URL, escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'), getFilteredStudents: () => [student], getTutorDisplayName: value => value, renderStudentTextTypeBadge: () => '<span>旧</span>', getLessonProgressClass: () => '', getResultOverallColor: () => '', getLessonProgressStatus: () => ({ color: '' }), getLessonSection: () => ({ label: 'C', cls: 'section-color' }), calculateContinuedMonths: () => 1, formatDate: () => '2026-10-01', getPreviousMonth: () => '2026-09', document: { getElementById: () => root, addEventListener: (...args) => listeners.push(args) }, currentUser: { role }, sessionToken: 'synthetic', currentPage: 'students', updateProPlanStartDate: (...args) => calls.push(args) };
  vm.createContext(context);
  for (const name of ['studentDisplayText','studentDisplayAttribute','studentDisplayLink','formatYouTubeUrl','formatXUrl','formatDateForMonthInput','renderStudentRowsSimple','renderStudentsCards','handleStudentProPlanChange']) vm.runInContext(extract(name),context);
  const input = { root, disabled: false, value: '2026-11', dataset: { studentProPlanId: student.student_id }, closest() { return this; } };
  return { context, student, root, calls, input };
}
test('real card renderer treats stored text/title/IDs as data and preserves normal summary values', () => {
  const f=fixture(), html=f.context.renderStudentRowsSimple();
  assert.equal(html.includes(marker),false);assert.ok(html.includes('&lt;b data-synthetic="display"&gt;fixture&lt;/b&gt;'));
  assert.ok(html.includes('title="&lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  assert.ok(html.includes('data-student-pro-plan-id="synthetic\'&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  assert.ok(html.includes('value="2026-10"'));assert.ok(html.includes('1月'));assert.ok(html.includes('section-color'));
  f.context.renderStudentsCards();assert.equal(f.root.innerHTML,html);
  f.context.getFilteredStudents=()=>[];assert.ok(f.context.renderStudentRowsSimple().includes('該当する生徒が見つかりません'));
});
test('real card links reject unsupported schemes and encode evaluation IDs without inline student interpolation', () => {
  const f=fixture(), html=f.context.renderStudentRowsSimple();
  assert.equal(html.includes('javascript:'),false);assert.ok(html.includes('https://example.test/discord?q=%22'));
  assert.ok(html.includes('studentId='+encodeURIComponent(f.student.student_id)+'&amp;month=2026-09'));
  for(const match of html.matchAll(/href="([^"]*)"/g))assert.match(match[1],/^https?:\/\//);
  assert.equal(/onchange="updateProPlanStartDate/.test(html),false);
});
test('fixed PRO month entry sends exact cached ID/value/input for all existing roles and rejects detached state', () => {
  for(const role of ['crew','leader','admin']){const f=fixture(role);f.context.handleStudentProPlanChange({target:f.input});assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],f.student.student_id);assert.equal(f.calls[0][1],'2026-11');assert.equal(f.calls[0][2],f.input)}
  for(const change of [f=>f.input.disabled=true,f=>f.input.root={},f=>f.context.currentPage='reservations',f=>f.context.sessionToken='',f=>f.context.currentUser=null,f=>f.context.currentUser.role='unknown',f=>f.context.getFilteredStudents=()=>[],f=>f.input.dataset.studentProPlanId='other']){const f=fixture();change(f);f.context.handleStudentProPlanChange({target:f.input});assert.equal(f.calls.length,0)}
});
