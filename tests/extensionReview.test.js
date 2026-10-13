import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseReviewUrl, DEFAULT_REVIEW_SETTINGS, targetMatch, estimateReviewCost, validateReviewSettings,
  validateReviewResult, reviewMarkdown, reviewFingerprint, resolveReviewSpeakers } from '../src/services/extensionReviewRules.js';
import { reviewPropertyValue, fetchReviewNotion, ageFromBirthDate } from '../src/services/extensionReviewSources.js';
import { fetchReviewTranscript } from '../src/services/driveService.js';
import { gradeExtensionReview, reviewApiFailure } from '../src/services/extensionReviewAI.js';
import { createExtensionReviewRoutes } from '../src/routes/extensionReview.js';
import { createExtensionReviewService } from '../src/services/extensionReviewService.js';

const transcript = '00:00:10\nTutor: 次回について一緒に確認しましょう。\nStudent: はい。';
const point = () => ({ text: '確認ができた', evidence: [{ quote: '次回について一緒に確認しましょう。', speaker: 'Tutor', timestamp: '00:00:10' }] });
const result = () => ({ score: 85, bonuses: [point()], penalties: [], improvements: [point()],
  scriptMatch: { ...point(), score: 70 }, originality: { ...point(), score: 60 }, goodFactors: [point()], issues: [], summary: point() });
const config = () => ({ ...structuredClone(DEFAULT_REVIEW_SETTINGS), criteria: '登録済みのテスト用採点基準',
  scripts: ['審査1', '審査2', '審査3', '審査4'], speakerAliases: { T1: ['Tutor'] }, prices: { input: 2, cachedInput: 0.2, output: 10 } });
const profile = { streams: ['雑談','コラボ'], age: 32, companyReasons: ['理由1','理由2'], expenseConsent: 'Yes', classification: ['プライドが高い'] };

test('extracts strict Notion and Google Docs IDs, including app.notion.com format', () => {
  assert.equal(parseReviewUrl('https://app.notion.com/p/11111111222233334444555555555555', 'notion'), '11111111-2222-3333-4444-555555555555');
  assert.equal(parseReviewUrl('https://docs.google.com/document/d/abcdefghijklm/edit?usp=sharing', 'docs'), 'abcdefghijklm');
  for (const url of ['http://docs.google.com/document/d/abcdefghijklm/edit', 'https://docs.google.com.evil.test/document/d/abcdefghijklm/edit', 'https://user:pass@docs.google.com/document/d/abcdefghijklm/edit', 'https://localhost/document/d/abcdefghijklm/edit', 'https://docs.google.com:444/document/d/abcdefghijklm/edit']) assert.throws(() => parseReviewUrl(url,'docs'));
});
test('computes all six conditions and rounds the match percentage', () => {
  assert.equal(targetMatch(profile).rate,100);
  assert.equal(targetMatch({ ...profile,age:35 }).rate,83);
  assert.equal(targetMatch({ ...profile,age:30 }).rate,100);
  assert.equal(targetMatch({ ...profile,age:34 }).rate,100);
});
test('unknown data never becomes a false match or a fabricated denominator', () => {
  const match = targetMatch({ ...profile,age:null,companyReasons:'理由がいくつかある。' });
  assert.equal(match.rate,null); assert.equal(match.known,4); assert.equal(match.matched,4);
  assert.equal(targetMatch({ ...profile,expenseConsent:false }).conditions[3].state,'不一致');
  assert.equal(targetMatch({ ...profile,companyReasons:['同じ理由','同じ理由'] }).conditions[2].state,'不一致');
});
test('parses property types without losing rich text or boolean false', () => {
  assert.equal(reviewPropertyValue({type:'rich_text',rich_text:[{plain_text:'A'},{plain_text:'B'}]}),'AB');
  assert.equal(reviewPropertyValue({type:'checkbox',checkbox:false}),false);
  assert.deepEqual(reviewPropertyValue({type:'multi_select',multi_select:[{name:'A'},{name:'B'}]}),['A','B']);
  assert.equal(reviewPropertyValue({type:'formula',formula:{type:'number',number:32}}),32);
  assert.equal(reviewPropertyValue(undefined),null);
});

