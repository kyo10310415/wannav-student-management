import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { Hono } from 'hono';

const marker = 'SYNTHETIC_BROADCAST_ROUTE_PRIVATE';
const email = 'fixture@example.test';
const job = { job_id: 'fixture-job', broadcast_id: 1, status: 'needs_review', total: '2', sent: '1', failed: '0', unknown_count: '1', pending: '0',
  is_test: false, updated_at: 'fixture-time', last_error: marker, unknown_recipients: [{ student_id: marker }], created_by: email };
const student = { student_id: marker, name: marker, homeroom_tutor: marker };
const auth = { Authorization: 'Bearer fixture-session' };
const request = (body, method = 'POST') => ({ method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let sequence = 0;
async function fixture({ role = 'crew', fail = [], serviceError, returnedJob = job, emptySchedules = false, authFail = false, session = true, noOwnerRow = false } = {}) {
  const logs = [], calls = [], queries = [];
  const rawError = () => serviceError || Object.assign(new Error(marker), { config: { url: marker }, response: { data: marker } });
  const wrap = (name, value) => async (...args) => { calls.push({ name, args }); if (fail.includes(name)) throw rawError(); return value; };
  const deps = { Hono, console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(inspect(args))])),
    getTargetStudents: wrap('targets', [student]), enqueueBroadcast: wrap('enqueue', { jobId: 'fixture-job', broadcastId: 1, total: 1 }),
    getBroadcastJobStatus: wrap('status', returnedJob), getLatestRecoverableBroadcastJob: wrap('recoverable', returnedJob),
    reconcileStaleBroadcastJobs: wrap('reconcile', undefined), resumeBroadcastJob: wrap('resume', returnedJob), acknowledgeBroadcastJob: wrap('acknowledge', returnedJob),
    getTemplates: wrap('templates', [{ id: 1, content: marker }]), saveTemplate: wrap('save', { id: 1 }), deleteTemplate: wrap('delete', undefined),
    getBroadcastLogs: wrap('logs', [{ student_id: marker }]),
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM sessions')) { if (authFail) throw rawError(); return { rows: session ? [{ user_id: 1, email, role }] : [] }; }
      if (fail.includes('db')) throw rawError();
      if (sql.includes('FROM broadcast_images')) return { rows: [{ filename: 'fixture.png', content_type: 'image/png', image_data: Buffer.from('fixture-bytes') }] };
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 1, created_by: marker }] };
      if ((emptySchedules && sql.includes('WHERE is_scheduled')) || noOwnerRow) return { rows: [], rowCount: 0 };
      return { rows: [{ id: 1, created_by: marker, content: marker, schedule_enabled: true }], rowCount: 1 };
    },
  };
  let source = await readFile(new URL('../src/routes/broadcast.js', import.meta.url), 'utf8');
  source = source.replace(/import \{\s*([^}]+)\} from '[^']+';/g, (_, names) => `const { ${names} } = deps;`)
    .replace("await import('../db/connection.js')", 'deps');
  assert.equal(/\bimport(?:\s|\()/.test(source), false);
  const key = 'broadcastRoutesPrivacyFixture' + sequence++;
  globalThis[key] = deps;
  let app;
  try { app = (await import(`data:text/javascript;base64,${Buffer.from(`const deps = globalThis[${JSON.stringify(key)}]; const console = deps.console;\n${source}`).toString('base64')}`)).default; }
  finally { delete globalThis[key]; }
  return { app, logs, calls, queries };
}
const safe = f => { assert.equal(f.logs.join('\n').includes(marker), false); assert.equal(f.logs.join('\n').includes(email), false); };
const schedule = { name: marker, content: marker, scheduleCron: '0 12 * * *', channelType: 'notice' };

test('route service and database failures expose only fixed errors', async () => {
  const targets = [['targets', '/preview', request({})], ['enqueue', '/send', request({ content: marker, channelType: 'notice', isTest: true })],
    ['templates', '/templates'], ['save', '/templates', request({ name: marker, content: marker })], ['delete', '/templates/1', { method: 'DELETE', headers: auth }],
    ['logs', '/logs'], ['recoverable', '/jobs/recoverable'], ['resume', '/jobs/fixture/resume', request({})], ['acknowledge', '/jobs/fixture/acknowledge', request({})],
    ['status', '/jobs/fixture'], ['db', '/tutors'], ['db', '/schedules'], ['db', '/schedules', request(schedule)],
    ['db', '/schedules/1', { method: 'DELETE', headers: auth }], ['db', '/schedules/1/toggle', request({})], ['db', '/images/fixture']];
  for (const [name, path, options] of targets) {
    const f = await fixture({ fail: [name] }); const response = await f.app.request(path, options || { headers: auth });
    assert.equal(response.status, 500, path); assert.deepEqual(await response.json(), { success: false, error: 'Broadcast operation failed' }); safe(f);
  }
});

