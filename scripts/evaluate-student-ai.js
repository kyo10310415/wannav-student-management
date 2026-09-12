import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEvaluationCases, fixturePath, fixtureVersion, schemaVersion } from './lib/studentAiEvaluationFixtures.js';
import { evaluateCases, evaluatorVersion } from './lib/studentAiEvaluationPipeline.js';
import { aggregateEvaluation, hashOutput, MANUAL_RUBRIC_FIELDS } from './lib/studentAiEvaluationScoring.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Offline only: node scripts/evaluate-student-ai.js [--out DIR] [--run-id ID] [--case ID] [--fixtures builtin-v1] [--reviews JSON]';
const invalid = () => { throw new Error('INVALID_OFFLINE_ARGUMENTS'); };
export function parseArguments(args) {
  const options = { out: resolve(repoRoot, 'work/student-ai-evaluation'), caseIds: [] };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' && args.length === 1) return { help: true };
    if (!['--out', '--run-id', '--case', '--fixtures', '--reviews'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--') || (key !== '--case' && seen.has(key))) invalid();
    seen.add(key);
    const value = args[++i];
    if (key === '--out') options.out = resolve(value);
    if (key === '--run-id') {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) invalid();
      options.runId = value;
    }
    if (key === '--case') options.caseIds.push(value);
    if (key === '--fixtures' && value !== 'builtin-v1') invalid();
    if (key === '--reviews') options.reviewsPath = resolve(value);
  }
  if (options.reviewsPath && !options.runId) invalid();
  return options;
}

export function markdownSummary(run) {
  const stats = run.aggregate?.overall;
  const format = value => value === null || value === undefined ? 'NA' : (value * 100).toFixed(2) + '%';
  return [
    '# T050 offline evaluation', '',
    'All source data is synthetic. Scripted/oracle selection measures wiring and preservation, NOT semantic retrieval quality.',
    '', '- mode: offline_mock', '- semanticQuality: not_evaluated', '- liveQuality: pending',
    '- runId: ' + run.runId, '- status: ' + run.status,
    '- technical harness checks: ' + (run.harnessChecks ? run.harnessChecks.expectedOutcomes + '/' + run.harnessChecks.total + ' expected outcomes' : 'pending'),
    '- executed cases: ' + (stats?.completed ?? 0) + '/' + (stats?.cases ?? 0),
    '- HTTP success (all cases denominator): ' + format(stats?.apiSuccessRate?.value),
    '- actual usage: unknown; live cost/latency: not_measured', '',
    '| scripted preservation metric | macro | micro | NA | not evaluated |',
    '|---|---:|---:|---:|---:|',
    ...['requiredRecall', 'sourcePrecision', 'counterevidenceRecall', 'comparisonRecall'].map(name => {
      const metric = stats?.retrieval[name];
      return '| ' + name + ' | ' + format(metric?.macro) + ' | ' + format(metric?.micro?.value) + ' | ' +
        (metric?.notApplicable ?? 0) + ' | ' + (metric?.notEvaluated ?? 0) + ' |';
    }), '',
    'These are not live model scores. Expected safety rejections and controlled losses remain in the denominators.',
    '', '| case | HTTP | required recall | mechanics | manual review |',
    '|---|---:|---:|---|---|',
    ...(run.results ?? []).map(item => '| ' + item.caseId + ' | ' + (item.response?.httpStatus ?? 'NA') + ' | ' +
      format(item.retrieval?.requiredRecall.value) + ' | ' + (item.mechanical?.status ?? 'not_evaluated') +
      ' | ' + (item.semantic?.status ?? 'pending') + ' |'),
    '', 'Review result.json reviewPacket + response + context. Manual ratings bind runId/caseId/outputHash.',
    'Do not submit the blank template as a completed review. Pending is neither zero nor full marks.', ''
  ].join('\n');
}

async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}