test('birth date calculates completed age on the current JST day, including birthdays and leap days', () => {
  const now = new Date('2026-10-13T15:00:00Z'); // 2026/10/14 JST
  assert.equal(ageFromBirthDate('1994-10-14',now),32);
  assert.equal(ageFromBirthDate('1994/10/15',now),31);
  assert.equal(ageFromBirthDate('1994/10/13',now),32);
  assert.equal(ageFromBirthDate('1994-10-14',new Date('2026-10-13T14:59:59Z')),31);
  assert.equal(ageFromBirthDate('2000-02-29',new Date('2026-02-28T03:00:00Z')),25);
  assert.equal(ageFromBirthDate('2000-02-29',new Date('2026-03-01T03:00:00Z')),26);
  assert.equal(ageFromBirthDate('1994-10-14T00:00:00+09:00',now),32);
  for (const value of [null,'','不明','1994-02-30','2025-02-29','1994-13-01','2026-10-15','2027-01-01',32]) assert.equal(ageFromBirthDate(value,now),null);
});

test('CSV mapping reads exact Notion property names and calculates age without retaining birthdays', async () => {
  const old=process.env.NOTION_STUDENT_DB_ID;
  delete process.env.NOTION_STUDENT_DB_ID;
  try {
    const notion={pages:{retrieve:async()=>({properties:{
      'やってみたい配信':{type:'multi_select',multi_select:[{name:'雑談'},{name:'コラボ'}]},
      '生年月日':{type:'date',date:{start:'1994-10-14'}},
      '企業が良い理由':{type:'rich_text',rich_text:[{plain_text:'- 理由1\n- 理由2'}]},
      '実費負担への合意':{type:'checkbox',checkbox:true},
      '6分類':{type:'select',select:{name:'プライドが高い'}}
    }})}};
    const source=await fetchReviewNotion('page',{},notion,{now:new Date('2026-10-13T15:00:00Z')});
    assert.equal(source.profile.age,32);
    assert.deepEqual(source.profile.companyReasons,['理由1','理由2']);
    assert.equal(targetMatch(source.profile).rate,100);
    assert.ok(!JSON.stringify(source.profile).includes('1994-10-14'));
    assert.equal(validateReviewSettings(config()).mapping.age.transform,'ageFromBirthDate');
    assert.throws(()=>validateReviewSettings({...config(),mapping:{streams:{source:'property',name:'配信',transform:'ageFromBirthDate'}}}));
  } finally { if(old===undefined)delete process.env.NOTION_STUDENT_DB_ID;else process.env.NOTION_STUDENT_DB_ID=old; }
});
test('Notion direct read supports block pagination, child blocks and relation titles', async () => {
  const calls=[];
  const old=process.env.NOTION_STUDENT_DB_ID;
  delete process.env.NOTION_STUDENT_DB_ID;
  try {
    const notion={pages:{retrieve:async ({page_id}) => page_id === 'related'
      ? {properties:{Title:{type:'title',title:[{plain_text:'雑談'}]}}}
      : {properties:{'配信':{type:'relation',relation:[{id:'related'}]},'年齢':{type:'number',number:32}}}},
      blocks:{children:{list:async options=>{
        calls.push(options);
        if(options.block_id==='child')return {results:[{id:'b',type:'bulleted_list_item',bulleted_list_item:{rich_text:[{plain_text:'理由2'}]}}],has_more:false};
        if(options.start_cursor)return {results:[{id:'child',type:'toggle',toggle:{rich_text:[{plain_text:'理由'}]},has_children:true}],has_more:false};
        return {results:[{id:'h',type:'heading_2',heading_2:{rich_text:[{plain_text:'理由'}]}},{id:'a',type:'bulleted_list_item',bulleted_list_item:{rich_text:[{plain_text:'理由1'}]}}],has_more:true,next_cursor:'next'};
      }}}};
    const read=await fetchReviewNotion('page',{streams:{source:'property',name:'配信'},age:{source:'property',name:'年齢'},companyReasons:{source:'block',name:'理由'}},notion);
    assert.deepEqual(read.profile.streams,['雑談']); assert.equal(read.profile.age,32);
    assert.deepEqual(read.profile.companyReasons,['理由1','理由2']); assert.ok(calls.some(c=>c.start_cursor==='next'));
  } finally { if(old===undefined)delete process.env.NOTION_STUDENT_DB_ID;else process.env.NOTION_STUDENT_DB_ID=old; }
});
test('Notion error details are sanitized', async () => {
  await assert.rejects(fetchReviewNotion('page',{}, {pages:{retrieve:async()=>{throw new Error('PRIVATE_TEST_SENTINEL');}}}), e=>e.safe && !e.message.includes('PRIVATE_TEST_SENTINEL'));
});
function tab(title, text, childTabs = []) { return {tabProperties:{title},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:text}}]}}]}},childTabs}; }
test('Docs prefers all nested transcript tabs and preserves speaker/timestamps', async () => {
  const docs={documents:{get:async options=>{assert.equal(options.includeTabsContent,true);return {data:{tabs:[tab('メモ','要約'),tab('文字起こし',transcript,[tab('続き','00:10:00\nTutor: 終わります。')])]}};}}};
  const read=await fetchReviewTranscript('doc',docs);
  assert.ok(read.text.includes(transcript)); assert.ok(read.text.includes('00:10:00')); assert.ok(!read.text.includes('要約'));
});
test('Docs reads all tabs when no transcript tab exists and sanitizes permission errors', async () => {
  const read=await fetchReviewTranscript('doc',{documents:{get:async()=>({data:{tabs:[tab('A','first'),tab('B','last')]}})}});
  assert.equal(read.text,'first\nlast');
  await assert.rejects(fetchReviewTranscript('doc',{documents:{get:async()=>{throw {code:403,message:'PRIVATE_TEST_SENTINEL'};}}}),e=>e.safe && e.message.includes('共有権限') && !e.message.includes('PRIVATE_TEST_SENTINEL'));
});
test('JSON validation rejects invented quotes, speakers, timestamps and invalid scores', () => {
  assert.equal(validateReviewResult(result(),transcript).score,85);
  for(const change of [r=>r.bonuses[0].evidence[0].quote='存在しない発言',r=>r.summary.evidence[0].speaker='Other',r=>r.summary.evidence[0].timestamp='99:99:99',r=>r.score=101]) {
    const r=result();change(r);assert.throws(()=>validateReviewResult(r,transcript));
  }
  const wrongSpeaker = result(); wrongSpeaker.summary.evidence[0].speaker = 'Student';
  assert.throws(()=>validateReviewResult(wrongSpeaker,transcript));
});

