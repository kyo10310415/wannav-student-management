import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const extract = name => { const start = source.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
const marker = '<b data-synthetic="display">fixture</b>';
const escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function fixture() {
  const student = { student_id: 'synthetic" ' + marker, name: marker, status: marker, contract_plan: marker, character_name: marker, homeroom_tutor: marker, lesson_progress: marker, result_overall: marker, absence_count: 2, notion_url: 'https://example.test/notion?q="' + marker, discord_url: 'https://example.test/discord?q="' + marker, youtube_channel_id: 'https://www.youtube.com/@synthetic?q="' + marker, x_account_id: 'https://x.com/synthetic?q="' + marker, payment_status_last_month: marker };
  const date = new Date(2026,9,29), lesson = { formatted: '10/29', time: marker, meet_link: 'https://meet.google.com/synthetic?q="' + marker };
  const roots = { 'student-table-body': { innerHTML: '' } };
  const context = { URL, escapeHtml, currentMonth: date, getFilteredStudents: () => [student], lessonStats: { [student.student_id]: 1 }, lessonDates: { [student.student_id]: [lesson] }, getLessonCountColor: () => '', getLessonCountBadgeColor: () => '', getTutorDisplayName: value => value, renderStudentTextTypeBadge: () => '<span>旧</span>', getLessonProgressClass: () => '', getResultOverallColor: () => '', calculateContinuedMonths: () => 1, isFirstLessonOfMonth: () => false, getPreviousMonth: () => '2026-09', document: { getElementById: id => roots[id] }, lessonReportStatus: {} };
  vm.createContext(context);
  for (const name of ['studentDisplayText','studentDisplayAttribute','studentDisplayLink','formatYouTubeUrl','formatXUrl','getLessonProgressDisplay','getLessonReportButton','renderStudentRows','renderTodayStudentRows','renderStudentTable']) vm.runInContext(extract(name), context);
  return { context, student, lesson, date, roots };
}
test('real reservation and daily renderers escape stored text, title and identifier attributes', () => {
  const f = fixture();
  for (const html of [f.context.renderStudentRows(), f.context.renderTodayStudentRows([f.student], f.date)]) {
    assert.equal(html.includes(marker), false); assert.ok(html.includes('&lt;b data-synthetic="display"&gt;fixture&lt;/b&gt;'));
    assert.ok(html.includes('title="&lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
    assert.ok(html.includes('studentId=' + encodeURIComponent(f.student.student_id) + '&amp;month=2026-09'));
    assert.ok(html.includes('data-minutes-student-id="synthetic&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  }
  const html = f.context.renderStudentRows(); assert.ok(html.includes('data-student-id="synthetic&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  f.context.renderStudentTable(); assert.equal(f.roots['student-table-body'].innerHTML, html);
});
test('external anchors retain HTTP(S), encode quotes and remove unsupported schemes', () => {
  const f = fixture();
  for (const html of [f.context.renderStudentRows(),f.context.renderTodayStudentRows([f.student], f.date)]) {
    assert.ok(html.includes('https://example.test/notion?q=%22')); assert.ok(html.includes('https://www.youtube.com/@synthetic?q=%22'));
    for (const match of html.matchAll(/href="([^"]*)"/g)) assert.match(match[1], /^https?:\/\//);
  }
  f.student.notion_url = 'javascript:synthetic'; f.student.discord_url = 'data:text/plain,synthetic'; f.lesson.meet_link = 'file:///synthetic';
  for (const html of [f.context.renderStudentRows(), f.context.renderTodayStudentRows([f.student], f.date)]) for (const scheme of ['javascript:', 'data:text/', 'file:']) assert.equal(html.includes(scheme), false);
  for (const value of ['https://example.test/path?a=1&b=2','http://example.test/path']) assert.ok(f.context.studentDisplayLink(value));
  for (const value of [null,'','relative/path','javascript:synthetic','data:text/plain,synthetic']) assert.equal(f.context.studentDisplayLink(value), null);
});
test('daily report preparation preserves raw cached identifiers and dates in safe data attributes', () => {
  const f=fixture(), html=f.context.renderTodayStudentRows([f.student],f.date);
  assert.ok(html.includes('data-report-prepare-action="open"'));assert.ok(html.includes('data-report-date="2026-10-29"'));
  assert.ok(html.includes('data-report-student-id="synthetic&quot; &lt;b data-synthetic=&quot;display&quot;&gt;fixture&lt;/b&gt;"'));
  assert.equal(f.student.student_id,'synthetic" '+marker);
  assert.ok(f.context.renderTodayStudentRows([],f.date).includes('この日のレッスンはありません'));
  f.context.getFilteredStudents=()=>[];assert.ok(f.context.renderStudentRows().includes('該当する生徒が見つかりません'));
});
