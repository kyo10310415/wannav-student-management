import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildLessonReminderBody, parseLessonReminderDate } from '../src/services/lessonReminderContent.js';
import { buildEmailReminderBatch, createEmailReminderRoutes, reminderTargetDate } from '../src/routes/emailReminders.js';

const lesson={student_id:'ST1',lesson_date:'2026/10/16 20:00:00',tutor_name:'担当先生',meet_link:'https://meet.google.com/abc-defg-hij'};
const batch=()=>buildEmailReminderBatch([lesson],[{student_id:'ST1',name:'テスト生徒'}],'2026-10-16');
test('email is the same reminder as Discord except mentions and bold formatting',()=>{
  const discord=buildLessonReminderBody('テスト生徒',lesson,{discord:true,discordId:'123'});
  const expected='テスト生徒様\n\n明日はレッスンの予定になっております！\n忘れずにご参加ください！\nもしご都合が悪い場合は、必ず担任の先生にご連絡ください！\n\n**日時**: 2026/10/16 20:00\n**担任講師**: 担当先生\n**Google Meetリンク**: https://meet.google.com/abc-defg-hij\n\nよろしくお願いいたします！';
  assert.equal(discord,'<@123>\n\n'+expected);
  assert.equal(buildLessonReminderBody('テスト生徒',lesson),expected.replaceAll('**',''));
  assert.ok(!buildLessonReminderBody('生徒',{}).includes('担任講師'));
});
test('batch uses tomorrow JST, normalizes IDs and times, deduplicates and excludes other dates',()=>{
  assert.equal(reminderTargetDate(new Date('2026-10-14T15:00:00Z')),'2026-10-16');
  assert.equal(reminderTargetDate(new Date('2026-10-14T14:59:59Z')),'2026-10-15');
  const data=buildEmailReminderBatch([lesson,{...lesson,student_id:' st1 ',lesson_date:'2026/10/16 20:00'}, {...lesson,lesson_date:'2026/10/17 20:00:00'}, {...lesson,lesson_date:'2026/10/16 25:00:00'}],[{student_id:'ST1',name:'生徒'}],'2026-10-16');
  assert.equal(data.items.length,1);assert.match(data.items[0].id,/^[a-f0-9]{64}$/);
  assert.ok(data.items[0].body.startsWith('生徒様'));
});

test('date-only E with separate J time is included with correct time and the same deduplication key',()=>{
  const separated={...lesson,lesson_date:'2026/10/16',lesson_time:'20:00'};
  const data=buildEmailReminderBatch([lesson,separated],[{student_id:'ST1',name:'テスト生徒'}],'2026-10-16');
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].id,batch().items[0].id);
  assert.equal(buildLessonReminderBody('テスト生徒',separated),batch().items[0].body);
  assert.ok(buildLessonReminderBody('テスト生徒',separated,{discord:true}).includes('**日時**: 2026/10/16 20:00'));
  assert.equal(parseLessonReminderDate({...separated,lesson_time:' 9:05:00 '}).timeKey,'09:05:00');
  assert.equal(parseLessonReminderDate({...lesson,lesson_time:'21:00'}).timeKey,'20:00:00');
});

test('invalid/missing J times and invalid calendar dates never become midnight reminders',()=>{
  for(const time of ['', '25:00','20:99','20:00:60','unknown']){
    const invalid={...lesson,lesson_date:'2026/10/16',lesson_time:time};
    assert.equal(parseLessonReminderDate(invalid),null);
    assert.equal(buildEmailReminderBatch([invalid],[],'2026-10-16').items.length,0);
  }
  assert.equal(parseLessonReminderDate({...lesson,lesson_date:'2026/02/30 20:00'}),null);
});
test('dedicated email endpoint authenticates and respects flag before reading personal data',async()=>{
  let reads=0;
  const key='test-only-key-with-at-least-32-characters';
  const app=createEmailReminderRoutes({key:()=>key,enabled:()=>false,lessons:async()=>{reads++;return[lesson];}});
  assert.equal((await app.request('/batch')).status,401);
  assert.equal((await app.request('/batch',{headers:{Authorization:'Bearer '+key}})).status,503);
  assert.equal(reads,0);
  const active=createEmailReminderRoutes({key:()=>key,enabled:()=>true,lessons:async()=>[lesson],db:async()=>({rows:[{student_id:'ST1',name:'生徒'}]}),now:()=>new Date('2026-10-15T08:00:00Z')});
  const response=await active.request('/batch',{headers:{Authorization:'Bearer '+key}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await response.json()).data.items.length,1);
});