test('turn validation accepts distant headers and ignores body headings, but rejects wrong attribution', () => {
  const quote=point().evidence[0].quote;
  for(const prefix of ['説明。'.repeat(500), '説明。'.repeat(150)+'\n補足：説明です。\n']) {
    assert.equal(validateReviewResult(result(),'00:00:10\nTutor: '+prefix+quote,['Tutor']).score,85);
  }
  const normalized=result();
  for(const p of [normalized.bonuses[0],normalized.improvements[0],normalized.goodFactors[0],normalized.scriptMatch,normalized.originality,normalized.summary]) p.evidence[0].timestamp='00:10';
  assert.equal(validateReviewResult(normalized,transcript,['Tutor']).score,85);
  assert.throws(()=>validateReviewResult(result(),'00:00:10\nTutor: 別の内容\nStudent: '+quote,['Tutor']));
  assert.throws(()=>validateReviewResult(result(),'00:00:11\nTutor: '+quote,['Tutor']));
  const later=transcript+'\n00:00:20\n'+quote;
  const latest=result();
  for(const p of [latest.bonuses[0],latest.improvements[0],latest.goodFactors[0],latest.scriptMatch,latest.originality,latest.summary]) {p.evidence[0].speaker='Student';p.evidence[0].timestamp='00:00:20';}
  assert.equal(validateReviewResult(latest,later).score,85);
});

test('API failures classify billing and other causes without exposing credentials or raw errors', async () => {
  const logs=[];
  const secret='PRIVATE_TEST_SENTINEL';
  const error=Object.assign(new Error(secret),{status:429,code:'credit_balance_exhausted',request:{body:secret}});
  await assert.rejects(gradeExtensionReview({transcript,config:config(),round:1,model:'test-model',log:data=>logs.push(data)},
    {responses:{create:async()=>{throw error;}}}), e=>e.safe && e.message.includes('残高') && !e.message.includes(secret));
  assert.deepEqual(logs,[{stage:'api',category:'billing',status:429}]);
  assert.ok(!JSON.stringify(logs).includes(secret));
  for(const [err,category] of [[{status:401},'authentication'],[{status:403},'model_access'],[{status:429},'rate_limit'],[{name:'APITimeoutError'},'timeout'],[{status:503},'upstream']]) assert.equal(reviewApiFailure(err).category,category);
});

