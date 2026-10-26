import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { isFunnelEligibleStudent, normalizeFunnelStudentId } from '../src/services/funnelService.js';

const marker = 'SYNTHETIC_FUNNEL_SERVICE_PRIVATE';
const channelUrl = 'https://discord.com/channels/111/222';
const failure = () => Object.assign(new Error(marker), { config: { token: marker }, response: { data: marker } });
const student = { student_id: marker, status: 'アクティブ', contract_plan: '通常', homeroom_tutor: marker,
  booking_tutor_name: marker, booking_user_id: 1, funnel_regular_booking_url: 'https://fixture.example.test/' + marker };
let sequence = 0;
async function fixture({ queryFail = false, failScan = false, failChannel = false, failPage = false, sheetFail = false,
  active = false, latest = false, missingInfo = false, students = [student] } = {}) {
  const logs = [], queries = [], pages = [], channels = [], queued = [], builds = [], sheets = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (queryFail || (failScan && sql.includes("SET status = 'running'"))) throw failure();
    if (sql.includes("status IN ('pending', 'running')") && sql.includes('SELECT')) return { rows: active ? [{ id: marker }] : [] };
    if (sql.includes('INSERT INTO funnel_discord_scan_jobs')) return { rows: [{ id: params[0] }] };
    if (sql.includes('SELECT * FROM funnel_discord_scan_jobs WHERE id')) return { rows: [{ id: marker }] };
    if (sql.includes("status = 'completed'") && sql.includes('SELECT')) return { rows: latest ? [{ id: marker }] : [] };
    if (sql.includes('FROM students')) return { rows: students };
    if (sql.includes('FROM lesson_reports lr')) return { rows: [{ id: 42, student_id: marker, lesson_date: '2025-01-02', event_at: '2025-01-02T00:00:00Z' }] };
    if (sql.includes('FROM funnel_booking_link_checks')) return { rows: [{ student_id: marker, scan_status: 'success', link_sent: true }] };
    if (sql.includes('FROM funnel_no_show_followups')) return { rows: [{ student_id: marker, scan_status: 'success', student_contacted: true, tutor_reminder_sent: true }] };
    return { rows: [] };
  };
  const messages = [{ id: marker + '-staff-message', createdAt: new Date('2025-01-03T00:00:00Z'), author: { id: 'staff', bot: false }, content: student.funnel_regular_booking_url },
    { id: marker + '-student-message', createdAt: new Date('2025-01-04T00:00:00Z'), author: { id: marker, bot: false }, content: marker }];
  const deps = { query, randomUUID: () => 'fixture-job', isFunnelEligibleStudent, normalizeFunnelStudentId,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    process: { env: { SATISFACTION_SPREADSHEET_ID: marker } }, setImmediate: callback => { queued.push(callback); },
    discordClient: { isReady: () => true, channels: { fetch: async id => {
      channels.push(id); if (failChannel) throw failure();
      return { isTextBased: () => true, messages: { fetch: async params => { pages.push(params); if (failPage) throw failure(); return new Map(messages.map(message => [message.id, message])); } } };
    } } },
    fetchStudentBroadcastInfo: async () => { sheets.push('broadcast'); if (sheetFail) throw failure(); return missingInfo ? [] : [{ studentId: marker, discordId: marker, chatUrl: channelUrl }]; },
    fetchSatisfactionFromCache: async id => { sheets.push(id); if (sheetFail) throw failure(); return [{ student_id: marker }]; },
    buildFunnelData: args => { builds.push(args); return { fixture: marker }; },
  };
  const key = 'funnelServicePrivacyFixture' + sequence++;
  globalThis[key] = deps;
  const apis = [];
  try {
    for (const file of ['funnelDiscordService.js', 'funnelDataService.js']) {
      let source = await readFile(new URL('../src/services/' + file, import.meta.url), 'utf8');
      source = source.replace("import { client as discordClient } from './discordService.js';", 'const { discordClient } = deps;')
        .replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`);
      assert.equal(/\bimport(?:\s|\()/.test(source), false);
      apis.push(await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const { console, process, setImmediate } = deps;\n${source}`).toString('base64')}`));
    }
  } finally { delete globalThis[key]; }
  return { discord: apis[0], data: apis[1], logs, queries, pages, channels, queued, builds, sheets };
}
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);
async function runQueued(f) { await f.discord.startFunnelDiscordScan({ year: 2025, month: 1, createdBy: marker }); assert.equal(f.queued.length, 1); await f.queued.shift()(); }

test('service DB/provider errors become fixed errors with no raw properties or logs', async () => {
  const f = await fixture({ queryFail: true });
  for (const [run, message] of [[() => f.discord.startFunnelDiscordScan({ year: 2025, month: 1 }), 'Discord scan could not be started'],
    [() => f.discord.getFunnelDiscordScanJob(marker), 'Discord scan status could not be loaded'],
    [() => f.data.fetchFunnelDataForMonth(2025, 1), 'Funnel data could not be loaded']]) {
    await assert.rejects(run, error => { assert.equal(error.message, message); assert.equal(error.config, undefined); assert.equal(error.cause, undefined); return true; });
  }
  safe(f);
  for (const options of [{ failChannel: true }, { failPage: true }]) {
    const failed = await fixture(options);
    await assert.rejects(() => failed.discord.fetchChannelMessages(channelUrl, new Date('2025-01-01'), new Date('2025-02-01')),
      { message: 'Discord channel history could not be loaded' }); safe(failed);
  }
});

test('scan success keeps dispatch, classification, SQL progress and booking/no-show business identifiers', async () => {
  const f = await fixture(); await runQueued(f);
  const booking = f.queries.find(call => call.sql.includes('INSERT INTO funnel_booking_link_checks'));
  assert.deepEqual(booking.params.slice(0, 5), ['2025-01', marker, 'funnel_2025-01_fixture-job', true, marker + '-staff-message']);
  assert.deepEqual(booking.params.slice(6), ['success', null]);
  const noShow = f.queries.find(call => call.sql.includes('INSERT INTO funnel_no_show_followups'));
  assert.equal(noShow.params[6], true); assert.equal(noShow.params[9], true); assert.equal(noShow.params[12], 'success'); assert.equal(noShow.params[13], null);
  assert.deepEqual(f.queries.find(call => call.sql.includes('SET processed_count =')).params, ['funnel_2025-01_fixture-job', 1, 0]);
  assert.deepEqual(f.queries.at(-1).params, ['funnel_2025-01_fixture-job', 0]);
  assert.deepEqual(f.channels, ['222']); assert.equal(f.pages[0].limit, 100); assert.equal(typeof f.pages[0].before, 'string'); safe(f);
});

test('student-level failures store fixed diagnostics while retaining error progress and final completion', async () => {
  for (const options of [{ failChannel: true }, { failPage: true }, { missingInfo: true }]) {
    const f = await fixture(options); await runQueued(f);
    const booking = f.queries.find(call => call.sql.includes('INSERT INTO funnel_booking_link_checks'));
    assert.deepEqual(booking.params.slice(6), ['error', 'Discord history scan failed']);
    const noShow = f.queries.find(call => call.sql.includes('INSERT INTO funnel_no_show_followups'));
    assert.deepEqual(noShow.params.slice(12), ['error', 'Discord history scan failed']);
    assert.deepEqual(f.queries.at(-1).params, ['funnel_2025-01_fixture-job', 1]);
    safe(f);
  }
});

test('job failure stores a fixed diagnostic and retains stale-job retry and active-job reuse', async () => {
  const f = await fixture({ failScan: true }); await runQueued(f);
  assert.deepEqual(f.queries.at(-1).params, ['funnel_2025-01_fixture-job', 'Discord scan failed']);
  assert.ok(f.queries[0].sql.includes("INTERVAL '30 minutes'")); safe(f);
  const active = await fixture({ active: true });
  assert.deepEqual(await active.discord.startFunnelDiscordScan({ year: 2025, month: 1 }), { id: marker });
  assert.equal(active.queued.length, 0); assert.equal(active.queries.length, 2); safe(active);
});

test('booking configuration errors omit Tutor names while preserving missing-setting classification', async () => {
  const f = await fixture();
  const unregistered = f.discord.resolveTutorBookingLink({ ...student, booking_user_id: null });
  assert.equal(unregistered.url, ''); assert.equal(unregistered.error.includes(marker), false);
  const missing = f.discord.resolveTutorBookingLink({ ...student, funnel_regular_booking_url: '' });
  assert.equal(missing.url, ''); assert.equal(missing.error.includes(marker), false);
  assert.deepEqual(f.discord.resolveTutorBookingLink(student), { url: student.funnel_regular_booking_url, error: null });
  safe(f);
});

test('funnel aggregation keeps successful source mapping, insight counts and December date bounds', async () => {
  const f = await fixture({ latest: true });
  assert.deepEqual(await f.data.fetchFunnelDataForMonth(2025, 12), { data: { fixture: marker, discordScan: { id: marker } }, warnings: [] });
  const built = f.builds[0]; assert.deepEqual(built.students, [student]); assert.equal(built.year, 2025); assert.equal(built.month, 12);
  assert.deepEqual(built.surveyRecords, [{ student_id: marker }]); assert.equal(built.surveyAvailable, true);
  assert.equal(built.discordInsights.bookingLinkSent, 1); assert.equal(built.discordInsights.contactedLater, 1);
  assert.equal(built.discordInsights.tutorReminderSent, 1); assert.equal(built.discordInsights.errorCount, 0);
  assert.deepEqual(f.queries.find(call => call.sql.includes('reservation_count')).params, ['2025-12-01', '2026-01-01']); safe(f);
});

test('survey source failure preserves empty fallback and warning; invalid month rejects before SQL', async () => {
  const f = await fixture({ sheetFail: true }); const result = await f.data.fetchFunnelDataForMonth(2025, 1);
  assert.equal(result.warnings.length, 1); assert.equal(f.builds[0].surveyAvailable, false); assert.deepEqual(f.builds[0].surveyRecords, []); safe(f);
  const invalid = await fixture(); await assert.rejects(() => invalid.data.fetchFunnelDataForMonth(2025, 13));
  assert.equal(invalid.queries.length, 0); safe(invalid);
});
