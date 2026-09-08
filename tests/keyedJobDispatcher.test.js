import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyedJobDispatcher } from '../src/utils/keyedJobDispatcher.js';

test('runs different jobs independently', async () => {
  const started = [];
  let releaseJobs;
  const blocked = new Promise(resolve => { releaseJobs = resolve; });
  const dispatcher = createKeyedJobDispatcher(async jobId => {
    started.push(jobId);
    await blocked;
  });

  const first = dispatcher.dispatch('job-1');
  const second = dispatcher.dispatch('job-2');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(started.sort(), ['job-1', 'job-2']);
  releaseJobs();
  await Promise.all([first, second]);
});

test('re-runs the same job when it is dispatched again during execution', async () => {
  let releaseFirstRun;
  let runCount = 0;
  const firstRunBlocked = new Promise(resolve => { releaseFirstRun = resolve; });
  const dispatcher = createKeyedJobDispatcher(async () => {
    runCount += 1;
    if (runCount === 1) await firstRunBlocked;
  });

  const completed = dispatcher.dispatch('same-job');
  await new Promise(resolve => setImmediate(resolve));
  dispatcher.dispatch('same-job');
  releaseFirstRun();
  await completed;

  assert.equal(runCount, 2);
});

test('coalesces repeated requests received during one execution', async () => {
  let releaseFirstRun;
  let runCount = 0;
  const firstRunBlocked = new Promise(resolve => { releaseFirstRun = resolve; });
  const dispatcher = createKeyedJobDispatcher(async () => {
    runCount += 1;
    if (runCount === 1) await firstRunBlocked;
  });

  const completed = dispatcher.dispatch('same-job');
  await new Promise(resolve => setImmediate(resolve));
  dispatcher.dispatch('same-job');
  dispatcher.dispatch('same-job');
  releaseFirstRun();
  await completed;

  assert.equal(runCount, 2);
});
