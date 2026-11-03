import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { aggregateExtensionStats, proPlanMonths } from '../src/services/extensionStatsService.js';
import { splitStatsReport, sendDailyStatsReport } from '../src/services/statsReportService.js';

const now = new Date('2026-11-03T00:00:00Z');
const student = (id, months, start) => ({ student_id: id, continued_months: months,
  pro_plan_start_date: start, homeroom_tutor: 'TestTutor', team: 'TestTeam' });

test('rounds 3–6 use independent result columns and PRO start months, not total months', () => {
  const students = [student('R3', 17), student('R4', 23, '2026-07-01'),
    student('R5', 29, '2026-01-01'), student('R6', 35, '2025-07-01'), student('NO', 23)];
  const rows = students.map((s, i) => ({ student_id: s.student_id,
    examination_result_2: '退会', [`examination_result_${i + 3}`]: i === 1 ? '永久会員' : i === 2 ? null : '延長' }));
  const { stats, teams, tutors } = aggregateExtensionStats(students, rows, now);
  assert.equal(stats.targetCount, 4);
  assert.equal(stats.extensionCount, 2);
  assert.equal(stats.lifetimeCount, 1);
  assert.equal(stats.withdrawalCount, 0);
  assert.equal(stats.remainingCount, 1);
  assert.equal(stats.extensionRate, 50);
  assert.equal(stats.exam3rd.extensionRate, 100);
  assert.equal(stats.exam4th.lifetimeCount, 1);
  assert.equal(stats.exam5th.extensionCount, 0);
  assert.equal(stats.exam6th.extensionCount, 1);
  assert.equal(teams[0].targetCount, stats.targetCount);
  assert.equal(teams[0].exam6thExtensionRate, 100);
  assert.equal(tutors[0].examTargetCount, 4);
  assert.equal(tutors[0].examIncompleteCount, 1);
});

test('hearing months 16 and PRO 4/10/16 use the respective round, with no stale round 2 fallback', () => {
  const students = [student('R3', 16), student('R4', 22, '2026-08-01'),
    student('R5', 28, '2026-02-01'), student('R6', 34, '2025-08-01')];
  const rows = students.map((s, i) => ({ student_id: s.student_id, hearing_status_2: true,
    [`hearing_status_${i + 3}`]: i === 0, [`extension_certainty_${i + 3}`]: i === 1 ? '対象外' : '高' }));
  const { stats, tutors } = aggregateExtensionStats(students, rows, now);
  assert.equal(stats.targetCount, 0);
  assert.equal(stats.certaintyFilledCount, 3);
  assert.equal(tutors[0].hearingTargetCount, 4);
  assert.equal(tutors[0].hearingIncompleteCount, 3);
});

test('PRO months switch at JST month boundary and unset/invalid dates are not targets', () => {
  assert.equal(proPlanMonths('2026-07-01', new Date('2026-10-31T14:59:59Z')), 4);
  assert.equal(proPlanMonths('2026-07-01', new Date('2026-10-31T15:00:00Z')), 5);
  for (const date of [null, '', 'invalid', '2027-01-01']) assert.equal(proPlanMonths(date, now), null);
});

test('Discord report includes rounds 3–6 overall and by team without exceeding content limits', async () => {
  const old = process.env.DISCORD_STATS_WEBHOOK_URL;
  try {
    process.env.DISCORD_STATS_WEBHOOK_URL = 'https://example.invalid/test-only';
    const { stats, teams } = aggregateExtensionStats([student('R6', 35, '2025-07-01')], [{ student_id: 'R6', examination_result_6: '延長' }], now);
    const posts = [];
    await sendDailyStatsReport({ now: () => now, query: async sql => ({ rows: sql.includes('FROM tutors')
      ? Array.from({ length: 30 }, (_, i) => ({ employee_id: String(i), tutor_name: 'T', notion_name: 'T', team: `Team${Math.floor(i / 2)}` })) : [] }),
      api: { get: async path => ({ data: { success: true, data: path.endsWith('/stats') ? stats
        : path.endsWith('/by-team') ? Array.from({ length: 15 }, (_, i) => ({ ...teams[0], teamName: `Team${i}` })) : {} } }) },
      fetchWanami: async () => ({}), http: { post: async (_, payload) => posts.push(payload) } });
    const text = posts.map(p => p.content).join('\n');
    assert.match(text, /3回目（17ヶ月目）/);
    assert.match(text, /4回目（PRO継続5ヶ月目）/);
    assert.match(text, /5回目（PRO継続11ヶ月目）/);
    assert.match(text, /6回目（PRO継続17ヶ月目）: \*\*100%\*\*/);
    assert.match(text, /6回目: 100% \(1\/1人\)/);
    assert.ok(posts.length > 1);
    assert.ok(posts.every(p => p.content.length <= 2000));
    assert.equal((text.match(/<@&/g) || []).length, 1);
  } finally {
    if (old === undefined) delete process.env.DISCORD_STATS_WEBHOOK_URL; else process.env.DISCORD_STATS_WEBHOOK_URL = old;
  }
  assert.deepEqual(splitStatsReport('short report'), ['short report']);
  assert.ok(splitStatsReport('x'.repeat(4500)).every(s => s.length <= 2000));
});

test('extension page renders all six round cards and team columns', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function renderExtensionsPage(');
  const end = source.indexOf('\n}', start) + 2;
  const content = { innerHTML: '' };
  const result = aggregateExtensionStats([student('R6', 35, '2025-07-01')], [], now);
  const context = { document: { getElementById: () => content }, API_BASE: '',
    axios: { get: async url => ({ data: { success: true, data: url.endsWith('/stats') ? result.stats : url.endsWith('/by-team') ? result.teams : result.tutors } }) },
    currentUser: { role: 'leader' }, currentTutorName: 'TestTutor', selectedExtensionTutor: 'TestTutor',
    updateExtensionBadges() {}, console: { error() {} } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.renderExtensionsPage();
  for (let i = 1; i <= 6; i++) assert.ok(content.innerHTML.includes(`${i}回目延長審査`));
  assert.ok(content.innerHTML.includes('6回目延長率'));
  assert.ok(content.innerHTML.includes('PRO継続17ヶ月目'));
});
