import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { inspect } from 'node:util';
const marker = 'SYNTHETIC_SCHEDULE_PRIVATE';
async function fixture({ fail = false, disabled = false, monthEnd = true } = {}) {
  const schedules = [], calls = [], logs = [];
  const provider = name => async (...args) => { calls.push({ name, args }); if (fail) throw Object.assign(new Error(marker), { code: marker, response: { data: marker } }); return { message: marker, rowCount: 2, privateData: marker }; };
  const names = ['sendDailyReminders','sendDailyStatsReport','checkAndExecuteSchedules','checkStampRallyAchievements','sendLessonReportReminder','sendSurveyReminderNotifications','dailyRedListUpdate','monthlyRedListReset','weeklyTutorSnapshot','monthlyTutorSnapshot','monthlyFunnelSnapshot','sendDailyReportReminder','minutesAutoGenerate','monthlyTutorSatisfactionExport','recoverPendingBroadcastJobs'];
  const deps = Object.fromEntries(names.map(name => [name, provider(name)]));
  deps.internalFetch = async (...args) => { const result = await provider('internalFetch')(...args); return { json: async () => result }; };
  const imports = { './jobs/vqDiagnosisChecker.js': { default: provider('vqDiagnosisChecker') }, './db/connection.js': { query: provider('query') } };
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('// Schedule students & tutors sync'), source.indexOf('const port =')) + source.slice(source.indexOf('// Render再起動'));
  const transformed = block.replace(/await import\('([^']+)'\)/g, (_, path) => `imports[${JSON.stringify(path)}]`);
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [monthEnd ? '2026-10-31T12:00:00Z' : '2026-10-15T12:00:00Z'])); } }
  runInNewContext(transformed, { ...deps, imports, Date: FixtureDate, process: { env: disabled ? { DISCORD_REMINDERS_ENABLED: 'false', DISCORD_STATS_REPORT_ENABLED: 'false', LESSON_REPORT_REMINDER_ENABLED: 'false' } : {} }, console: Object.fromEntries(['log','error'].map(level => [level, (...args) => logs.push(inspect(args))])), cron: { schedule: (expression, callback, options) => schedules.push({ expression, callback, options }) } });
  await new Promise(resolve => setImmediate(resolve));
  return { schedules, calls, logs };
}
test('all scheduled job errors and initial recovery hide provider diagnostics', async () => {
  const f = await fixture({ fail: true });
  for (const job of f.schedules) await job.callback();
  assert.equal(f.schedules.length, 19);
  assert.equal(f.logs.join('\n').includes(marker), false);
  assert.equal(f.calls.some(call => call.name === 'query'), true);
});
test('successful scheduled jobs retain calls and Tokyo schedule configuration without result payload logs', async () => {
  const f = await fixture();
  for (const job of f.schedules) await job.callback();
  assert.equal(f.logs.join('\n').includes(marker), false);
  assert.equal(f.schedules.every(job => job.options.timezone === 'Asia/Tokyo'), true);
  for (const name of ['weeklyTutorSnapshot','monthlyTutorSnapshot','monthlyTutorSatisfactionExport','minutesAutoGenerate','vqDiagnosisChecker','recoverPendingBroadcastJobs']) assert.equal(f.calls.some(call => call.name === name), true, name);
  assert.equal(f.calls.filter(call => call.name === 'internalFetch').length, 3);
  assert.equal(f.calls.filter(call => call.name === 'query').length, 1);
});
test('disabled reminder settings retain registration behavior', async () => {
  const f = await fixture({ disabled: true });
  assert.equal(f.schedules.length, 16);
  for (const job of f.schedules) await job.callback();
  for (const name of ['sendDailyReminders','sendDailyStatsReport','sendLessonReportReminder']) assert.equal(f.calls.some(call => call.name === name), false);
});
test('month-end gates still skip monthly tutor jobs on ordinary days', async () => {
  const f = await fixture({ monthEnd: false });
  for (const job of f.schedules) await job.callback();
  for (const name of ['monthlyTutorSnapshot','monthlyTutorSatisfactionExport']) assert.equal(f.calls.some(call => call.name === name), false);
});
test('Discord reply monitor catch hides error codes and names', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('startDiscordReplyMonitor();'), source.indexOf('const app ='));
  const logs = [], scheduled = []; let starts = 0;
  runInNewContext(block, { startDiscordReplyMonitor: () => starts++, checkDiscordReplyAlerts: async () => { throw Object.assign(new Error(marker), { code: marker, name: marker }); }, cron: { schedule: (expression, callback) => scheduled.push({ expression, callback }) }, console: { error: (...args) => logs.push(inspect(args)) } });
  assert.equal(starts, 1); assert.equal(scheduled[0].expression, '*/5 * * * *');
  scheduled[0].callback(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(logs.length, 1); assert.equal(logs.join('\n').includes(marker), false);
});