test('known resume and acknowledge business errors retain status/message while unknown messages stay fixed', async () => {
  for (const [path, message, status] of [['resume', 'この送信ジョブを再開する権限がありません', 403], ['resume', 'この送信ジョブは現在実行中です', 409],
    ['resume', '再送可能な未送信者はいません', 409], ['acknowledge', 'この送信ジョブを確認済みにする権限がありません', 403],
    ['acknowledge', '確認が必要な送信ジョブではありません', 409], ['resume', 'Job not found', 500],
    ['resume', '送信開始時から対象者数が変化しています（開始時 12名、現在 13名）。重複や対象外送信を防ぐため、このジョブは自動復旧できません。', 500]]) {
    const f = await fixture({ fail: [path], serviceError: Object.assign(new Error(message), { status }) });
    const response = await f.app.request('/jobs/fixture/' + path, request({})); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { success: false, error: message }); safe(f);
  }
  const f = await fixture({ fail: ['resume'], serviceError: Object.assign(new Error(marker), { status: 409 }) });
  const response = await f.app.request('/jobs/fixture/resume', request({})); assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Broadcast operation failed'); safe(f);
});

test('authentication and job owner checks keep existing statuses before job disclosure', async () => {
  const anonymous = await fixture(); assert.equal((await anonymous.app.request('/templates')).status, 401); assert.equal(anonymous.queries.length, 0);
  for (const options of [{ session: false }, { authFail: true }]) { const f = await fixture(options); assert.equal((await f.app.request('/templates', { headers: auth })).status, 401); assert.equal(f.calls.length, 0); safe(f); }
  const other = await fixture({ returnedJob: { ...job, created_by: 'other@example.test' } });
  assert.equal((await other.app.request('/jobs/fixture', { headers: auth })).status, 403); safe(other);
  const missing = await fixture({ returnedJob: null }); assert.equal((await missing.app.request('/jobs/fixture', { headers: auth })).status, 404); safe(missing);
});

test('preview, enqueue and serialized jobs retain business payloads with only safe diagnostic metadata', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/preview', request({ targetStatus: 'fixture-status', targetTutor: marker }))).json(), { success: true, count: 1, students: [student] });
  assert.deepEqual(f.calls[0].args, ['fixture-status', marker, email, 'crew']);
  const message = { content: marker, channelType: 'notice', imageId: marker };
  const sent = await (await f.app.request('/send', request(message))).json(); assert.equal(sent.jobId, 'fixture-job');
  assert.deepEqual(f.calls.find(call => call.name === 'enqueue').args, [message, [student], email]);
  for (const path of ['/jobs/recoverable', '/jobs/fixture', '/jobs/fixture/resume', '/jobs/fixture/acknowledge']) {
    const response = await f.app.request(path, path.endsWith('resume') || path.endsWith('acknowledge') ? request({}) : { headers: auth });
    const body = await response.json(); assert.equal(body.success, true); assert.equal(body.job.total, 2);
    assert.equal(body.job.lastError, 'Broadcast operation failed'); assert.deepEqual(body.job.unknownRecipients, job.unknown_recipients);
  }
  safe(f);
});

test('crew schedule filtering and update/delete/toggle ownership parameters remain unchanged', async () => {
  const f = await fixture({ emptySchedules: true });
  assert.deepEqual(await (await f.app.request('/schedules', { headers: auth })).json(), { success: true, schedules: [] });
  const read = f.queries.find(call => call.sql.includes('LOWER(created_by)'));
  assert.deepEqual(read.params, [email]); assert.ok(f.queries.some(call => call.sql.includes('GROUP BY created_by')));
  const created = await (await f.app.request('/schedules', request(schedule))).json(); assert.equal(created.message, 'Schedule created');
  const updated = await (await f.app.request('/schedules', request({ ...schedule, id: 1 }))).json(); assert.equal(updated.message, 'Schedule updated');
  const update = f.queries.find(call => call.sql.includes('WHERE id = $9 AND created_by = $10')); assert.equal(update.params.at(-1), email);
  await f.app.request('/schedules/1', { method: 'DELETE', headers: auth });
  assert.deepEqual(f.queries.find(call => call.sql.startsWith('DELETE FROM broadcast_messages')).params, ['1', email]);
  await f.app.request('/schedules/1/toggle', request({}));
  assert.deepEqual(f.queries.find(call => call.sql.includes('SET schedule_enabled = NOT')).params, ['1', email]); safe(f);
});

