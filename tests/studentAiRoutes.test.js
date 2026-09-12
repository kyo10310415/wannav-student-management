import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createStudentAiRoutes } from '../src/routes/studentAi.js';
import { createStudentAiQuery, readStudentAiConfig, callStudentAi } from '../src/services/studentAiRuntime.js';
import { createStudentAiContextService } from '../src/services/studentAiContextService.js';
import { createStudentAiSelector } from '../src/services/studentAiSelectionService.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const empty = studentId => ({ studentId, status: 'insufficient_evidence', evidence: [],
  coverage: { scope: 'stored_minutes_only', driveBackfillComplete: false }, selectionCalls: 0, usage: [] });
const answer = { status: 'answered', answer: '課題Aの記録です。',
  evidence: [{ statement: '課題A', evidenceId: 'excerpt:1:0', quote: '課題A' }],
  changes: [], recommendedActions: [], confidence: 'medium' };
function setup(options = {}) {
  const queries = [], aiCalls = [];
  const records = [{ id: 1, student_id: 'OLD-正式ID', lesson_date: '2026-09-12',
    summary: '課題A', quality: '', summary_length: 3, quality_length: 0, version: 'v1',
    transcript: '課題Aの原文', transcript_length: 6, drive_file_id: 'synthetic-file_A' },
  { id: 2, student_id: 'student-B', lesson_date: '2026-09-11', summary: 'CANARY_B',
    transcript: 'CANARY_B', version: 'v1' }];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM sessions')) {
      assert.match(sql, /s.expires_at > NOW\(\)/);
      if (options.authError) throw new Error('FAKE_SECRET_AUTH');
      if (params[0] === 'expired') return { rows: [] };
      return { rows: [{ user_id: params[0], email: 'synthetic@example.invalid', role: options.role ?? 'crew' }] };
    }
    if (options.dbError) throw new Error(options.dbError);
    assert.match(sql, /student_id = \$1/);
    const scoped = records.filter(row => row.student_id === params[0]);
    if (sql.includes('FROM students')) return { rows: scoped.length ? [{ student_id: params[0] }] : [] };
    if (options.noMinutes) return { rows: [] };
    if (sql.includes('ANY(')) return { rows: scoped.filter(row => params[1].includes(String(row.id))) };
    return { rows: scoped };
  };
  const client = { chat: { completions: { create: async (body, opts) => {
    aiCalls.push({ body, opts });
    if (options.provider) return options.provider(body, opts);
    const data = JSON.parse(body.messages[1].content);
    const value = data.untrustedRecords ? { ids: data.untrustedRecords.slice(0, data.maxSelected).map(item => item.id) } : answer;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  } } } };
  const app = new Hono();
  app.route('/api/student-ai', createStudentAiRoutes({ query, client,
    env: { STUDENT_AI_ENABLED: 'true' }, clock: () => new Date('2026-09-11T15:01:00Z'), ...options.route }));
  const request = (body = { question: '現在の課題' }, { token = 'valid', studentId = 'OLD-正式ID', headers = {}, ...rest } = {}) =>
    app.request('/api/student-ai/' + encodeURIComponent(studentId) + '/questions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body), ...rest });
  return { app, request, queries, aiCalls };
}
for (const role of ['admin', 'leader', 'crew']) test('authenticated ' + role + ' can answer for a legacy formal ID; JST includes today', async () => {
  const s = setup({ role }); const res = await s.request(); assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const result = (await res.json()).data;
  assert.equal(result.evidence[0].lessonDate, '2026-09-12');
  assert.equal(result.evidence[0].version, 'v1');
  assert.equal(result.sources[0].driveUrl, 'https://drive.google.com/file/d/synthetic-file_A/view');
  assert.equal(s.aiCalls.length, 2);
  assert.ok(!JSON.stringify(s.aiCalls).includes('CANARY_B'));
  assert.ok(!JSON.stringify(result).includes('CANARY_B'));
  assert.equal(result.usage.total.total_tokens, 30);
});
for (const token of [null, 'expired']) test('401 before body parsing, context or AI: ' + token, async () => {
  const s = setup(); const res = await s.request('{', { token });
  assert.equal(res.status, 401); assert.equal(s.aiCalls.length, 0);
  assert.equal(s.queries.filter(q => !q.sql.includes('FROM sessions')).length, 0);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
test('unknown role returns 403 before parsing or context', async () => {
  const s = setup({ role: 'viewer' }); assert.equal((await s.request('{')).status, 403);
  assert.equal(s.queries.length, 1); assert.equal(s.aiCalls.length, 0);
});
for (const flag of [undefined, 'false', 'TRUE']) test('feature flag defaults off after authentication: ' + flag, async () => {
  const s = setup({ route: { env: { STUDENT_AI_ENABLED: flag } } });
  assert.equal((await s.request()).status, 503); assert.equal(s.queries.length, 1); assert.equal(s.aiCalls.length, 0);
  assert.equal((await s.request({}, { token: null })).status, 401);
});
test('missing AI config is lazy, import/factory remains safe; request returns 503', async () => {
  const s = setup({ route: { client: undefined, env: { STUDENT_AI_ENABLED: 'true' } } });
  assert.equal((await s.request()).status, 503);
  assert.equal(s.queries.length, 1);
});
const invalidBodies = [
  '{', 'null', '[]', '{}', { question: '' }, { question: ' \n ' }, { question: null },
  { question: {} }, { question: [] }, { question: 123 }, { question: '😀'.repeat(2001) },
  ...['studentId', 'context', 'evidence', 'messages', 'model', 'now'].map(key => ({ question: '課題', [key]: 'forged' })),
  ...['2026-02-30', '2026-13-01', '2026-2-01', '2026-02-01T00:00:00Z', '', null, 123].map(compareAt => ({ question: '課題', compareAt }))
];
for (const [i, body] of invalidBodies.entries()) test('invalid request returns 400 before student lookup: ' + i, async () => {
  const s = setup(); assert.equal((await s.request(body)).status, 400);
  assert.equal(s.queries.length, 1); assert.equal(s.aiCalls.length, 0);
});
test('strict compareAt accepts leap day; ambiguous comparison is safe 400', async () => {
  const s = setup();
  assert.equal((await s.request({ question: '比較', compareAt: '2024-02-29' })).status, 200);
  const res = await s.request({ question: '以前と比較' });
  assert.equal(res.status, 400); assert.match((await res.json()).error, /compareAt/);
});
test('question exactly 2000 Unicode code points passes and now is the server JST date', async () => {
  let input;
  const s = setup({ route: {
    buildContext: async request => { input = request; return empty(request.studentId); },
    answerQuestion: async () => ({ status: 'insufficient_evidence' })
  } });
  assert.equal((await s.request({ question: '😀'.repeat(2000) })).status, 200);
  assert.equal(input.now, '2026-09-12');
});
test('JST date changes exactly at UTC 15:00', async () => {
  for (const [instant, expected] of [['2026-09-11T14:59:59Z', '2026-09-11'], ['2026-09-11T15:00:00Z', '2026-09-12']]) {
    let today;
    const s = setup({ route: { clock: () => new Date(instant),
      buildContext: async input => { today = input.now; return empty(input.studentId); },
      answerQuestion: async () => ({}) } });
    assert.equal((await s.request()).status, 200); assert.equal(today, expected);
  }
});
test('missing student is 404 without AI', async () => {
  const s = setup(); assert.equal((await s.request(undefined, { studentId: 'unknown' })).status, 404);
  assert.equal(s.aiCalls.length, 0);
});
test('existing student with no stored records returns insufficient evidence without any AI calls', async () => {
  const s = setup({ noMinutes: true }); const res = await s.request();
  assert.equal(res.status, 200);
  const result = (await res.json()).data;
  assert.equal(result.status, 'insufficient_evidence'); assert.equal(result.confidence, 'low');
  assert.deepEqual(result.evidence, []); assert.deepEqual(result.sources, []);
  assert.equal(result.coverage.scope, 'stored_minutes_only'); assert.equal(result.coverage.driveBackfillComplete, false);
  assert.deepEqual(result.usage.selection.calls, []); assert.deepEqual(result.usage.answer.calls, []);
  assert.equal(s.aiCalls.length, 0);
});
test('invalid student ID and wrong media type fail before context', async () => {
  const s = setup();
  assert.equal((await s.request(undefined, { studentId: 'x'.repeat(129) })).status, 400);
  assert.equal((await s.request(undefined, { studentId: 'bad\nID' })).status, 400);
  assert.equal((await s.request(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal(s.aiCalls.length, 0);
});
for (const header of [undefined, '1', '40000']) test('body byte limit covers absent/forged Content-Length: ' + header, async () => {
  const s = setup();
  const headers = header ? { 'Content-Length': header } : {};
  const res = await s.request(' '.repeat(32769), { headers });
  assert.equal(res.status, 413); assert.equal(s.queries.length, 1);
});
test('streamed body is bounded by actual UTF-8 bytes and is cancelled on overflow', async () => {
  const s = setup(); let cancelled = false, reads = 0;
  const stream = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new TextEncoder().encode('あ'.repeat(6000))); },
    cancel() { cancelled = true; }
  });
  const res = await s.request('', { body: stream, duplex: 'half' });
  assert.equal(res.status, 413); assert.ok(cancelled); assert.ok(reads <= 3);
});
test('exactly 32 KiB JSON body is accepted', async () => {
  const s = setup(); const json = '{"question":"現在の課題"}';
  const body = json + ' '.repeat(32768 - Buffer.byteLength(json));
  assert.equal((await s.request(body)).status, 200);
});
for (const [code, status] of [
  ['SOURCE_CHANGED', 409], ['SOURCE_LIMIT_EXCEEDED', 422], ['SOURCE_TOO_LARGE', 422],
  ['SELECTION_INPUT_LIMIT', 422], ['SELECTION_CALL_LIMIT', 422], ['ANSWER_INPUT_LIMIT', 422],
  ['INVALID_SELECTION', 502], ['INVALID_ANSWER', 502], ['SELECTION_INCOMPLETE', 502],
  ['SELECTION_UNAVAILABLE', 503], ['AI_UNAVAILABLE', 503], ['STUDENT_SCOPE_VIOLATION', 500],
  ['FAKE_SECRET_DB', 500]
]) test('safe route error mapping: ' + code, async () => {
  const s = setup({ route: { buildContext: async () => { throw new Error(code); }, answerQuestion: async () => ({}) } });
  const res = await s.request(); assert.equal(res.status, status);
  assert.ok(!(await res.text()).includes(code)); assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
test('mismatched context student refuses before answer provider', async () => {
  let calls = 0;
  const s = setup({ route: { buildContext: async () => empty('student-B'), answerQuestion: async () => { calls++; } } });
  assert.equal((await s.request()).status, 500); assert.equal(calls, 0);
});
test('per-user and process concurrency; pending DB retains slot after 504 and cannot start answer', async () => {
  const pending = deferred(), started = deferred(); let calls = 0, observedSignal;
  const s = setup({ route: { deadlineMs: 80, buildContext: async input => {
    observedSignal = input.signal; started.resolve(); await pending.promise; return empty(input.studentId);
  }, answerQuestion: async () => { calls++; return {}; } } });
  const first = s.request(); await started.promise;
  assert.equal((await s.request()).status, 429);
  const second = s.request(undefined, { token: 'second' }); await delay(5);
  assert.equal((await s.request(undefined, { token: 'third' })).status, 429);
  assert.equal((await first).status, 504); assert.equal((await second).status, 504);
  assert.ok(observedSignal.aborted);
  assert.equal((await s.request()).status, 429);
  pending.resolve(); await delay(5);
  assert.equal(calls, 0);
  assert.equal((await s.request()).status, 200);
});
test('exception releases concurrency slot', async () => {
  let first = true;
  const s = setup({ route: { buildContext: async input => {
    if (first) { first = false; throw new Error('FAKE_SECRET'); } return empty(input.studentId);
  }, answerQuestion: async () => ({}) } });
  assert.equal((await s.request()).status, 500);
  assert.equal((await s.request()).status, 200);
});
test('late non-cooperative provider retains route slot after timeout and never starts a second stage', async () => {
  const gate = deferred(), started = deferred(); let signal;
  const s = setup({ route: { deadlineMs: 30 }, provider: async (body, options) => {
    signal = options.signal; started.resolve(); await gate.promise;
    const value = JSON.parse(body.messages[1].content).untrustedRecords ? { ids: ['excerpt:1:0'] } : answer;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] };
  } });
  const pending = s.request(); await started.promise;
  assert.equal((await pending).status, 504); assert.ok(signal.aborted);
  assert.equal((await s.request()).status, 429);
  gate.resolve(); await delay(5);
  assert.equal(s.aiCalls.length, 1);
  assert.equal((await s.request()).status, 200); // cancellation has settled and slot is free
});
test('overall deadline reaches in-flight selection and prevents later answer calls', async () => {
  let signal, calls = 0;
  const s = setup({ route: { deadlineMs: 25 }, provider: async (_, opts) => {
    calls++; signal = opts.signal;
    await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('FAKE_SECRET_ABORT')), { once: true }));
  } });
  assert.equal((await s.request()).status, 504); assert.ok(signal.aborted);
  await delay(5); assert.equal(calls, 1);
  assert.equal((await s.request()).status, 504); // released after cancellation settles
});
test('per-provider timeout aborts answer call as well as selection calls', async () => {
  let signal;
  const s = setup({ route: { deadlineMs: 200, providerTimeoutMs: 20,
    buildContext: async input => ({ ...empty(input.studentId), status: 'ready', evidence: [{
      id: 'excerpt:1:0', sourceId: '1', lessonDate: null, version: 'v1', field: 'generated_text',
      sourceKind: 'summary', text: '課題A', start: 0, end: 3, driveFileId: null }] }) },
  provider: async (_, opts) => {
    signal = opts.signal;
    await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  assert.equal((await s.request()).status, 504);
  assert.ok(signal.aborted); assert.equal(s.aiCalls.length, 1);
});
test('client disconnect propagates cancellation', async () => {
  const started = deferred(); let signal;
  const s = setup({ route: { deadlineMs: 500 }, provider: async (_, opts) => {
    signal = opts.signal; started.resolve();
    await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
  } });
  const controller = new AbortController();
  const pending = s.request(undefined, { signal: controller.signal });
  await started.promise; controller.abort();
  assert.equal((await pending).status, 504); assert.ok(signal.aborted);
});
test('T030 stops after a pending DB query on abort and does not start another query/AI', async () => {
  const gate = deferred(); const controller = new AbortController(); let queries = 0, selections = 0;
  const build = createStudentAiContextService({ query: async () => { queries++; await gate.promise; return { rows: [{ student_id: 'A' }] }; },
    select: async () => { selections++; return { ids: [] }; } });
  const pending = build({ studentId: 'A', question: '成長', signal: controller.signal });
  controller.abort(); gate.resolve();
  await assert.rejects(pending, /AI_DEADLINE/); assert.equal(queries, 1); assert.equal(selections, 0);
});
test('T030 abort after selection prevents subsequent batches and detail queries', async () => {
  const controller = new AbortController(); let calls = 0, queries = 0;
  const build = createStudentAiContextService({ query: async sql => {
    queries++;
    return { rows: sql.includes('FROM students') ? [{ student_id: 'A' }] :
      Array.from({ length: 8 }, (_, i) => ({ id: i + 1, student_id: 'A', lesson_date: '2026-01-01',
        version: 'v1', summary: '要約'.repeat(7000), quality: '', summary_length: 14000, quality_length: 0 })) };
  }, select: async args => { calls++; controller.abort(); return { ids: args.items.slice(0, 1).map(item => item.id) }; } });
  await assert.rejects(build({ studentId: 'A', question: '成長', signal: controller.signal }), /AI_DEADLINE/);
  assert.equal(calls, 1); assert.equal(queries, 2);
});
test('pre-aborted selector never reaches provider; input budget includes output reserve', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls++; } } } };
  const signal = AbortSignal.abort();
  const args = { rules: 'rules', question: 'Q', phase: 'summaries', limit: 1, items: [{ id: '1' }] };
  await assert.rejects(createStudentAiSelector({ client, model: 'mock' })({ ...args, signal }), /AI_DEADLINE/);
  await assert.rejects(createStudentAiSelector({ client, model: 'mock', countTokens: () => 1, maxInputTokens: 2224 })(args), /SELECTION_INPUT_LIMIT/);
  assert.equal(calls, 0);
});
test('sensitive DB/provider errors are absent from responses and logs', async t => {
  const logs = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  for (const options of [{ authError: true }, { dbError: 'FAKE_SECRET_DB' },
    { provider: async () => { throw new Error('FAKE_SECRET_PROVIDER'); } }]) {
    const s = setup(options); const res = await s.request();
    assert.ok(res.status >= 500); assert.ok(!(await res.text()).includes('FAKE_SECRET'));
  }
  let idleError;
  const query = createStudentAiQuery({ env: {}, poolFactory: options => {
    assert.equal(options.options, '-c default_transaction_read_only=on');
    return { on: (_, callback) => { idleError = callback; }, query: async () => { throw new Error('FAKE_SECRET_POOL'); } };
  } });
  await assert.rejects(query('SELECT 1', []), error => error.message === 'AI_DATABASE_ERROR');
  idleError(new Error('FAKE_SECRET_IDLE'));
  assert.deepEqual(logs, []);
});
test('configuration rejects unsupported models and invalid resource limits', () => {
  assert.throws(() => readStudentAiConfig({}), /AI_CONFIG/);
  assert.throws(() => readStudentAiConfig({ OPENAI_API_KEY: 'synthetic', STUDENT_AI_ANSWER_MODEL: 'unknown' }), /AI_CONFIG/);
  assert.equal(readStudentAiConfig({ OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'ignored' }).answerModel, 'gpt-4.1-mini-2025-04-14');
  for (const options of [{ deadlineMs: 0 }, { deadlineMs: 120001 }, { maxConcurrent: 3 },
    { maxPerUser: 2 }, { providerTimeoutMs: -1 }, { maxInputTokens: NaN }, { maxOutputTokens: 2001 }]) {
    assert.throws(() => createStudentAiRoutes(options), /AI_CONFIG/);
  }
});
test('provider which ignores AbortSignal is still rejected on late settlement', async () => {
  let aborted = false;
  const client = { chat: { completions: { create: async (_, options) => {
    await delay(20); aborted = options.signal.aborted; return {};
  } } } };
  await assert.rejects(callStudentAi(client, {}, { timeoutMs: 5 }), /AI_DEADLINE/);
  assert.ok(aborted);
});