test('quota errors distinguish rolling hourly and monthly limits without starting AI', async()=>{
  const hourly=persistenceFixture({userHour:10});
  await assert.rejects(hourly.service.generate(hourly.input,{id:1,role:'admin'}),e=>e.status===429 && e.message.includes('直近1時間') && e.message.includes('失敗分を含む'));
  assert.equal(hourly.calls,0);
  const monthly=persistenceFixture({monthly:100});
  await assert.rejects(monthly.service.generate(monthly.input,{id:1,role:'admin'}),e=>e.status===429 && e.message.includes('月間'));
  assert.equal(monthly.calls,0);
});
test('Responses uses one call and only the selected script; no fallback on failures', async () => {
  for(const round of [1,2,3,4]) {
    const calls=[];
    const client={responses:{create:async input=>{calls.push(input);return {status:'completed',output_text:JSON.stringify(result()),usage:{input_tokens:100,output_tokens:50}};}}};
    const grade=await gradeExtensionReview({transcript,config:config(),round,model:'gpt-6-sol',tutorName:'Tutor',speakerLabels:['Tutor']},client);
    assert.equal(grade.result.score,85);assert.equal(calls.length,1);assert.equal(calls[0].model,'gpt-6-sol');assert.equal(calls[0].store,false);assert.equal(calls[0].text.format.strict,true);
    const prompt=JSON.stringify(calls[0].input);
    assert.ok(prompt.includes('review_tutor'));assert.ok(prompt.includes('tutor_speaker_labels'));
    for (const rule of ['文字起こし全文を時系列で読み','それだけで減点しない','理由を深掘り','不安の払拭や解決策の提示','再度意思確認','成果の否定と決めつけず','時系列で2〜4件引用','登録基準の配点や条件は変更しない']) assert.ok(prompt.includes(rule));
    assert.ok(prompt.includes(`審査${round}`));for(const other of [1,2,3,4].filter(n=>n!==round))assert.ok(!prompt.includes(`審査${other}`));
  }
  let calls=0;
  await assert.rejects(gradeExtensionReview({transcript,config:config(),round:1,model:'gpt-6-sol'},{responses:{create:async()=>{calls++;throw new Error('PRIVATE_TEST_SENTINEL');}}}),e=>e.safe&&!e.message.includes('PRIVATE_TEST_SENTINEL'));
  assert.equal(calls,1);
});
test('missing criteria, oversize transcript, incomplete/refused/malformed JSON stop safely', async () => {
  let calls=0;const client={responses:{create:async()=>{calls++;return {status:'completed',output_text:'not json'};}}};
  await assert.rejects(gradeExtensionReview({transcript,config:{...config(),criteria:''},round:1,model:'gpt-6-sol'},client));assert.equal(calls,0);
  await assert.rejects(gradeExtensionReview({transcript:'A'.repeat(100001),config:config(),round:1,model:'gpt-6-sol'},client));assert.equal(calls,0);
  await assert.rejects(gradeExtensionReview({transcript,config:config(),round:1,model:'gpt-6-sol'},client));assert.equal(calls,1);
  await assert.rejects(gradeExtensionReview({transcript,config:config(),round:1,model:'gpt-6-sol'},{responses:{create:async()=>({status:'incomplete',output_text:''})}}));
});
test('Markdown uses JS and custom template without another AI call', () => {
  const markdown=reviewMarkdown(result(),profile,targetMatch(profile));
  for(const heading of ['【延長審査採点】','【トークスクリプト】','【生徒様の人物像】','【要因分析】'])assert.ok(markdown.includes(heading));
  assert.ok(markdown.includes('85 / 100'));assert.ok(markdown.includes('**一致度：** 70%'));assert.ok(markdown.includes('**オリジナリティ：** 60%'));
  assert.ok(markdown.includes('**理想のターゲット像との一致率：100%**'));
  assert.ok(markdown.includes('- **企業がいい理由：** 理由1、理由2'));
  for (const label of ['■ 良かった点','■ 課題点','■ 総括']) assert.ok(markdown.includes(label));
  assert.equal(markdown.split('\n\n---\n\n').length,4);
  const unknown = { ...profile, age:null, expenseConsent:false, streams:[] };
  const unknownMarkdown = reviewMarkdown(result(),unknown,targetMatch(unknown));
  assert.ok(unknownMarkdown.includes('一致率：算出不可'));
  assert.ok(unknownMarkdown.includes('**やってみたい配信：** 不明'));
  assert.ok(unknownMarkdown.includes('**実費負担への合意：** No'));
  assert.ok(reviewMarkdown(result(),profile,targetMatch(profile),'{{grading}}\n{{script}}\n{{profile}}\n{{factors}}').includes('85 / 100'));
});
test('cost excludes cached input from normal billing and does not invent unknown costs', () => {
  assert.equal(estimateReviewCost({input_tokens:1000000,input_tokens_details:{cached_tokens:500000},output_tokens:1000000},config().prices),11.1);
  assert.equal(estimateReviewCost(null,config().prices),null);
  assert.equal(estimateReviewCost({input_tokens:500},null),null);
  assert.equal(estimateReviewCost({input_tokens:5000},{...config().prices,longThreshold:1000}),null);
});
test('criteria versions are validated and fingerprints cover all grading inputs', () => {
  assert.equal(validateReviewSettings(config()).scripts.length,4);
  assert.throws(()=>validateReviewSettings({...config(),scripts:['one']}));
  assert.throws(()=>validateReviewSettings({...config(),prices:{input:-1,cachedInput:0,output:0}}));
  const hash=reviewFingerprint({transcript,version:1});assert.equal(hash,reviewFingerprint({transcript,version:1}));assert.notEqual(hash,reviewFingerprint({transcript,version:2}));
});