export async function runCli(args = process.argv.slice(2), { signal, evaluate = evaluateCases, stdout = console.log, stderr = console.error } = {}) {
  let directory, metadata;
  try {
    const options = parseArguments(args);
    if (options.help) { stdout(usage); return 0; }
    const fixtures = loadEvaluationCases(options.caseIds.length ? options.caseIds : undefined);
    let reviews = [];
    if (options.reviewsPath) {
      const bytes = await readFile(options.reviewsPath);
      if (bytes.byteLength > 512 * 1024) invalid();
      reviews = JSON.parse(bytes.toString('utf8'));
    }
    const runId = options.runId ?? 'offline-' + Date.now() + '-' + randomUUID().slice(0, 8);
    await mkdir(options.out, { recursive: true });
    const nextDirectory = join(options.out, runId);
    await mkdir(nextDirectory); // exclusive: existing runs are never overwritten
    directory = nextDirectory;
    let gitSha = 'unavailable', gitDirty = 'unknown';
    try {
      gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    } catch { /* provenance unavailable outside a Git checkout */ }
    metadata = { runId, mode: 'offline_mock', semanticQuality: 'not_evaluated', liveQuality: 'pending',
      status: 'partial', schemaVersion, fixtureVersion, evaluatorVersion, fixtureHash: hashOutput(fixtures),
      seed: null, gitSha, gitDirty, inputPath: fileURLToPath(fixturePath), outputPath: directory,
      reviewsPath: options.reviewsPath ?? null, nodeVersion: process.version,
      startedAt: new Date().toISOString(), caseIds: fixtures.map(item => item.caseId) };
    await atomicJson(join(directory, 'result.json'), { ...metadata, results: [], lifecycle: 'running' });
    const result = await evaluate(fixtures, {
      runId, signal, reviews, onCase: async (_, results) => {
        const pending = fixtures.slice(results.length).map(item => ({ caseId: item.caseId, category: item.category, status: 'partial' }));
        await atomicJson(join(directory, 'result.json'), { ...metadata, lifecycle: 'running',
          results, aggregate: aggregateEvaluation([...results, ...pending]) });
      }
    });
    const final = { ...metadata, ...result, finishedAt: new Date().toISOString(), lifecycle: 'finished' };
    // An abnormal evaluator return must not masquerade as a successful empty run.
    if (final.results?.length !== fixtures.length || !final.harnessChecks ||
        final.results.some(item => !fixtures.some(fixture => fixture.caseId === item.caseId)) ||
        new Set(final.results.map(item => item.caseId)).size !== fixtures.length) throw new Error('INCOMPLETE_EVALUATION');
    const technicalSuccess = final.status === 'completed' && final.harnessChecks.technicalFailures === 0 &&
      final.harnessChecks.mechanicalFailures === 0 && final.harnessChecks.expectedOutcomes === fixtures.length;
    final.technicalAcceptance = technicalSuccess ? 'passed_offline_checks_only' : 'not_passed';
    await atomicJson(join(directory, 'result.json'), final);
    await writeFile(join(directory, 'summary.md'), markdownSummary(final), { flag: 'wx' });
    const template = final.results.filter(item => item.outputHash).map(item => ({
      runId, caseId: item.caseId, outputHash: item.outputHash, reviewer: '',
      ratings: Object.fromEntries(MANUAL_RUBRIC_FIELDS.map(field => [field, null])), notes: ''
    }));
    await writeFile(join(directory, 'manual-review-template.json'), JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
    stdout('offline_mock: ' + final.status + '; semanticQuality=not_evaluated; ' + directory);
    return technicalSuccess ? 0 : 1;
  } catch {
    if (directory) {
      try {
        const failure = { ...metadata, status: 'failed', lifecycle: 'finished', error: 'OFFLINE_EVALUATION_FAILED',
          semanticQuality: 'not_evaluated', finishedAt: new Date().toISOString() };
        await atomicJson(join(directory, 'failure.json'), failure);
        let checkpoint = {};
        try { checkpoint = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')); } catch { /* no checkpoint yet */ }
        // Keep completed case data, but never leave a completed run marker after a technical failure.
        await atomicJson(join(directory, 'result.json'), { ...checkpoint, ...failure, technicalAcceptance: 'not_passed' });
      } catch { /* no raw IO errors or credentials in logs */ }
    }
    stderr('Offline evaluation failed. Live/custom data modes are unsupported; check arguments, run directory, and review bindings.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
}