function gas({email='student@example.test',owner='k.sakamoto@oneloopinc.net',quota=40,fail=false,enabled=true,rows}={}) {
  const values=new Map([['APP_BASE_URL','https://wannav-student-management.onrender.com'],['GAS_EMAIL_REMINDER_API_KEY','test-only-key-with-at-least-32-characters'],['EMAIL_REMINDERS_ENABLED',String(enabled)]]);
  const sent=[],fetches=[],ranges=[],triggers=[];
  let released=0;
  const properties={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),deleteProperty:k=>values.delete(k),getProperties:()=>Object.fromEntries(values)};
  const context={
    console:{log(){}},
    Date:class extends Date {constructor(...args){super(...(args.length?args:['2026-10-15T08:05:00Z']));} static now(){return Date.parse('2026-10-15T08:05:00Z');}},
    Session:{getEffectiveUser:()=>({getEmail:()=>owner})},
    PropertiesService:{getScriptProperties:()=>properties},
    Utilities:{formatDate:(d,tz,format)=>format==='H'?String(Number(d.toISOString().slice(11,13))+9):d.toISOString().slice(0,10)},
    UrlFetchApp:{fetch:(url,options)=>{fetches.push({url,options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({success:true,data:batch()})};}},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>rows?rows.length+1:2,getRange:(r,c,n,w)=>{ranges.push(c);return{getDisplayValues:()=>rows?rows.map(row=>[row[c===2?0:1]]):[[c===2?'ST1':email]]};}})})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{released++;}})},
    MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:options=>{sent.push(options);if(fail)throw new Error('PRIVATE_SENTINEL');}},
    ScriptApp:{getProjectTriggers:()=>triggers.map(()=>({getHandlerFunction:()=>'runLessonEmailReminders'})),newTrigger:()=>({timeBased(){return this;},everyMinutes(){return this;},create(){triggers.push(true);}})}
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../docs/gas-lesson-email-reminders.gs',import.meta.url),'utf8'),context);
  return {context,sent,values,fetches,ranges,triggers,get released(){return released;}};
}
test('GAS sends to AL by B student ID, keeps wording and never reads phone numbers',()=>{
  const f=gas();f.context.runLessonEmailReminders();f.context.runLessonEmailReminders();
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'student@example.test');
  assert.equal(f.sent[0].body,batch().items[0].body);
  assert.deepEqual(f.ranges,[2,38]);assert.equal(f.fetches.length,1);
  assert.equal(f.fetches[0].options.followRedirects,false);
});
test('GAS sender guard, disabled flag, bad/missing/ambiguous contacts and exhausted quota do not send',()=>{
  const wrong=gas({owner:'other@example.test'});assert.throws(()=>wrong.context.runLessonEmailReminders(),/送信元/);assert.equal(wrong.fetches.length,0);
  for(const options of [{enabled:false},{email:''},{email:'a@example.test,b@example.test'},{rows:[['ST1','a@example.test'],['ST1','b@example.test']]},{quota:0}]){
    const f=gas(options);f.context.runLessonEmailReminders();assert.equal(f.sent.length,0);
  }
});
test('uncertain send is retained without automatic duplication and retry after quota exhaustion works',()=>{
  const failed=gas({fail:true});failed.context.runLessonEmailReminders();failed.context.runLessonEmailReminders();
  assert.equal(failed.sent.length,1);
  assert.equal(failed.values.get('lesson-mail:2026-10-16:'+batch().items[0].id),'uncertain');
  const exhausted=gas({quota:0});exhausted.context.runLessonEmailReminders();
  assert.ok(!exhausted.values.has('MAIL_COMPLETED_DATE'));
  exhausted.context.MailApp.getRemainingDailyQuota=()=>40;
  exhausted.context.runLessonEmailReminders();assert.equal(exhausted.sent.length,1);
});
test('GAS diagnostics send nothing, self test sends only to owner, trigger setup is idempotent',()=>{
  const f=gas();assert.equal(f.context.checkLessonEmailSetup().validContacts,1);assert.equal(f.sent.length,0);
  f.context.sendLessonEmailTestToSelf();assert.equal(f.sent[0].to,'k.sakamoto@oneloopinc.net');
  f.context.installLessonEmailTrigger();f.context.installLessonEmailTrigger();assert.equal(f.triggers.length,1);
});