function routeFor(role, enabled = true, service = {}) {
  return createExtensionReviewRoutes({enabled:()=>enabled,db:async()=>({rows:role?[{id:1,role}]:[]}),service});
}
function request(app,path='/history',method='GET',body) {
  return app.request(path,{method,headers:{Authorization:'Bearer test-session','Content-Type':'application/json'},...(body===undefined || method==='GET'?{}:{body:JSON.stringify(body)})});
}
test('API denies missing/expired authentication and crew on every feature route', async () => {
  assert.equal((await routeFor('admin').request('/history')).status,401);
  assert.equal((await request(routeFor(null))).status,401);
  for(const [path,method]of [['/history','GET'],['/analysis','GET'],['/generate','POST'],['/settings','GET'],['/diagnostics','POST'],['/results/id','GET']])assert.equal((await request(routeFor('crew'),path,method,{})).status,403);
});
test('disabled feature hides capabilities and cannot invoke AI or sources', async () => {
  let calls=0;const app=routeFor('admin',false,{generate:async()=>{calls++;}});
  assert.equal((await request(app,'/generate','POST',{})).status,403);assert.equal(calls,0);
  assert.equal((await (await request(app,'/capabilities')).json()).data.enabled,false);
});
test('leader can grade/read/review but cannot edit criteria, confirm, edit results or diagnose', async () => {
  const app=routeFor('leader',true,{history:async()=>[],generate:async()=>({id:'id'}),review:async()=>({id:'id'})});
  assert.equal((await request(app)).status,200);assert.equal((await request(app,'/generate','POST',{})).status,200);assert.equal((await request(app,'/results/id/review','POST',{})).status,200);
  for(const[path,method]of [['/settings','POST'],['/settings','GET'],['/diagnostics','POST'],['/results/id','PUT'],['/results/id/confirm','POST']])assert.equal((await request(app,path,method,{})).status,403);
});
test('API sanitizes unknown errors and rate limits requests', async () => {
  const app=routeFor('admin',true,{history:async()=>{throw new Error('PRIVATE_TEST_SENTINEL');}});
  const response=await request(app);assert.equal(response.status,500);assert.ok(!(await response.text()).includes('PRIVATE_TEST_SENTINEL'));
  const limited=routeFor('admin',true,{history:async()=>[]});
  for(let i=0;i<30;i++)assert.equal((await request(limited)).status,200);
  assert.equal((await request(limited)).status,429);
});

test('history query uses bound parameters for search/date/tutor and safe sorting', async () => {
  const queries=[];const service=createExtensionReviewService({db:async(sql,params)=>{queries.push({sql,params});return{rows:[]};}});
  await service.history({student:'test',tutor:'id',from:'2026-10-01',to:'2026-10-31',sort:'score'});
  assert.ok(!queries[0].sql.includes('?'));assert.ok(queries[0].sql.includes('student_name ILIKE $1 OR student_id ILIKE $1'));assert.equal(queries[0].params[0],'%test%');
  await assert.rejects(service.history({round:'99'}));
});
test('confirmed results are protected and rollback preserves the original AI evaluation', async () => {
  const calls=[];const service=createExtensionReviewService({connect:async()=>({query:async(sql)=>{calls.push(sql);return{rows:sql.includes('FOR UPDATE')?[{state:'succeeded',confirmed_at:'now'}]:[]};},release(){}})});
  await assert.rejects(service.edit('id',result(),{id:1,role:'admin'}),e=>e.status===409);
  assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(sql=>sql.includes('SET edited_result')));
});

