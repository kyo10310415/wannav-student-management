import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { buildTranscriptPromptText, getPreviousMinutesQualityTargets } from '../src/services/minutesQualityService.js';
import { formatLessonLabel } from '../src/services/lessonReferenceService.js';
const marker = 'SYNTHETIC_MINUTES_DRIVE_PRIVATE';
const rawError = () => Object.assign(new Error(marker), { response: { status: 500, data: marker }, config: { url: marker, credentials: marker } });
let sequence = 0;
async function load(file, deps, names) {
  const source = (await readFile(new URL('../src/services/' + file, import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'minutesDrivePrivacyFixture' + sequence++; globalThis[key] = deps;
  try { return await import(`data:text/javascript;base64,${Buffer.from(`const { ${names.join(', ')} } = globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`); }
  finally { delete globalThis[key]; }
}
async function minutesFixture({ create, configured = true, constructorFail = false } = {}) {
  const logs = [], calls = [], validations = [];
  const deps = { process: { env: configured ? { OPENAI_API_KEY: marker } : {} },
    OpenAI: class { constructor() { if (constructorFail) throw rawError(); this.chat = { completions: { create: async input => {
      calls.push(input); return create ? create(input) : { choices: [{ message: { content: JSON.stringify(input.max_tokens === 3600 ? { summary: marker, notes: marker } : { syntheticQuality: true }) } }] };
    } } }; } }, buildTranscriptPromptText, getPreviousMinutesQualityTargets, formatLessonLabel,
    validateMinutesQualityEvaluation: (...args) => { validations.push(args); return { verified: true }; },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  return { module: await load('minutesService.js', deps, Object.keys(deps)), logs, calls, validations };
}
const minutesParams = { templateText: '{{student_name}}|{{student_id}}|{{lesson_date}}|{{summary}}|{{notes}}', studentName: marker,
  studentId: marker, lessonDate: '2026-10-26', lessonNumber: 3, todayContent: marker, nextContent: marker, transcript: marker };
const safe = value => assert.equal(inspect(value).includes(marker), false);

async function driveFixture({ fail, tabs, body, noFolder = false, noFiles = false, credentials = '{}', constructorFail = false } = {}) {
  const logs = [], lists = [], gets = [];
  const docs = { documents: { get: async input => {
    gets.push(input); if (fail === 'docs' || (fail === 'first-doc' && gets.length === 1)) throw rawError();
    return { data: { tabs, body } };
  } } };
  const drive = { files: { list: async input => {
    lists.push(input); if (fail === 'folders' || (fail === 'files' && lists.length > 1)) throw rawError();
    return { data: { files: lists.length === 1 ? (noFolder ? [] : [{ id: marker, name: marker }]) : (noFiles ? [] : [{ id: marker, name: marker + ' 2026/10/26 Gemini' }]) } };
  } } };
  const deps = { google: { auth: { GoogleAuth: class { constructor() { if (constructorFail) throw rawError(); } } }, drive: () => drive, docs: () => docs },
    process: { env: { GOOGLE_CREDENTIALS_JSON: credentials } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])) };
  return { module: await load('driveService.js', deps, Object.keys(deps)), logs, lists, gets, drive, docs };
}
const bodyWith = text => ({ content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] });

test('AI success preserves prompt settings, parsing, templates and independent quality result', async () => {
  const f = await minutesFixture(); const result = await f.module.buildMinutesResult(minutesParams);
  assert.equal(result.generatedText, `${marker}様|${marker}|2026-10-26|${marker}|${marker}`);
  assert.deepEqual(result.qualityEvaluation, { verified: true }); assert.equal(result.qualityEvaluationError, null);
  assert.equal(f.calls.length, 2);
  const content = f.calls.find(c => c.max_tokens === 3600); assert.equal(content.temperature, 0.3);
  assert.equal(content.model, 'gpt-4o-mini'); assert.deepEqual(content.response_format, { type: 'json_object' });
  assert.equal(content.messages[1].content.includes(marker), true);
  assert.equal(f.calls.find(c => c.max_tokens === 1800).temperature, 0);
  assert.equal(f.validations[0][1], marker); safe(f.logs);
});

test('OpenAI failures and malformed generated JSON become fixed errors without provider data', async () => {
  for (const create of [async () => { throw rawError(); }, async () => ({ choices: [{ message: { content: '{' + marker } }] })]) {
    const f = await minutesFixture({ create });
    await assert.rejects(() => f.module.generateMinutesContent(marker, marker, marker, marker), error => { assert.equal(error.message, 'AI議事録生成に失敗しました'); safe(error); return true; });
    await assert.rejects(() => f.module.evaluateLessonQuality(marker), error => { assert.equal(error.message, 'AIレッスン品質評価に失敗しました'); safe(error); return true; }); safe(f.logs);
  }
});

test('quality-only failure retains generated minutes and fixed retry reason', async () => {
  const f = await minutesFixture({ create: async input => {
    if (input.max_tokens === 1800) throw rawError();
    return { choices: [{ message: { content: JSON.stringify({ summary: marker }) } }] };
  } });
  const result = await f.module.buildMinutesResult(minutesParams);
  assert.equal(result.generatedText.includes(marker), true); assert.equal(result.qualityEvaluation, null);
  assert.equal(result.qualityEvaluationError, 'AIレッスン品質評価に失敗しました'); safe(f.logs);
  const resolved = f.module.resolveMinutesGenerationResults({ status: 'fulfilled', value: {} }, { status: 'rejected', reason: rawError() });
  assert.equal(resolved.qualityEvaluationError, 'AIレッスン品質評価に失敗しました');
  assert.throws(() => f.module.resolveMinutesGenerationResults({ status: 'rejected', reason: rawError() }, { status: 'fulfilled', value: {} }), error => { safe(error); return error.message === 'AI議事録生成に失敗しました'; });
});

test('missing API configuration preserves validation and client initialization failures stay private', async () => {
  const missing = await minutesFixture({ configured: false });
  await assert.rejects(() => missing.module.buildMinutesResult(minutesParams), { message: 'OPENAI_API_KEY not configured' });
  const broken = await minutesFixture({ constructorFail: true });
  await assert.rejects(() => broken.module.generateMinutesContent(marker), error => { safe(error); return error.message === 'AIクライアントを初期化できません'; });
});

test('Drive success preserves folder search, date selection, preferred nested tab and returned file metadata', async () => {
  const f = await driveFixture({ tabs: [{ tabProperties: { title: marker }, childTabs: [{ tabProperties: { title: '文字起こし ' + marker }, documentTab: { body: bodyWith(marker) } }] }] });
  const result = await f.module.fetchTranscript(marker, '2026-10-26', 'synthetic-parent');
  assert.equal(result.transcript, marker); assert.equal(result.fileId, marker); assert.equal(result.fileName, marker + ' 2026/10/26 Gemini');
  assert.equal(f.lists[0].q, `'synthetic-parent' in parents and mimeType = 'application/vnd.google-apps.folder' and name contains '${marker}' and trashed = false`);
  assert.equal(f.lists[0].pageSize, 100); assert.equal(f.lists[1].pageSize, 200);
  assert.deepEqual(f.gets, [{ documentId: marker, includeTabsContent: true }]); safe(f.logs);
});

test('Drive tab and legacy Docs fallback preserve transcript content without logging titles', async () => {
  for (const options of [{ tabs: [{ tabProperties: { title: marker }, documentTab: { body: bodyWith(marker) } }] },
    { body: bodyWith(marker) }, { fail: 'first-doc', body: bodyWith(marker) }]) {
    const f = await driveFixture(options);
    assert.equal((await f.module.fetchTranscript(marker, '2026-10-26', 'parent')).transcript, marker);
    if (options.fail) assert.deepEqual(f.gets, [{ documentId: marker, includeTabsContent: true }, { documentId: marker }]);
    safe(f.logs);
  }
});

test('Drive upstream failures conceal raw exceptions and credential parse fragments', async () => {
  for (const fail of ['folders', 'files', 'docs']) {
    const f = await driveFixture({ fail });
    await assert.rejects(() => f.module.fetchTranscript(marker, '2026-10-26', 'parent'), error => { safe(error); return error.message === 'Google Drive transcript lookup failed'; }); safe(f.logs);
  }
  for (const credentials of ['{"private_key":"' + marker + '" invalid}', Buffer.from('{"private_key":"' + marker + '" invalid}').toString('base64')]) {
    const f = await driveFixture({ credentials });
    await assert.rejects(() => f.module.fetchTranscript(marker, '2026-10-26', 'parent'), error => { safe(error); return error.message === 'Failed to parse GOOGLE_CREDENTIALS_JSON'; });
  }
  const broken = await driveFixture({ constructorFail: true });
  await assert.rejects(() => broken.module.fetchTranscript(marker, '2026-10-26'), error => { safe(error); return error.message === 'Google authentication initialization failed'; });
});

test('Drive missing data retains null and review transcript keeps safe permission status', async () => {
  for (const options of [{ noFolder: true }, { noFiles: true }]) {
    const f = await driveFixture(options); assert.equal(await f.module.fetchTranscript(marker, '2026-10-26', 'parent'), null); safe(f.logs);
  }
  const f = await driveFixture();
  await assert.rejects(() => f.module.fetchReviewTranscript(marker, { documents: { get: async () => { throw Object.assign(rawError(), { response: { status: 403 } }); } } }), error => {
    safe(error); return error.safe === true && error.status === 502 && error.message === 'Googleドキュメントの共有権限・IDを確認してください';
  });
});
