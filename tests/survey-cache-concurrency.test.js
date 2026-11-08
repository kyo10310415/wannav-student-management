import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';

const silent = { log() {}, warn() {}, error() {} };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function fixture() {
  let now = 1000;
  const requests = { counts: [], responders: [] };
  const deps = {
    Hono, getPool() {}, getExtensionPool() {}, queryExtension() {},
    fetchSurveyResponsesFromCache() { const d = deferred(); requests.counts.push(d); return d.promise; },
    fetchCurrentMonthSurveyResponses() { const d = deferred(); requests.responders.push(d); return d.promise; },
    fetchMonthlyResponseHistory() {}, fetchExtensionResultsFromCache() {},
  };
  let source = await readFile(new URL('../src/routes/survey.js', import.meta.url), 'utf8');
  source = source.replace(/import\s+[\s\S]*?from\s+'[^']+';/g, '')
    .replace('export default app;', '');
  const api = new Function('deps', 'console', 'process', 'Date', `
    const { Hono, getPool, getExtensionPool, queryExtension, fetchSurveyResponsesFromCache,
      fetchCurrentMonthSurveyResponses, fetchMonthlyResponseHistory, fetchExtensionResultsFromCache } = deps;
    ${source}
    return { app, getSurveyResponseCounts, getCurrentMonthResponders };
  `)(deps, silent, { env: { GOOGLE_CACHE_SHEET_ID: 'test-sheet' } }, class extends Date { static now() { return now; } });
  return { ...api, requests, advance() { now += 3600001; } };
}

for (const [getter, kind, result, empty] of [
  ['getSurveyResponseCounts', 'counts', { TEST: 2 }, {}],
  ['getCurrentMonthResponders', 'responders', new Set(['TEST']), new Set()],
]) {
  test(`${kind}: simultaneous cold and expired reads share one request and preserve results`, async () => {
    const f = await fixture();
    for (let round = 0; round < 2; round++) {
      const reads = Array.from({ length: 40 }, () => f[getter]());
      await Promise.resolve();
      assert.equal(f.requests[kind].length, round + 1);
      f.requests[kind][round].resolve(result);
      for (const value of await Promise.all(reads)) assert.deepEqual(value, result);
      assert.deepEqual(await f[getter](), result);
      assert.equal(f.requests[kind].length, round + 1);
      f.advance();
    }
  });

  test(`${kind}: failure is shared, stale values survive, and a later read retries`, async () => {
    const f = await fixture();
    const first = f[getter]();
    await Promise.resolve();
    f.requests[kind][0].reject(new Error('synthetic failure'));
    assert.deepEqual(await first, empty);
    const retry = f[getter]();
    await Promise.resolve();
    f.requests[kind][1].resolve(result);
    assert.deepEqual(await retry, result);
    f.advance();
    const reads = [f[getter](), f[getter]()];
    await Promise.resolve();
    assert.equal(f.requests[kind].length, 3);
    f.requests[kind][2].reject(new Error('synthetic failure'));
    for (const value of await Promise.all(reads)) assert.deepEqual(value, result);
    const next = f[getter]();
    await Promise.resolve();
    f.requests[kind][3].resolve(result);
    await next;
  });

  test(`${kind}: clear-cache during a fetch prevents stale cache repopulation`, async () => {
    const f = await fixture();
    const pending = f[getter]();
    await Promise.resolve();
    assert.equal((await f.app.request('/clear-cache', { method: 'POST' })).status, 200);
    f.requests[kind][0].resolve(result);
    await pending;
    const refreshed = f[getter]();
    await Promise.resolve();
    assert.equal(f.requests[kind].length, 2);
    f.requests[kind][1].resolve(result);
    await refreshed;
  });
}

test('survey counts request only column G and preserve normalized per-student counts', async () => {
  const calls = [];
  const source = (await readFile(new URL('../src/services/cacheService.js', import.meta.url), 'utf8'))
    .replace("import { getSheets } from './sheetsService.js';", '')
    .replace(/export /g, '');
  const getSheets = () => ({ spreadsheets: { values: { get: async options => {
    calls.push(options);
    return { data: { values: [[' test－01 '], ['TEST-01'], [], ['　'], ['OTHER']] } };
  } } } });
  const fetchCounts = new Function('getSheets', 'console', `${source}\nreturn fetchSurveyResponsesFromCache;`)(getSheets, silent);
  assert.deepEqual(await fetchCounts('test-sheet'), { 'TEST-01': 2, OTHER: 1 });
  assert.deepEqual(calls, [{ spreadsheetId: 'test-sheet', range: 'レッスン満足度データ!G2:G' }]);
});