function persistenceFixture(options={}) {
  let row=null, calls=0, releases=0;
  const queries=[];
  const db=async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('FROM extension_review_settings'))return{rows:[{id:'1',config:options.noPrices ? {...config(),prices:null} : config()}]};
    if(sql.includes('SELECT DISTINCT'))return{rows:[{employee_id:'T1',tutor_name:'Test tutor'}]};
    if(sql.includes('FROM students'))return{rows:[{student_id:'ST1',name:'Test student'}]};
    return{rows:[]};
  };
  const connection={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('pg_try_advisory_lock'))return{rows:[{locked:options.locked!==false}]};
    if(sql.includes('WHERE fingerprint'))return{rows:row?.state==='succeeded' && row.fingerprint===params[0]?[row]:[]};
    if(sql.includes('AS monthly'))return{rows:[{monthly:options.monthly||0,user_hour:options.userHour||0}]};
    if(sql.includes('INSERT INTO extension_reviews')) {
      row={id:params[0],created_by:params[1],round:params[2],student_id:params[3],student_name:params[4],tutor_id:params[5],tutor_name:params[6],notion_page_id:params[7],document_id:params[8],fingerprint:params[9],settings_id:params[10],model:params[11],profile:JSON.parse(params[12]),target_match:JSON.parse(params[13]),state:'pending'};
    }
    if(sql.includes("state = 'succeeded'"))row={...row,state:'succeeded',ai_result:JSON.parse(params[1]),usage:JSON.parse(params[2]),estimated_cost:params[3]};
    if(sql.includes("state = 'failed'"))row={...row,state:'failed',safe_error:params[1],usage:JSON.parse(params[2]),estimated_cost:params[3]};
    return{rows:row?[row]:[]};
  },release(){releases++;}};
  const service=createExtensionReviewService({db,connect:async()=>connection,readNotion:async()=>({studentId:'ST1',profile}),readDoc:async()=>({text:transcript}),
    grade:async()=>{calls++;if(options.fail)throw Object.assign(new Error('安全なAIエラー'),{safe:true,status:502,apiUsage:{input_tokens:100,output_tokens:10}});return{result:result(),usage:{input_tokens:100,output_tokens:50}};},model:()=> 'gpt-6-sol'});
  const input={round:1,tutorId:'T1',notionUrl:'https://app.notion.com/p/11111111222233334444555555555555',documentUrl:'https://docs.google.com/document/d/abcdefghijklm/edit'};
  return {service,input,queries,get row(){return row;},get calls(){return calls;},get releases(){return releases;}};
}
test('grading works without price registration and hides cost controls', async()=>{
  const f=persistenceFixture({noPrices:true});
  const saved=await f.service.generate(f.input,{id:1,role:'admin'});
  assert.equal(saved.ai_result.score,85);
  assert.equal(saved.estimated_cost,null);
  assert.equal(f.calls,1);
  const ui=readFileSync(new URL('../public/extension-review.js',import.meta.url),'utf8');
  for(const label of ['er-prices','推定料金','料金(USD)','公式単価']) assert.ok(!ui.includes(label));
});

test('grading persists immutable AI JSON, identity, version, target, usage and estimated cost', async()=>{
  const f=persistenceFixture();const saved=await f.service.generate(f.input,{id:1,role:'admin'});
  assert.equal(saved.state,'succeeded');assert.equal(saved.settings_id,'1');assert.equal(saved.tutor_id,'T1');assert.equal(saved.target_match.rate,100);
  assert.equal(saved.ai_result.score,85);assert.ok(saved.markdown.includes('85 / 100'));assert.ok(saved.estimated_cost>0);assert.equal(f.calls,1);assert.equal(f.releases,1);
  assert.ok(!f.queries.some(q=>q.sql.includes('transcript')));
});
test('same grading conditions reuse persisted result without another AI call',async()=>{
  const f=persistenceFixture();await f.service.generate(f.input,{id:1,role:'admin'});
  const reused=await f.service.generate(f.input,{id:1,role:'leader'});assert.equal(reused.reused,true);assert.equal(f.calls,1);
});

