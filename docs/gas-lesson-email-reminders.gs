// New standalone GAS project, owned/authorized by the sender. Do not paste into existing cache GAS.
var LESSON_MAIL_SENDER = 'k.sakamoto@oneloopinc.net';
var LESSON_CONTACT_SHEET = '1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM';

function lessonMailSettings_() {
  if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== LESSON_MAIL_SENDER) {
    throw new Error('送信元アカウントで実行・認可してください');
  }
  var properties = PropertiesService.getScriptProperties();
  var base = properties.getProperty('APP_BASE_URL');
  var key = properties.getProperty('GAS_EMAIL_REMINDER_API_KEY') || '';
  if (base !== 'https://wannav-student-management.onrender.com' || key.length < 32) {
    throw new Error('APP_BASE_URLと専用APIキーをスクリプトプロパティに設定してください');
  }
  return {properties:properties, base:base, key:key};
}

function lessonMailBatch_(settings) {
  var response;
  try {
    response = UrlFetchApp.fetch(settings.base + '/api/email-reminders/batch', {
      method:'get', headers:{Authorization:'Bearer ' + settings.key},
      followRedirects:false, muteHttpExceptions:true
    });
  } catch (_) { throw new Error('アプリに接続できませんでした。メールは送信していません'); }
  if (response.getResponseCode() !== 200) throw new Error('メール連携APIを確認してください HTTP ' + response.getResponseCode());
  var data;
  try { var json=JSON.parse(response.getContentText()); data=json.success && json.data; }
  catch (_) { throw new Error('メール連携APIの応答が不正です'); }
  var tomorrow=Utilities.formatDate(new Date(Date.now()+86400000),'Asia/Tokyo','yyyy-MM-dd');
  if (!data || data.targetDate !== tomorrow || !Array.isArray(data.items) || data.items.length > 500) throw new Error('メール対象日・件数が不正です');
  data.items.forEach(function(item) {
    if (!item || !/^[a-f0-9]{64}$/.test(item.id) || typeof item.studentId !== 'string' || !item.studentId.trim() || item.studentId.length > 100 ||
        item.lessonDate !== tomorrow || typeof item.subject !== 'string' || /[\r\n]/.test(item.subject) || item.subject.length > 200 ||
        typeof item.body !== 'string' || !item.body.trim() || item.body.length > 10000) throw new Error('メール対象データが不正です');
  });
  return data;
}

function lessonMailContacts_() {
  var sheet=SpreadsheetApp.openById(LESSON_CONTACT_SHEET).getSheetByName('❶RAW_生徒様情報');
  if (!sheet) throw new Error('生徒様情報シートが見つかりません');
  var contacts=new Map();
  var size=sheet.getLastRow()-1;
  if (size <= 0) return contacts;
  // Read B and AL in two batch calls, without reading phone numbers or other credentials.
  var ids=sheet.getRange(2,2,size,1).getDisplayValues();
  var emails=sheet.getRange(2,38,size,1).getDisplayValues();
  ids.forEach(function(row,i) {
    var id=String(row[0]).trim().toUpperCase(), email=String(emails[i][0]).trim();
    if (!id) return;
    if (contacts.has(id) && contacts.get(id) !== email) contacts.set(id,null);
    else if (!contacts.has(id)) contacts.set(id,email);
  });
  return contacts;
}

function validLessonMailAddress_(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}

function runLessonEmailReminders() {
  var settings=lessonMailSettings_();
  if (settings.properties.getProperty('EMAIL_REMINDERS_ENABLED') !== 'true') return;
  var hour=Number(Utilities.formatDate(new Date(),'Asia/Tokyo','H'));
  if (hour < 17 || hour >= 20) return;
  var today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (settings.properties.getProperty('MAIL_COMPLETED_DATE') === today) return;
    var batch=lessonMailBatch_(settings), contacts=lessonMailContacts_();
    var cutoff=Utilities.formatDate(new Date(Date.now()-35*86400000),'Asia/Tokyo','yyyy-MM-dd');
    Object.keys(settings.properties.getProperties()).forEach(function(key) {
      if (/^lesson-mail:\d{4}-\d{2}-\d{2}:/.test(key) && key.slice(12,22) < cutoff) settings.properties.deleteProperty(key);
    });
    var remaining=MailApp.getRemainingDailyQuota();
    var sent=0, skipped=0, uncertain=0, deferred=false;
    for (var i=0;i<batch.items.length;i++) {
      var item=batch.items[i], key='lesson-mail:'+batch.targetDate+':'+item.id;
      if (settings.properties.getProperty(key)) continue;
      var email=contacts.get(item.studentId.trim().toUpperCase());
      if (!validLessonMailAddress_(email)) { skipped++; continue; }
      if (remaining <= 0 || sent >= 50) { deferred=true; break; }
      // Persist before sending: a timeout/crash must not blindly duplicate mail.
      settings.properties.setProperty(key,'sending');
      try {
        MailApp.sendEmail({to:email,subject:item.subject,body:item.body,name:'WannaV',replyTo:LESSON_MAIL_SENDER});
      } catch (_) {
        settings.properties.setProperty(key,'uncertain');
        uncertain++; remaining--; continue;
      }
      settings.properties.setProperty(key,'sent');
      sent++; remaining--;
    }
    if (!deferred) settings.properties.setProperty('MAIL_COMPLETED_DATE',today);
    console.log('LessonEmail: sent='+sent+', missing/invalid/duplicate-contact='+skipped+', uncertain='+uncertain+', deferred='+deferred);
  } finally { lock.releaseLock(); }
}

// Safe diagnostic: reads data/quota and returns counts, without sending or logging personal data.
function checkLessonEmailSetup() {
  var settings=lessonMailSettings_(), batch=lessonMailBatch_(settings), contacts=lessonMailContacts_();
  var valid=batch.items.filter(function(item){return validLessonMailAddress_(contacts.get(item.studentId.trim().toUpperCase()));}).length;
  var result={targetDate:batch.targetDate,lessons:batch.items.length,validContacts:valid,remainingQuota:MailApp.getRemainingDailyQuota()};
  console.log(JSON.stringify(result)); return result;
}

// Explicit manual test: sends only to the sender, never a student's address.
function sendLessonEmailTestToSelf() {
  var settings=lessonMailSettings_(), batch=lessonMailBatch_(settings);
  if (!batch.items.length) throw new Error('翌日のレッスンがありません');
  if (MailApp.getRemainingDailyQuota()<1) throw new Error('メール送信枠がありません');
  MailApp.sendEmail({to:LESSON_MAIL_SENDER,subject:'[テスト] '+batch.items[0].subject,body:batch.items[0].body,name:'WannaV'});
}

// Run once only after approving the self-test. No web app deployment is needed.
function installLessonEmailTrigger() {
  lessonMailSettings_();
  if (!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='runLessonEmailReminders';})) {
    ScriptApp.newTrigger('runLessonEmailReminders').timeBased().everyMinutes(5).create();
  }
}
