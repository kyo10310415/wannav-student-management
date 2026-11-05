import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ACTION_RULES, actionPeriods, summarizeActionPoints, validateChatEvaluation } from '../src/services/actionPointRules.js';
import { createActionPointService } from '../src/services/actionPointService.js';

const now = new Date('2026-11-12T03:00:00Z');
const student = { student_id: 'S1', lesson_start_date: '2025-01-01', homeroom_tutor: 'B' };
const item = (key, point, status = 'evaluated') => ({ key, point, status });
test('15 unique criteria exclude group attendance and merge survey; exact 30/60 percent boundaries', () => {
  assert.equal(ACTION_RULES.length, 15);
  assert.equal(new Set(ACTION_RULES.map(r => r.key)).size, 15);
  for (const [total, denominator, rank] of [[0, 10, 'none'], [2, 10, 'none'], [3, 10, 'middle'], [5, 10, 'middle'], [6, 10, 'high'], [1, 3, 'middle'], [2, 3, 'high']]) {
    const result = summarizeActionPoints(Array.from({ length: denominator }, (_, i) => item(String(i), i < total ? 1 : 0)).concat(item('unknown', 1, 'unknown'), item('exempt', 1, 'exempt')));
    assert.equal(result.rank, rank); assert.equal(result.total, total); assert.equal(result.evaluated, denominator);
  }
  assert.equal(summarizeActionPoints([item('unknown', null, 'unknown')]).ratio, null);
});
test('periods use JST and handle year rollover', () => {
  const p = actionPeriods(new Date('2026-12-31T15:01:00Z'));
  assert.equal(p.month, '2027-01'); assert.equal(p.previous, '2026-12');
});

