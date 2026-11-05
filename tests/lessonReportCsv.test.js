import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const exportSource = source.slice(source.indexOf('let reportFilters ='), source.indexOf('async function renderLessonReportsPage('));
const events = readFileSync(new URL('../public/lesson-report-events.js', import.meta.url), 'utf8');
const row = id => ({ id, student_id: 'TEST-001', student_name: '生徒, "テスト"\n次行', tutor_name: 'Tutor',
  lesson_date: '2026-11-05', lesson_result: '実施済み', lesson_number: 'PROプラン',
  pro_curriculum: 'バズ', pro_text_number: '01', reported_by: 'reporter@example.test', reported_at: '2026-11-05T01:02:03Z' });

function fixture(get) {
  const requests = [], downloads = [], notifications = [], revoked = [], blobs = [];
  const root = { contains: node => node.root === root };
  const context = { currentUser: { role: 'leader' }, sessionToken: 'test', currentPage: 'lesson-reports', API_BASE: '',
    URLSearchParams, Blob, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL: url => revoked.push(url) },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-05T01:00:00Z'])); } },
    showNotification: (...args) => notifications.push(args),
    axios: { get: async url => { requests.push(new URL(url, 'https://example.test')); return get(url, context); } },
    document: { body: { appendChild() {} }, getElementById: () => root,
      addEventListener: (_, callback) => { context.click = callback; },
      createElement: () => ({ click() { downloads.push({ filename: this.download, href: this.href }); }, remove() {} }) }
  };
  vm.createContext(context);
  vm.runInContext(exportSource + '\n' + events, context);
  const button = { textContent: 'CSVエクスポート', disabled: false, root, dataset: { reportReadAction: 'export-csv' } };
  button.closest = () => button;
  return { context, button, requests, downloads, notifications, revoked, blobs, run: code => vm.runInContext(code, context),
    export: () => context.click({ target: button }) };
}

test('CSV exports all filtered pages sequentially using the existing protected read endpoint', async () => {
  let active = 0;
  const f = fixture(async url => {
    assert.equal(++active, 1);
    const offset = Number(new URL(url, 'https://example.test').searchParams.get('offset'));
    const rows = offset === 0 ? Array.from({ length: 500 }, (_, i) => row(i)) : [row(500)];
    // Filter edits while downloading must not affect later batches.
    if (offset === 0) f.run("reportFilters.tutor_name = 'changed'");
    active--;
    return { data: { success: true, total: 501, data: rows } };
  });
  f.run("reportFilters = {start_date:'2026-11-01',end_date:'2026-11-05',student_id:'TEST',tutor_name:'Tutor',lesson_result:'実施済み'}");
  await f.export();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests.map(u => u.searchParams.get('offset')), ['0', '500']);
  for (const url of f.requests) {
    assert.equal(url.pathname, '/api/lesson-reports');
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.get('tutor_name'), 'Tutor');
    assert.equal(url.searchParams.get('start_date'), '2026-11-01');
    assert.equal(url.searchParams.get('end_date'), '2026-11-05');
    assert.equal(url.searchParams.get('lesson_result'), '実施済み');
    assert.equal(url.searchParams.get('student_id'), 'TEST');
  }
  assert.equal(f.downloads[0].filename, 'lesson_reports_2026-11-05.csv');
  assert.equal(f.blobs[0].type, 'text/csv;charset=utf-8;');
  const bytes = new Uint8Array(await f.blobs[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const csv = await f.blobs[0].text();
  assert.ok(csv.includes('"生徒, ""テスト""\n次行"'));
  assert.ok(csv.includes('"PROプラン","バズ","01"'));
  assert.ok(csv.includes('2026/11/5 10:02:03'));
  assert.equal((csv.match(/"TEST-001"/g) || []).length, 501);
  assert.deepEqual(f.revoked, ['blob:test']);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'CSVエクスポート');
});

test('CSV cells neutralize formulas and preserve quoting, null and multiline text', () => {
  const f = fixture();
  for (const text of ['=1+1', '+cmd', '-2', '@SUM(A1)', '  =1', '\ttext', '\rtext', '\ntext']) {
    assert.ok(f.context.lessonReportCsvCell(text).startsWith('"\''));
  }
  assert.equal(f.context.lessonReportCsvCell(null), '""');
  assert.equal(f.context.lessonReportCsvCell('PRO_バズ_1'), '"PRO_バズ_1"');
  assert.equal(f.context.lessonReportCsvCell('a,"b"\rc'), '"a,""b""\rc"');
});

test('empty results and failures never download partial data and always allow retry', async () => {
  for (const mode of ['empty', 'failure', 'changed', 'duplicate', 'limit', 'incomplete']) {
    const f = fixture(async () => {
      if (mode === 'failure') throw { response: { status: 403, data: 'PRIVATE' }, message: 'PRIVATE' };
      if (mode === 'limit') return { data: { success: true, total: 50001, data: [] } };
      if (mode === 'empty') return { data: { success: true, total: 0, data: [] } };
      if (f.requests.length === 1) return { data: { success: true, total: 2, data: [row(1)] } };
      return { data: { success: true, total: mode === 'changed' ? 3 : 2, data: mode === 'incomplete' ? [] : [row(1)] } };
    });
    await f.export();
    assert.equal(f.downloads.length, 0, mode);
    assert.equal(f.button.disabled, false, mode);
    assert.equal(f.run('reportCsvExportRunning'), false, mode);
    assert.ok(!JSON.stringify(f.notifications).includes('PRIVATE'));
  }
});

test('export guards deny crew/anonymous/stale controls and prevent parallel exports', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  for (const role of ['crew', null]) {
    f.context.currentUser = role ? { role } : null;
    await f.export();
  }
  assert.equal(f.requests.length, 0);
  f.context.currentUser = { role: 'admin' };
  f.context.sessionToken = null;
  await f.export();
  f.context.sessionToken = 'test';
  f.context.currentPage = 'today';
  await f.export();
  assert.equal(f.requests.length, 0);
  f.context.currentPage = 'lesson-reports';
  const pending = f.export();
  assert.equal(f.button.disabled, true);
  await f.context.exportLessonReportsCsv({ ...f.button });
  assert.equal(f.requests.length, 1);
  resolve({ data: { success: true, total: 0, data: [] } });
  await pending;
});
