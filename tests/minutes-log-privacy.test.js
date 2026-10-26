import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';
import { buildLessonContentIndex, getLessonContent, resolveLessonReference } from '../src/services/lessonReferenceService.js';
const marker = 'SYNTHETIC_MINUTES_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { config: { url: marker, credentials: marker }, detail: marker });
let sequence = 0;
async function fixture(overrides = {}) {
  const logs = [], queries = [], aiCalls = [], transcriptCalls = [], backfills = [];
  const deps = { Hono, buildLessonContentIndex, getLessonContent, resolveLessonReference,
    query: async (...args) => { queries.push(args); return { rows: [] }; },
    fetchTranscript: async (...args) => { transcriptCalls.push(args); return { transcript: marker, fileId: marker, fileName: marker }; },
    buildMinutesResult: async input => { aiCalls.push(input); return { generatedText: marker, qualityEvaluation: { fixture: true } }; },
    getPreviousMinutesContext: async () => ({ lesson_date: '2026-09-01', generated_text: marker }),
    resolveMinutesTutor: async () => ({ tutorName: marker, tutorEmployeeId: marker }),
    getPreviousMinutesQualityTargets: () => ({ anxietyContent: marker, smallGoal: marker }),
    startMinutesBackfill: input => { backfills.push(input); return { started: true, state: { status: 'running' } }; },
    getMinutesBackfillState: () => ({ status: 'idle' }),
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])), ...overrides };
  const source = (await readFile(new URL('../src/routes/minutes.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'minutesPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  try {
    const prefix = `const { Hono, query, fetchTranscript, buildMinutesResult, getPreviousMinutesContext, resolveMinutesTutor, getPreviousMinutesQualityTargets, buildLessonContentIndex, getLessonContent, resolveLessonReference, getMinutesBackfillState, startMinutesBackfill, console } = globalThis[${JSON.stringify(key)}];\n`;
    const app = (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString('base64')}`)).default;
    return { app, logs, queries, aiCalls, transcriptCalls, backfills };
  } finally { delete globalThis[key]; }
}
const json = (body, method = 'POST', authorized = false) => ({ method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer synthetic-session' } : {}) }, body: JSON.stringify(body) });
const generateBody = { studentId: marker, studentName: marker, lessonDate: '2026-10-01', lessonNumber: 3 };
const safe = f => assert.equal(f.logs.join('\n').includes(marker), false);

test('ten route exception responses conceal upstream errors while business validation remains distinct', async () => {
  const f = await fixture({ query: async sql => { if (sql.includes('FROM sessions')) return { rows: [{ role: 'leader' }] }; throw rawError(); },
    getPreviousMinutesContext: async () => { throw rawError(); }, startMinutesBackfill: () => { throw rawError(); }, fetchTranscript: async () => { throw rawError(); } });
  for (const [path, options] of [['/templates'], ['/templates/1', json({ name: marker }, 'PUT')], ['/all'], ['/list/' + marker],
    ['/previous-context/' + marker + '?beforeDate=2026-10-01'], ['/detail/1'], ['/backfill', json({ startDate: '2026-10-01', endDate: '2026-10-02' }, 'POST', true)],
    ['/generate', json(generateBody)], ['/1', json({ generated_text: marker }, 'PUT')], ['/1', { method: 'DELETE' }]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500, path);
    assert.deepEqual(await response.json(), { success: false, error: 'Minutes operation failed' });
  }
  safe(f);
});

test('template and minutes CRUD retain success data, nullable fields and query parameters', async () => {
  const calls = [], row = { id: 1, generated_text: marker, template_text: marker };
  const f = await fixture({ query: async (...args) => { calls.push(args); return { rows: [row] }; } });
  assert.deepEqual(await (await f.app.request('/templates')).json(), { success: true, data: [row] });
  assert.deepEqual(await (await f.app.request('/templates/1', json({ name: '', template_text: marker }, 'PUT'))).json(), { success: true, data: row });
  assert.deepEqual(calls.at(-1)[1], [null, marker, '1']);
  assert.deepEqual(await (await f.app.request('/detail/1')).json(), { success: true, data: row });
  assert.deepEqual(await (await f.app.request('/1', json({ generated_text: marker }, 'PUT'))).json(), { success: true, data: row });
  assert.deepEqual(calls.at(-1)[1], [marker, '1']);
  assert.deepEqual(await (await f.app.request('/1', { method: 'DELETE' })).json(), { success: true, message: '削除しました' });
  safe(f);
});

test('minutes list pagination, previews and previous context preserve successful response shapes', async () => {
  const row = { id: 1, student_id: marker, preview: marker }, calls = [];
  const f = await fixture({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: sql.includes('COUNT(*)') ? [{ total: '1' }] : [row] }; } });
  assert.deepEqual(await (await f.app.request('/all?limit=3&offset=2')).json(), { success: true, data: [row], total: 1 });
  assert.deepEqual(calls[0].params, [3, 2]);
  assert.deepEqual(await (await f.app.request('/list/' + marker)).json(), { success: true, data: [row] }); assert.deepEqual(calls.at(-1).params, [marker]);
  assert.deepEqual(await (await f.app.request('/previous-context/' + marker + '?beforeDate=2026-10-01')).json(), { success: true, data: {
    hasPreviousMinutes: true, previousLessonDate: '2026-09-01', anxietyContent: marker, smallGoal: marker } }); safe(f);
});

test('generation preserves transcript, templates, previous context, AI arguments and upsert result', async () => {
  for (const warning of [false, true]) {
    const calls = [], aiCalls = [], previous = { generated_text: marker }, row = { id: 1, generated_text: marker };
    const f = await fixture({ getPreviousMinutesContext: async () => previous,
      query: async (sql, params) => { calls.push({ sql, params }); return { rows: sql.includes('FROM lesson_contents') ? [
        { lesson_number: 3, title: 'today', content: marker }, { lesson_number: 4, title: 'next', content: marker }
      ] : sql.includes('FROM minutes_templates') ? [{ template_text: marker }] : [row] }; },
      buildMinutesResult: async input => { aiCalls.push(input); return { generatedText: marker, qualityEvaluation: { fixture: true }, qualityEvaluationError: warning ? rawError() : null }; } });
    const response = await f.app.request('/generate', json({ ...generateBody, templateId: 2 }));
    assert.deepEqual(await response.json(), { success: true, data: row, ...(warning ? { warning: '議事録は保存しましたが、品質評価は次回の自動処理で再試行します。' } : {}) });
    assert.deepEqual(f.transcriptCalls, [[marker, '2026-10-01']]);
    assert.equal(aiCalls[0].templateText, marker); assert.equal(aiCalls[0].transcript, marker); assert.equal(aiCalls[0].previousMinutesContext, previous);
    assert.equal(aiCalls[0].todayContent, 'today\n' + marker); assert.equal(aiCalls[0].nextContent, 'next\n' + marker);
    assert.deepEqual(calls.at(-1).params, [marker, marker, '2026-10-01', '3', marker, marker, marker, marker, 2, marker, marker, '{"fixture":true}']); safe(f);
  }
});

test('lookup failures, missing transcript, invalid dates and missing records retain business statuses', async () => {
  const lookup = await fixture({ query: async () => { throw rawError(); } });
  const unresolved = await lookup.app.request('/generate', json({ studentId: marker, lessonDate: '2026-10-01' }));
  assert.equal(unresolved.status, 409); assert.equal(lookup.transcriptCalls.length, 0); safe(lookup);
  const empty = await fixture({ fetchTranscript: async () => null });
  assert.equal((await empty.app.request('/generate', json(generateBody))).status, 404);
  assert.equal((await empty.app.request('/generate', json({}))).status, 400);
  assert.equal((await empty.app.request('/previous-context/fixture?beforeDate=2026-02-30')).status, 400);
  for (const [path, options] of [['/detail/1'], ['/templates/1', json({}, 'PUT')], ['/1', json({}, 'PUT')]]) assert.equal((await empty.app.request(path, options)).status, 404);
});

test('backfill manager authentication, allowed roles, date validation, busy and started states remain enforced', async () => {
  for (const role of ['crew', 'leader', 'admin']) {
    const f = await fixture({ query: async () => ({ rows: [{ role }] }) });
    assert.equal((await f.app.request('/backfill', json({}))).status, 401);
    const response = await f.app.request('/backfill', json({ startDate: '2026-10-01', endDate: '2026-10-02' }, 'POST', true));
    assert.equal(response.status, role === 'crew' ? 403 : 202);
    assert.equal(f.backfills.length, role === 'crew' ? 0 : 1);
    assert.equal((await f.app.request('/backfill/status', { headers: { Authorization: 'Bearer fixture' } })).status, role === 'crew' ? 403 : 200);
  }
  const f = await fixture({ query: async () => ({ rows: [{ role: 'leader' }] }), startMinutesBackfill: () => ({ started: false, reason: 'backfill_running', state: { fixture: true } }) });
  for (const body of [{ startDate: 'bad', endDate: 'bad' }, { startDate: '2026-10-02', endDate: '2026-10-01' }, { startDate: '2024-01-01', endDate: '2026-10-01' }]) assert.equal((await f.app.request('/backfill', json(body, 'POST', true))).status, 400);
  const busy = await f.app.request('/backfill', json({ startDate: '2026-10-01', endDate: '2026-10-02' }, 'POST', true));
  assert.equal(busy.status, 409); assert.equal((await busy.json()).error, 'バックフィルがすでに実行中です'); safe(f);
});

test('generation dependency failures remain fixed after transcript and AI stages', async () => {
  for (const fail of ['ai', 'context', 'tutor', 'upsert']) {
    const f = await fixture({
      query: async sql => { if (fail === 'upsert' && sql.includes('INSERT INTO minutes')) throw rawError(); return { rows: [] }; },
      buildMinutesResult: async () => { if (fail === 'ai') throw rawError(); return { generatedText: marker }; },
      getPreviousMinutesContext: async () => { if (fail === 'context') throw rawError(); return null; },
      resolveMinutesTutor: async () => { if (fail === 'tutor') throw rawError(); return { tutorName: marker, tutorEmployeeId: marker }; }
    });
    const response = await f.app.request('/generate', json(generateBody)); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Minutes operation failed' }); safe(f);
  }
});

test('manager session lookup failure is fixed before either backfill endpoint reaches a job', async () => {
  const f = await fixture({ query: async () => { throw rawError(); }, getMinutesBackfillState: () => { throw new Error('Unexpected backfill status access'); } });
  for (const [path, options] of [['/backfill', json({ startDate: '2026-10-01', endDate: '2026-10-02' }, 'POST', true)],
    ['/backfill/status', { headers: { Authorization: 'Bearer fixture' } }]]) {
    const response = await f.app.request(path, options); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Minutes operation failed' });
  }
  assert.equal(f.backfills.length, 0); safe(f);
});