function fixture(overrides = {}) {
  const writes = [], sqlCalls = [];
  let old = overrides.old || [];
  const db = async (sql, params = []) => {
    sqlCalls.push({ sql, params });
    if (sql.includes('INSERT INTO action_point_tutor_snapshots')) { writes.push({ sql, params }); return { rowCount: 1 }; }
    if (sql.includes('WITH saved AS')) { writes.push({ sql, params }); if (overrides.failStudent === params[0]) throw new Error('SYNTHETIC_PRIVATE'); return { rows: [] }; }
    if (sql.includes("FROM students WHERE status")) return { rows: overrides.students || [student] };
    if (sql.includes('FROM lesson_reports')) return { rows: overrides.reports || [{ student_id: 'S1', absence: 1, reschedule: 1, completed: 1 }] };
    if (sql.includes('FROM lessons')) return { rows: [{ student_id: 'S1', count: 1 }] };
    if (sql.includes('FROM action_point_tutor_snapshots')) return { rows: overrides.snapshots ?? [{ student_id: 'S1', tutor_name: 'A' }] };
    if (sql.includes('FROM action_point_results')) return { rows: old };
    if (sql.includes('FROM red_list WHERE')) return { rows: overrides.legacyLocks || [] };
    return { rows: [] };
  };
  const deps = {
    query: db, satisfaction: async () => [{ student_id: 'S1', year_month: '2026/11', timestamp: '2026-11-01', satisfaction_score: 3 },
      { student_id: 'S1', year_month: '2026/11', timestamp: '2026-11-10', satisfaction_score: 9 }],
    wanami: async () => [['invalid date'], ['2026-10-10', ...Array(13).fill(''), 'S1']],
    contacts: async () => [], learning: async () => [{ student_id: 'S1', last_watched_at: '2026-11-11' }],
    social: async () => ({}), ...overrides.deps
  };
  return { service: createActionPointService(deps), writes, sqlCalls, setOld: value => { old = value; } };
}
test('latest satisfaction, unit points, monthly execution / 2, tutor change and missing sources', async () => {
  const f = fixture(); assert.deepEqual(await f.service.updateAll(null, now), { updated: 1, errors: 0 });
  const result = f.writes[0].params[9]; const get = key => result.items.find(i => i.key === key);
  assert.equal(get('satisfaction').point, 0); assert.equal(get('absence').point, 1);
  assert.equal(get('attendance').point, 1); assert.equal(get('survey').point, 1);
  assert.equal(get('wanami').point, 0); assert.equal(get('video').point, 0);
  assert.equal(get('handover').point, 1); assert.equal(get('mission').status, 'unknown');
  assert.equal(get('chat_frequency').status, 'unknown'); assert.equal(get('x').status, 'unknown');
  assert.equal(result.items.every(i => i.point === null || i.point === 0 || i.point === 1), true);
  const periods = f.sqlCalls.find(c => c.sql.includes('FROM lesson_reports')).params;
  assert.deepEqual(periods, ['2026-10-01', '2026-11-01', '2026-12-01']);
  assert.match(f.writes[0].sql, /WITH saved AS/); assert.match(f.writes[0].sql, /INSERT INTO red_list/);
});
test('absent snapshot is unknown; initial assignment and unchanged Tutor never add points', async () => {
  for (const [snapshots, expected] of [[[], null], [[{ student_id: 'S1', tutor_name: null }], 0], [[{ student_id: 'S1', tutor_name: 'B' }], 0]]) {
    const f = fixture({ snapshots }); await f.service.updateAll(null, now);
    assert.equal(f.writes[0].params[9].items.find(i => i.key === 'handover').point, expected);
  }
});
test('learning/cache failures are unknown and new students do not inherit prior-month nonparticipation', async () => {
  const f = fixture({ students: [{ ...student, lesson_start_date: '2026-11-11' }], reports: [], deps: {
    learning: async () => { throw new Error('SYNTHETIC_PRIVATE'); }, satisfaction: async () => { throw new Error('SYNTHETIC_PRIVATE'); }
  } }); await f.service.updateAll(null, now);
  const result = f.writes[0].params[9]; const get = key => result.items.find(i => i.key === key);
  assert.equal(get('video').status, 'unknown'); assert.equal(get('satisfaction').status, 'unknown');
  assert.equal(get('attendance').status, 'exempt'); assert.equal(get('wanami').status, 'exempt');
});
test('reservation locks persist; repeated manual updates cannot postpone the external refresh timestamp', async () => {
  const previousTime = '2026-11-11T04:00:00Z';
  const old = { items: [item('reservation', 0), item('chat_frequency', 1)], external_evaluated_at: previousTime };
  const f = fixture({ old: [{ student_id: 'S1', payload: old, updated_at: now }] }); await f.service.updateAll(null, now);
  const result = f.writes[0].params[9];
  assert.equal(result.items.find(i => i.key === 'reservation').point, 0);
  assert.equal(result.items.find(i => i.key === 'chat_frequency').point, 1);
  assert.equal(result.external_evaluated_at, previousTime);
});
test('migration preserves an existing current-month reservation lock and does not display old weighted points as new results', async () => {
  const f = fixture({ legacyLocks: [{ student_id: 'S1', reservation_locked: true, reservation_score: 0 }] });
  await f.service.updateAll(null, now);
  assert.equal(f.writes[0].params[9].items.find(i => i.key === 'reservation').point, 0);
  const service = createActionPointService({ query: async () => ({ rows: [{ student_id: 'S1', total_score: 10, rank: 'high', action_points: null }] }) });
  const [row] = await service.getAll('2026-11');
  assert.equal(row.rank, 'unknown'); assert.equal(row.total_score, 0); assert.equal(row.action_points.evaluated, 0);
  assert.equal(row.action_points.items.length, 15);
});
test('a fully fetched empty chat adds only frequency risk; AI failure never adds quality/dependency risk', async () => {
  for (const messages of [[], [{ id: '1', authorId: '123', at: '2026-11-11' }, { id: '2', authorId: '123', at: '2026-11-10' }]]) {
    let calls = 0;
    const f = fixture({ deps: { contacts: async () => [{ studentId: 'S1', discordId: '123', chatUrl: 'synthetic' }],
      conversation: async () => messages, grade: async () => { calls++; throw new Error('SYNTHETIC_PRIVATE'); }
    } });
    await f.service.updateAll(null, now);
    const result = f.writes[0].params[9]; const get = key => result.items.find(i => i.key === key);
    assert.equal(get('chat_frequency').point, messages.length ? 0 : 1);
    assert.equal(get('chat_quality').status, 'unknown'); assert.equal(get('dependency').status, 'unknown');
    assert.equal(calls, messages.length ? 1 : 0);
  }
});
test('a student write failure is private and does not stop subsequent students', async () => {
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const f = fixture({ failStudent: 'S1', students: [student, { ...student, student_id: 'S2' }] });
    assert.deepEqual(await f.service.updateAll(null, now), { updated: 1, errors: 1 });
    assert.equal(f.writes.length, 2); assert.equal(logs.some(s => s.includes('SYNTHETIC_PRIVATE')), false);
  } finally { console.error = original; }
});
test('progress reports processed counts and stages without exposing student identifiers', async () => {
  const stages = [];
  const f = fixture({ deps: { onProgress: value => stages.push(value) } });
  await f.service.updateAll(null, now);
  assert.equal(stages[0].total, 1); assert.equal(stages[0].processed, 0);
  assert.equal(stages.at(-1).processed, 1); assert.equal(stages.at(-1).stage, '完了');
  assert.ok(stages.some(value => value.stage === 'SNS確認'));
  assert.ok(stages.every(value => !Object.hasOwn(value, 'student_id')));
});
test('snapshot only records actual JST final day, never backfills on next month first', async () => {
  const f = fixture();
  assert.equal((await f.service.snapshotTutors(now)).captured, 0);
  await f.service.snapshotTutors(new Date('2026-11-30T14:59:00Z'));
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].params[0], '2026-11');
  await f.service.snapshotTutors(new Date('2026-11-30T15:00:00Z')); assert.equal(f.writes.length, 1);
  await assert.rejects(f.service.updateAll('2026-10', now), /current month/);
});
test('AI evidence must reference actual student messages and cannot reuse one incident twice', () => {
  const messages = [{ id: '1', authorId: 'student', url: 'https://discord.com/channels/1/2/1' }, { id: '2', authorId: 'student', url: 'https://discord.com/channels/1/2/2' }];
  const incident = id => ({ reason: '具体的な根拠', message_ids: [id] });
  const value = { chat_quality: { sufficient: true, incidents: [incident('1'), incident('2')] }, dependency: { sufficient: false, incidents: [] } };
  assert.equal(validateChatEvaluation(value, messages, 'student').chat_quality.point, 1);
  value.chat_quality.incidents[1] = incident('1'); assert.throws(() => validateChatEvaluation(value, messages, 'student'));
  value.chat_quality.incidents[1] = incident('forged'); assert.throws(() => validateChatEvaluation(value, messages, 'student'));
  value.chat_quality.incidents = [incident('1')]; assert.equal(validateChatEvaluation(value, messages, 'student').chat_quality.point, 0);
});
test('action detail UI escapes untrusted AI reasons and rejects non-Discord evidence links', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const context = { escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('function actionPointStyle(')), context);
  const html = context.renderActionPointSummary({ ratio: 0.6, rank: 'high', total: 6, evaluated: 10, items: [{ label: '<img>', criterion: '<script>', reason: '<svg>', evidence: [{ reason: '<iframe>', links: ['javascript:alert(1)', 'https://discord.com/channels/1/2/3'] }] }] });
  assert.ok(html.includes('レッド')); assert.ok(html.includes('60.0%')); assert.ok(!html.includes('<svg>'));
  assert.ok(!html.includes('javascript:')); assert.ok(html.includes('https://discord.com/channels/1/2/3'));
});
