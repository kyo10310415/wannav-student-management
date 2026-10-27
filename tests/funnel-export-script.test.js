import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../public/funnel-analysis-export.js', import.meta.url), 'utf8');
function fixture(respond, selected = '') {
  const elements = { progress: { textContent: '' }, start: { disabled: false }, month: { value: '2026-09' }, studentIds: { value: selected } };
  const calls = [], downloads = [], blobs = [], timers = [], revoked = [];
  const context = vm.createContext({
    document: {
      getElementById: id => elements[id],
      createElement: tag => { assert.equal(tag, 'a'); const link = { click() { downloads.push({ href: this.href, filename: this.download }); } }; return link; }
    },
    localStorage: { getItem: name => { assert.equal(name, 'sessionToken'); return 'synthetic-session'; } },
    fetch: async (url, options) => { calls.push({ url, options }); return respond(new URL(url, 'https://fixture.invalid'), calls.length); },
    URLSearchParams,
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:synthetic'; }, revokeObjectURL: url => revoked.push(url) },
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    setTimeout: (callback, delay) => timers.push({ callback, delay })
  });
  vm.runInContext(script, context, { filename: 'funnel-analysis-export.js' });
  return { elements, calls, downloads, blobs, timers, revoked, run: () => elements.start.onclick() };
}
const response = (data, ok = true) => ({ ok, json: async () => data });
const initial = details => ({ funnel: { data: { cancellationBreakdown: { details } } } });
const downloaded = f => JSON.parse(f.blobs[0].parts[0]);

test('export page loads its script after controls without inline JavaScript', async () => {
  const html = await readFile(new URL('../public/funnel-analysis-export.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/funnel-analysis-export\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*[^<\s]/);
  assert.ok(html.indexOf('id="progress"') < html.indexOf('src="/funnel-analysis-export.js"'));
});

test('export preserves month, authorization, deduplication, completion exclusion and blob cleanup', async () => {
  const f = fixture(url => response(url.searchParams.has('studentId') ? { studentId: url.searchParams.get('studentId') } : initial({
    active: [{ studentId: 'SYNTHETIC-A' }, { student_id: 'SYNTHETIC-B' }, { studentId: 'SYNTHETIC-A' }], completed: [{ studentId: 'SYNTHETIC-C' }]
  })));
  await f.run();
  assert.equal(f.calls.length, 3);
  for (const { url, options } of f.calls) {
    const parsed = new URL(url, 'https://fixture.invalid');
    assert.equal(parsed.pathname, '/api/funnel/analysis-export');
    assert.equal(parsed.searchParams.get('year'), '2026'); assert.equal(parsed.searchParams.get('month'), '9');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session');
  }
  assert.deepEqual(downloaded(f).discord.map(row => row.studentId), ['SYNTHETIC-A', 'SYNTHETIC-B']);
  assert.deepEqual(f.downloads, [{ href: 'blob:synthetic', filename: 'funnel-analysis-2026-09.json' }]);
  assert.equal(f.blobs[0].type, 'application/json'); assert.equal(f.timers[0].delay, 60000);
  f.timers[0].callback(); assert.deepEqual(f.revoked, ['blob:synthetic']);
  assert.equal(f.elements.start.disabled, false); assert.match(f.elements.progress.textContent, /2名、取得失敗0名/);
});

test('selected IDs and individual failures preserve remaining exports', async () => {
  const f = fixture(url => {
    const id = url.searchParams.get('studentId');
    if (!id) return response(initial({ active: [{ studentId: 'IGNORED-SYNTHETIC' }] }));
    return id === 'SYNTHETIC-B' ? response({ error: 'synthetic denied' }, false) : response({ studentId: id });
  }, 'SYNTHETIC-A, SYNTHETIC-B、SYNTHETIC-A\nSYNTHETIC-C');
  await f.run();
  assert.equal(f.calls.length, 4);
  assert.deepEqual(downloaded(f).discord, [{ studentId: 'SYNTHETIC-A' }, { studentId: 'SYNTHETIC-B', error: 'synthetic denied' }, { studentId: 'SYNTHETIC-C' }]);
  assert.match(f.elements.progress.textContent, /3名、取得失敗1名/); assert.equal(f.elements.start.disabled, false);
});

test('initial authorization and network failures never download and restore the control', async () => {
  for (const respond of [() => response({ error: 'synthetic unauthorized' }, false), () => { throw Error('synthetic network failure'); }]) {
    const f = fixture(respond); await f.run();
    assert.equal(f.calls.length, 1); assert.equal(f.downloads.length, 0); assert.equal(f.blobs.length, 0);
    assert.match(f.elements.progress.textContent, /synthetic/); assert.equal(f.elements.start.disabled, false);
  }
});