test('image upload and retrieval keep bytes, owner, type and headers without metadata logs', async () => {
  for (const fail of [[], ['db']]) {
    const f = await fixture({ fail }); const form = new FormData(); form.append('image', new File(['fixture-bytes'], marker + '.png', { type: 'image/png' }));
    const response = await f.app.request('/upload-image', { method: 'POST', headers: auth, body: form });
    assert.equal(response.status, fail.length ? 500 : 200);
    if (!fail.length) {
      const insert = f.queries.find(call => call.sql.includes('INSERT INTO broadcast_images'));
      assert.equal(insert.params[1], marker + '.png'); assert.equal(insert.params[2], 'image/png'); assert.equal(insert.params[4].toString(), 'fixture-bytes'); assert.equal(insert.params[5], email);
      const image = await f.app.request('/images/fixture', { headers: auth }); assert.equal(await image.text(), 'fixture-bytes'); assert.equal(image.headers.get('Content-Type'), 'image/png');
    } else assert.equal((await response.json()).error, 'Broadcast operation failed');
    safe(f);
  }
});

test('template CRUD, validation and schedule not-found outcomes retain existing contracts', async () => {
  const f = await fixture();
  assert.deepEqual(await (await f.app.request('/templates', { headers: auth })).json(), { success: true, templates: [{ id: 1, content: marker }] });
  assert.equal((await (await f.app.request('/templates', request({ name: marker, content: marker }))).json()).templateId, 1);
  assert.equal((await (await f.app.request('/templates/1', { method: 'DELETE', headers: auth })).json()).message, 'Template deleted');
  for (const [path, data] of [['/send', {}], ['/send', { content: marker }], ['/templates', {}], ['/schedules', {}]]) assert.equal((await f.app.request(path, request(data))).status, 400);
  const missing = await fixture({ noOwnerRow: true });
  assert.equal((await missing.app.request('/schedules', request({ ...schedule, id: 1 }))).status, 404);
  assert.equal((await missing.app.request('/schedules/1', { method: 'DELETE', headers: auth })).status, 404);
  assert.equal((await missing.app.request('/schedules/1/toggle', request({}))).status, 404); safe(f); safe(missing);
});

test('template save rejects invalid JSON types values and IDs before service calls',async()=>{const f=await fixture();for(const body of [null,[],42,{name:{},content:'Synthetic'},{name:' ',content:'Synthetic'},{name:'Synthetic',content:[]},{name:'Synthetic',content:'Synthetic',id:0},{name:'Synthetic',content:'Synthetic',channelType:'invalid'},{name:'Synthetic',content:'Synthetic',imageUrl:{}}])assert.equal((await f.app.request('/templates',request(body))).status,400);assert.equal((await f.app.request('/templates',{...request({}),body:'{'})).status,400);assert.equal(f.calls.length,0)});
test('template delete rejects unsafe IDs before service calls',async()=>{const f=await fixture();for(const id of['0','-1','1.5','9007199254740992','bad'])assert.equal((await f.app.request('/templates/'+id,{method:'DELETE',headers:auth})).status,400);assert.equal(f.calls.length,0)});
test('missing or unauthorized template update/delete returns a fixed 404',async()=>{for(const method of['save','delete']){const f=await fixture({fail:[method],serviceError:Object.assign(new Error(marker),{status:404})});const r=await f.app.request('/templates'+(method==='delete'?'/7':''),method==='delete'?{method:'DELETE',headers:auth}:request({name:'Synthetic',content:'Synthetic',id:7}));assert.equal(r.status,404);assert.equal((await r.json()).error,'テンプレートが見つかりません');safe(f)}});
test('schedule save rejects malformed body IDs and field types before business SQL',async()=>{
 const f=await fixture();
 for(const body of [null,[],42,{...schedule,id:0},{...schedule,id:'1;bad'},{...schedule,name:{}},{...schedule,content:[]},{...schedule,scheduleCron:[]},{...schedule,imageId:{}},{...schedule,scheduleEnabled:'true'}])assert.equal((await f.app.request('/schedules',request(body))).status,400);
 assert.equal((await f.app.request('/schedules',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{'})).status,400);
 assert.equal(f.queries.filter(x=>!x.sql.includes('FROM sessions')).length,0);assert.equal(f.calls.length,0);
});

test('schedule edit SQL keeps owner restriction and requires scheduled record type',async()=>{
 const f=await fixture();assert.equal((await f.app.request('/schedules',request({...schedule,id:1}))).status,200);
 const update=f.queries.find(x=>x.sql.includes('SET name = $1'));
 assert.ok(update.sql.includes('WHERE id = $9 AND created_by = $10 AND is_scheduled = true'));assert.equal(update.params[9],email);assert.equal(f.calls.length,0);
});