test('old evaluation policy results are not reused for a new grading request',async()=>{
  const f=persistenceFixture();
  const previous=await f.service.generate(f.input,{id:1,role:'admin'});
  f.row.fingerprint='previous-policy-fingerprint';
  const current=await f.service.generate(f.input,{id:1,role:'admin'});
  assert.equal(current.reused,false);
  assert.notEqual(current.id,previous.id);
  assert.equal(f.calls,2);
});
test('regrading requires confirmation and persists a separate record',async()=>{
  const f=persistenceFixture();const first=await f.service.generate(f.input,{id:1,role:'admin'});
  await assert.rejects(f.service.generate({...f.input,force:true},{id:1,role:'admin'}));
  const second=await f.service.generate({...f.input,force:true,regradeConfirmed:true},{id:1,role:'admin'});
  assert.notEqual(first.id,second.id);assert.equal(f.calls,2);
});
test('concurrency lock and monthly/user quotas stop before calling AI',async()=>{
  for(const option of [{locked:false},{monthly:100},{userHour:10}]) {
    const f=persistenceFixture(option);await assert.rejects(f.service.generate(f.input,{id:1,role:'admin'}),e=>e.status===429);assert.equal(f.calls,0);assert.equal(f.releases,1);
  }
});
test('failed AI attempts retain sanitized state and usage, without automatic retries',async()=>{
  const f=persistenceFixture({fail:true});await assert.rejects(f.service.generate(f.input,{id:1,role:'admin'}));
  assert.equal(f.calls,1);assert.equal(f.row.state,'failed');assert.equal(f.row.usage.input_tokens,100);assert.ok(f.row.estimated_cost>0);
});
test('migration runner applies only additional schema once and does not rewrite existing data',async()=>{
  const versions=new Set(Array.from({length:57},(_,i)=>i+1)),executed=[];
  const pool={query:async(sql,params)=>{
    if(sql.includes('SELECT version'))return{rows:versions.has(params[0])?[{version:params[0]}]:[]};
    if(sql.includes('INSERT INTO migration_history'))versions.add(params[0]);else executed.push(sql);
    return{rows:[]};
  }};
  const context={getPool:()=>pool,console:{log(){},error(){}},process:{argv:[],exit(){}}};
  const code=readFileSync(new URL('../src/db/migrate.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replaceAll('import.meta.url',"'not-executed'").replace('export { runMigrations };','globalThis.runMigrations = runMigrations;');
  vm.runInNewContext(code,context);await context.runMigrations();await context.runMigrations();
  const additions=executed.filter(sql=>sql.includes('extension_review_settings'));
  assert.equal(additions.length,1);assert.ok(additions[0].includes('CREATE TABLE IF NOT EXISTS extension_reviews'));
  assert.ok(!/ALTER TABLE (students|tutors)|DELETE FROM|UPDATE students|UPDATE tutors/.test(additions[0]));
});
test('UI helpers escape untrusted content and discard responses after session changes',async()=>{
  const context={currentUser:null,sessionToken:null,API_BASE:'',setTimeout,document:{getElementById:()=>null},console};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../public/extension-review.js',import.meta.url),'utf8'),context);
  assert.ok(context.erEscape('<script>"bad"</script>').includes('&lt;script&gt;'));
  context.currentUser={role:'admin'};context.sessionToken='old';context.axios=async()=>{context.sessionToken='new';return{data:{data:{private:true}}};};
  await assert.rejects(context.erRequest('/history'),/SessionChanged/);
});

test('selected Tutor must match a source label and be represented in grading evidence',()=>{
  assert.deepEqual(resolveReviewSpeakers(transcript,['Tutor']),['Tutor']);
  assert.throws(()=>resolveReviewSpeakers(transcript,['Wrong tutor']));
  assert.throws(()=>validateReviewResult(result(),transcript,['Student']));
  assert.equal(validateReviewResult(result(),transcript,['Tutor']).score,85);
});
test('unknown configuration/result fields are rejected instead of storing extra source data',()=>{
  assert.throws(()=>validateReviewSettings({...config(),unexpected:'extra'}));
  assert.throws(()=>validateReviewResult({...result(),transcript:'raw source'},transcript));
});
test('streamed oversized JSON is rejected before grading',async()=>{
  let calls=0;const app=routeFor('admin',true,{generate:async()=>{calls++;return{};}});
  const response=await request(app,'/generate','POST',{extra:'A'.repeat(1000001)});
  assert.equal(response.status,413);assert.equal(calls,0);
});
test('connection diagnostics use metadata, never run Responses or return raw transcript',async()=>{
  let reads=0;
  const app=createExtensionReviewRoutes({enabled:()=>true,db:async()=>({rows:[{id:1,role:'admin'}]}),service:{settings:async()=>({id:'1',config:config()})},
    ai:()=>({models:{retrieve:async()=>{reads++;}},responses:{create:()=>{throw new Error('Must not run');}}}),
    docs:async()=>({text:transcript,tabs:['文字起こし']}),notion:async()=>({profile,propertySchema:[{name:'年齢',type:'number'}],blockHeadings:['理由']})});
  const response=await request(app,'/diagnostics','POST',{notionUrl:'https://app.notion.com/p/11111111222233334444555555555555',documentUrl:'https://docs.google.com/document/d/abcdefghijklm/edit'});
  const data=await response.json();assert.equal(response.status,200);assert.equal(reads,1);assert.equal(data.data.docs.data.characters,transcript.length);assert.ok(!JSON.stringify(data).includes('次回について一緒に'));
});
test('Notion property pagination returns full rich text without guessing or truncating',async()=>{
  const old=process.env.NOTION_STUDENT_DB_ID;delete process.env.NOTION_STUDENT_DB_ID;
  try {
    const cursors=[];
    const notion={pages:{retrieve:async()=>({properties:{Value:{id:'prop',type:'rich_text',has_more:true,rich_text:[]}}}),properties:{retrieve:async input=>{cursors.push(input.start_cursor);return input.start_cursor?{object:'list',results:[{rich_text:{plain_text:'B'}}],has_more:false}:{object:'list',results:[{rich_text:{plain_text:'A'}}],has_more:true,next_cursor:'next'};}}}};
    const source=await fetchReviewNotion('page',{streams:{source:'property',name:'Value'}},notion);
    assert.equal(source.profile.streams,'AB');assert.deepEqual(cursors,[undefined,'next']);
  } finally {if(old===undefined)delete process.env.NOTION_STUDENT_DB_ID;else process.env.NOTION_STUDENT_DB_ID=old;}
});
test('old capability response cannot overwrite a newly authenticated session',async()=>{
  const context={currentUser:null,sessionToken:null,API_BASE:'',document:{getElementById:()=>null},console,setTimeout};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../public/extension-review.js',import.meta.url),'utf8'),context);
  const pending={};context.axios=async options=>new Promise(resolve=>{pending[options.headers.Authorization]=resolve;});
  context.currentUser={role:'admin'};context.sessionToken='old';const old=context.refreshExtensionReviewCapability();
  context.sessionToken='new';const fresh=context.refreshExtensionReviewCapability();
  pending['Bearer new']({data:{data:{enabled:true}}});await fresh;
  pending['Bearer old']({data:{data:{enabled:false}}});await old;
  assert.equal(vm.runInContext('extensionReviewFeatureEnabled',context),true);
});
test('settings updates append versions without altering existing results',async()=>{
  const queries=[];const service=createExtensionReviewService({db:async(sql,params)=>{queries.push({sql,params});return{rows:[{id:String(queries.length),config:JSON.parse(params[0])}]};}});
  await service.saveSettings(config(),{id:1});await service.saveSettings({...config(),criteria:'変更後の基準'}, {id:1});
  assert.equal(queries.length,2);assert.ok(queries.every(q=>q.sql.startsWith('INSERT INTO extension_review_settings')));
});
test('Tutor analysis aggregates independent scores, rounds, months, frequencies and costs',async()=>{
  const second=result();second.score=45;second.penalties=[{...point(),text:'__proto__'}];
  const service=createExtensionReviewService({db:async sql=>({rows:sql.includes("WHERE state = 'succeeded'")
    ? [{tutor_id:'T1',tutor_name:'Tutor',round:1,month:'2026-10',result:result(),confirmed_at:null},{tutor_id:'T1',tutor_name:'Tutor',round:2,month:'2026-11',result:second,confirmed_at:'now'}]
    : [{month:'2026-10',calls:2,errors:1,estimated_cost:0.1,unpriced:1}]})});
  const data=await service.analysis();assert.equal(data.tutors[0].score,65);assert.equal(data.tutors[0].count,2);assert.equal(data.tutors[0].confirmed,1);
  assert.equal(data.tutors[0].months['2026-11'].score,45);assert.equal(data.tutors[0].penalties.__proto__,1);assert.equal(data.costs[0].errors,1);
});
