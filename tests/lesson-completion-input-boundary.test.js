import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess, LESSON_COMPLETION_REQUEST_MAX_BYTES } from '../src/security/apiAccess.js';
const headers = { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' };
let sequence = 0;
async function fixture(role = 'crew') {
  const state = { queries: [], cache: 0, batches: [], months: [], parses: 0 };
  const deps = { Hono, process: { env: {} }, console: { log(){}, error(){} },
    query: async (...args) => { state.queries.push(args); return { rows: [] }; },
    fetchLessonCompletionStatus: async () => { state.cache++; return new Map(); },
    resolveLessonCompletionItems: async items => { state.batches.push(items); return items.map(item => ({ ...item, completed: false })); },
    getCompletedStudentIdsForMonth: async month => { state.months.push(month); return { yearMonth: month, completedStudentIds: [] }; }
  };
  const source = (await readFile(new URL('../src/routes/lessonCompletion.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
  const key = 'completionBoundary' + sequence++; globalThis[key] = deps; let routes;
  try { routes = (await import('data:text/javascript;base64,' + Buffer.from(`const {Hono,process,console,query,fetchLessonCompletionStatus,resolveLessonCompletionItems,getCompletedStudentIdsForMonth}=globalThis[${JSON.stringify(key)}];\n` + source).toString('base64'))).default; }
  finally { delete globalThis[key]; }
  const app = new Hono();
  app.use('/api/*', async (c, next) => { const parse = c.req.json.bind(c.req); c.req.json = (...args) => { state.parses++; return parse(...args); }; return next(); });
  installApiAccess(app, { db: async () => ({ rows: [{ id: 7, role, email: 'synthetic@example.test', must_change_password: false }] }) });
  app.route('/api/lesson-completion', routes); return { app, state };
}
function stream(parts) {
  let i = 0; const seen = { pulls: 0, canceled: false };
  return { seen, body: new ReadableStream({ pull(c){ seen.pulls++; if(i < parts.length)c.enqueue(parts[i++]);else c.close(); }, cancel(){ seen.canceled = true; } }, { highWaterMark: 0 }) };
}
const request = (body, extra = {}) => new Request('http://fixture.invalid/api/lesson-completion/batch', { method: 'POST', headers: { ...headers, ...extra }, body, duplex: 'half' });
const pair = { studentId: 'Synthetic', lessonDate: '2028-02-29' };

test('completion bulk bounds bytes before parsing for all existing roles and keeps anonymous unread', async () => {
  assert.equal(LESSON_COMPLETION_REQUEST_MAX_BYTES, 1048576);
  const f = await fixture(), anon = stream([new Uint8Array(1)]);
  assert.equal((await f.app.request(new Request('http://fixture.invalid/api/lesson-completion/batch', { method: 'POST', body: anon.body, duplex: 'half' }))).status, 401); assert.equal(anon.seen.pulls, 0);
  for(const role of ['admin','leader','crew']) {
    const f = await fixture(role), declared = stream([new Uint8Array(1)]);
    assert.equal((await f.app.request(request(declared.body, { 'Content-Length': '1048577' }))).status, 413);
    assert.equal(declared.seen.pulls, 0); assert.equal(f.state.parses, 0); assert.equal(f.state.batches.length, 0);
    for(const length of [undefined, '1']) {
      const f = await fixture(role), actual = stream([new Uint8Array(524288),new Uint8Array(524289)]);
      assert.equal((await f.app.request(request(actual.body, length ? { 'Content-Length': length } : {}))).status, 413);
      assert.equal(actual.seen.canceled, true); assert.equal(f.state.parses, 0); assert.equal(f.state.batches.length, 0);
    }
  }
});

test('batch rejects malformed objects, item types, IDs and calendar dates before service calls', async () => {
  const f = await fixture();
  for(const raw of ['{','null','[]','1','"value"','{}','{"items":{}}']) assert.equal((await f.app.request(request(raw))).status, 400);
  for(const item of [null, [], 1, 'text', {}, { ...pair, studentId: {} }, { ...pair, studentId: '' }, { ...pair, studentId: ' ' }, { ...pair, studentId: 'x\u0000' }]) {
    assert.equal((await f.app.request(request(JSON.stringify({ items: [pair,item] })))).status, 400);
  }
  for(const lessonDate of ['2026-02-29','2026-04-31','0000-01-01','2026-13-01','2026-1-01','2026-01-01T00:00:00Z',{},null,1]) assert.equal((await f.app.request(request(JSON.stringify({ items: [{ ...pair, lessonDate }] })))).status, 400);
  assert.equal(f.state.batches.length, 0); assert.equal(f.state.queries.length, 0); assert.equal(f.state.cache, 0);
  const broken = new ReadableStream({ pull(c){ c.error(Error('PRIVATE_SENTINEL')); } });
  const response = await f.app.request(request(broken)); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('PRIVATE_SENTINEL'));
});

test('exact-limit normal duplicate pairs, raw ID and empty batches retain service response contract', async () => {
  const f = await fixture(), items = [pair, pair, { studentId: ' ab－12 ', lessonDate: '0001-01-01' }];
  const body = { items, padding: '' }; body.padding = 'x'.repeat(1048576 - Buffer.byteLength(JSON.stringify(body)));
  const response = await f.app.request(request(JSON.stringify(body))); assert.equal(response.status, 200);
  assert.deepEqual(f.state.batches, [items]); assert.deepEqual(await response.json(), { success: true, data: items.map(item => ({ ...item, completed: false })), count: 3 });
  assert.equal((await f.app.request(request('{"items":[]}'))).status, 200); assert.deepEqual(f.state.batches[1], []);
});

test('completion GET date/month boundaries reject before SQL, cache or service and preserve normal query values', async () => {
  const f = await fixture();
  for(const date of ['2026-02-29','0000-01-01','2026-13-01','x']) assert.equal((await f.app.request('/api/lesson-completion/check?studentId=Synthetic&lessonDate='+date, { headers })).status, 400);
  assert.equal((await f.app.request('/api/lesson-completion/check?studentId=x%00&lessonDate=2026-10-29', { headers })).status, 400);
  for(const path of ['/month','/completed-students']) for(const month of ['2026-00','2026-13','0000-01','2026-1','x']) assert.equal((await f.app.request('/api/lesson-completion'+path+'?yearMonth='+month, { headers })).status, 400);
  assert.equal(f.state.queries.length, 0); assert.equal(f.state.cache, 0); assert.equal(f.state.months.length, 0);
  assert.equal((await f.app.request('/api/lesson-completion/check?studentId=%20ab%EF%BC%8D12%20&lessonDate=2028-02-29', { headers })).status, 200);
  assert.deepEqual(f.state.queries[0][1], [' ab－12 ', '2028-02-29']);
  for(const path of ['/month','/completed-students']) assert.equal((await f.app.request('/api/lesson-completion'+path+'?yearMonth=2026-10', { headers })).status, 200);
});

test('completion browser logs omit student/date samples and raw upstream errors', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function loadLessonCompletionBatch()');
  const fn = source.slice(start, source.indexOf('\n}', start) + 2), logs = [], updates = [];
  const studentId = 'SYNTHETIC_PRIVATE_ID', selected = [{ student_id: studentId }], body = {}, root = { contains: node => node === body, querySelectorAll: () => [] };
  const context = { sessionToken: 'synthetic', currentUser: { id: 1, role: 'crew' }, currentPage: 'reservations', currentTab: 'active', activeSubTab: 'lesson', selectedTutor: 'all', reservationCountFilter: 'all', currentMonth: new Date(2026,9,1), studentSearchQuery: '', document: { getElementById: id => id === 'content' ? root : body }, API_BASE: '', getFilteredStudents: () => selected, lessonDates: { [studentId]: [{ date: new Date(2026,9,29) }] },
    axios: { post: async () => ({ data: { success: true, data: [{ studentId, lessonDate: '2026-10-29', completed: true }] } }) },
    updateLessonCompletionDisplay: (...args) => updates.push(args), console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) } };
  vm.createContext(context); vm.runInContext('let lessonCompletionReadGeneration = 0;\n'+fn, context); await context.loadLessonCompletionBatch();
  assert.equal(updates.length, 1); assert.ok(!logs.join('\n').includes(studentId)); assert.ok(!logs.join('\n').includes('2026-10-29'));
  context.axios.post = async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); }; await context.loadLessonCompletionBatch();
  assert.ok(!logs.join('\n').includes('SYNTHETIC_PRIVATE_ERROR'));
});
