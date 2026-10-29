import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { installApiAccess } from '../src/security/apiAccess.js';
const headers = { Authorization: 'Bearer ' + 'a'.repeat(64) };
const integration = 'synthetic-integration-'.repeat(3);
let sequence = 0;
async function fixture(role = 'crew') {
  const state = { queries: [], reads: 0 };
  const tutors = [1,2,3,4].map(id => ({ employee_id: 'E'+id, name: 'Synthetic', tutor_name: 'Synthetic', email: 'synthetic'+id+'@example.test' }));
  const read = value => async () => { state.reads++; return value; };
  const deps = { Hono, process: { env: { GOOGLE_CACHE_SHEET_ID: 'synthetic-sheet' } }, console: { log(){}, warn(){}, error(){} },
    query: async (sql, params) => {
      state.queries.push({ sql, params });
      if (sql === 'SELECT employee_id FROM tutors') return { rows: [...tutors.map(({employee_id})=>({employee_id})), {employee_id:'OLD'}] };
      return { rows: [] };
    },
    getCacheSyncTime: read({ lastSync: 'synthetic' }), fetchStudentsFromCache: read([{ student_id: 'SYNTHETIC', name: 'Synthetic' }]),
    fetchProgressFromCache: read({}), fetchLessonStartDates: read({}), fetchSuspensionMonthsMap: read({}), fetchStudentTextTypeMap: read(new Map()),
    calculateStudentLessonStats: read({}), calculateContinuedMonths: () => 0, normalizeStudentTextTypeStudentId: id => id,
    fetchTutorsFromCache: read(tutors)
  };
  const app = new Hono();
  const dispatch = installApiAccess(app, { integrationKey: () => integration,
    db: async () => ({ rows: [{ id:7, email:'synthetic@example.test', role, must_change_password:false }] }) });
  for (const name of ['students', 'tutors']) {
    const source = (await readFile(new URL('../src/routes/'+name+'.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\r?\n/gm, '');
    const key='fullSyncFixture'+sequence++; globalThis[key]=deps;
    try { const routes=(await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis[${JSON.stringify(key)}];\n`+source).toString('base64'))).default; app.route('/api/'+name, routes); }
    finally { delete globalThis[key]; }
  }
  return { app, state, dispatch };
}
test('anonymous and crew GET/HEAD full sync stop before external reads and real route SQL', async () => {
  for (const path of ['/api/students/sync','/api/tutors/sync']) for (const method of ['GET','HEAD']) {
    const f=await fixture();
    assert.equal((await f.app.request(path,{method})).status,401);
    assert.equal((await f.app.request(path,{method,headers})).status,403);
    assert.equal(f.state.reads,0);assert.equal(f.state.queries.length,0);
  }
});
test('admin and leader full sync retain trusted cache upserts and existing tutor deletion threshold', async () => {
  for(const role of ['admin','leader']) {
    const f=await fixture(role);
    const students=await f.app.request('/api/students/sync',{headers});assert.equal(students.status,200);assert.equal((await students.json()).count,1);
    const tutors=await f.app.request('/api/tutors/sync',{headers});assert.equal(tutors.status,200);const data=await tutors.json();assert.equal(data.count,4);assert.equal(data.deleted,1);
    assert.equal(f.state.queries.filter(row=>row.sql.includes('INSERT INTO students')).length,1);
    assert.equal(f.state.queries.filter(row=>row.sql.includes('INSERT INTO tutors')).length,4);
    assert.deepEqual(f.state.queries.find(row=>row.sql==='DELETE FROM tutors WHERE employee_id = $1').params,['OLD']);
  }
});
test('existing internal and scoped machine sync stay available while forged keys fail before reads', async () => {
  for(const path of ['/api/students/sync','/api/tutors/sync']) {
    const f=await fixture();
    assert.equal((await f.app.request(path,{headers:{'X-Internal-Request':'forged'}})).status,403);
    assert.equal((await f.app.request(path,{headers:{'X-Sync-API-Key':'forged'}})).status,401);
    assert.equal(f.state.reads,0);assert.equal(f.state.queries.length,0);
    assert.equal((await f.dispatch(path)).status,200);
    assert.equal((await f.app.request(path,{headers:{'X-Sync-API-Key':integration}})).status,200);
    assert.ok(f.state.reads>0);assert.ok(f.state.queries.length>0);
  }
});
test('crew initial load and refresh use existing shared reads without attempting any full sync', async () => {
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const extract=name=>{const start=source.indexOf('async function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2)};
  for(const role of ['crew','admin','leader']) {
    const calls=[],notices=[];
    const context={currentUser:{role},currentTutorName:null,API_BASE:'',students:[],tutors:[],cachedNotionUrls:{},selectedTutorYear:2026,selectedTutorMonth:10,
      axios:{get:async url=>{calls.push(url);return {data:{data:[],deleted:0}}}},alert:value=>notices.push(value),console:{log(){},warn(){},error(){}},event:{target:{disabled:false,innerHTML:''}},renderApp:async()=>{}};
    for(const name of ['loadSatisfactionData','loadSatisfactionLessonCompletion','loadTutorMonthlyStats','loadTutorWeeklySnapshot','loadLessonStats','loadLessonDates','loadHelperRequests','loadExtensionTutorStats','loadSurveyStats','loadSurveyNotificationSetting'])context[name]=async()=>{};
    vm.createContext(context);vm.runInContext(extract('loadInitialData')+'\n'+extract('refreshData'),context);
    await context.loadInitialData();
    const expected=role==='crew'?[]:['/api/students/sync','/api/tutors/sync','/api/lessons/sync-from-sheet'];
    assert.deepEqual(calls.filter(url=>url.includes('/sync')),expected);assert.ok(calls.includes('/api/students'));assert.ok(calls.includes('/api/tutors'));
    calls.length=0;await context.refreshData();
    if(role==='crew')assert.equal(calls.some(url=>url.includes('/sync')),false);
    else assert.ok(calls.includes('/api/tutors/sync'));
    assert.ok(notices.includes('データを更新しました'));assert.equal(context.event.target.disabled,false);
  }
});
