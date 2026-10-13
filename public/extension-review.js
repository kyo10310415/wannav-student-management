// Isolated UI for extension review; existing pages and metrics are not modified.
let extensionReviewFeatureEnabled = false;
let erCapabilityToken = null;
let erCapabilityPromise = null;
let erCapabilityExpires = 0;
let erTab = 'run';
let erResult = null;
let erSettings = null;
let erTutors = [];
let erBusy = false;
let erLastInput = null;
let erHistoryOffset = 0;
let erAnalysisTutor = null;

function erEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
async function erRequest(path, method = 'get', data) {
  const requestToken = sessionToken;
  const response = await axios({ url: `${API_BASE}/api/extension-review${path}`, method, data,
    headers: { Authorization: `Bearer ${requestToken}` } });
  if (requestToken !== sessionToken || !currentUser || !['admin','leader'].includes(currentUser.role)) throw new Error('SessionChanged');
  return response.data.data;
}
async function refreshExtensionReviewCapability() {
  if (!currentUser || !['admin','leader'].includes(currentUser.role) || !sessionToken) {
    extensionReviewFeatureEnabled = false; erCapabilityToken = null; erCapabilityPromise = null;
    erResult = null; erSettings = null; erTutors = []; erLastInput = null; erBusy = false; erAnalysisTutor = null; return false;
  }
  if (erCapabilityToken === sessionToken && erCapabilityPromise && Date.now() < erCapabilityExpires) return erCapabilityPromise;
  if (erCapabilityToken !== sessionToken) { erResult = null; erSettings = null; erTutors = []; erLastInput = null; erBusy = false; erAnalysisTutor = null; erTab = 'run'; }
  const capabilityToken = sessionToken;
  erCapabilityToken = capabilityToken;
  erCapabilityExpires = Date.now() + 60000;
  erCapabilityPromise = erRequest('/capabilities').then(data => {
    if (capabilityToken !== sessionToken || erCapabilityToken !== capabilityToken) return false;
    const changed = extensionReviewFeatureEnabled !== data.enabled;
    extensionReviewFeatureEnabled = data.enabled;
    if (changed) {
      const slot = document.getElementById('extension-review-nav');
      if (slot) slot.innerHTML = data.enabled ? '<button onclick="changePage(\'extension-review\')" class="px-4 py-2 rounded-lg font-semibold bg-orange-600 text-white hover:bg-orange-700">延長審査AI採点</button>' : '';
    }
    return data.enabled;
  }).catch(() => { if (erCapabilityToken === capabilityToken) extensionReviewFeatureEnabled = false; return false; });
  return erCapabilityPromise;
}
function erOptions() { return '<option value="">実施Tutorを選択</option>' + erTutors.map(t => `<option value="${erEscape(t.employee_id)}">${erEscape(t.tutor_name)}</option>`).join(''); }
function erInputFields() {
  return `<label class="block">審査回数<select id="er-round" class="border rounded p-2 w-full">${[1,2,3,4].map(n => `<option value="${n}">${n}回目</option>`).join('')}</select></label>
  <label class="block">実施Tutor<select id="er-tutor" class="border rounded p-2 w-full">${erOptions()}</select></label>
  <label class="block">Notion生徒ページURL<input id="er-notion" type="url" class="border rounded p-2 w-full" placeholder="https://app.notion.com/p/..." /></label>
  <label class="block">GoogleドキュメントURL<input id="er-doc" type="url" class="border rounded p-2 w-full" placeholder="https://docs.google.com/document/d/.../edit" /></label>`;
}
async function renderExtensionReviewPage() {
  if (!await refreshExtensionReviewCapability()) {
    document.getElementById('content').innerHTML = '<div class="bg-white rounded-xl p-6">延長審査AI採点は無効です。</div>'; return;
  }
  if (!erTutors.length) erTutors = await erRequest('/tutors');
  const tabs = [['run','AI採点'],['result','採点結果'],['history','採点履歴'],['analysis','Tutor別分析']];
  if (currentUser.role === 'admin') tabs.push(['settings','採点基準・スクリプト'],['diagnostics','API接続診断']);
  if (!tabs.some(([key]) => key === erTab)) erTab = 'run';
  document.getElementById('content').innerHTML = `<div class="space-y-4"><h1 class="text-2xl font-bold text-orange-700">延長審査AI採点</h1>
    <p class="text-sm text-gray-500">AIによる一次評価です。実施Tutorを選択し、管理者が確認・確定してください。既存のTutor品質指標とは独立しています。</p>
    <div class="flex flex-wrap gap-2">${tabs.map(([key,label]) => `<button onclick="erSelectTab('${key}')" class="px-4 py-2 rounded ${erTab === key ? 'bg-orange-600 text-white' : 'bg-white border'}">${label}</button>`).join('')}</div>
    <div id="er-panel" class="bg-white rounded-xl shadow p-5 space-y-4"></div></div>`;
  const panel = document.getElementById('er-panel');
  try {
    if (erTab === 'run') {
      panel.innerHTML = `<div class="grid md:grid-cols-2 gap-4">${erInputFields()}</div><button id="er-start" onclick="erGenerate()" class="bg-orange-600 text-white rounded px-5 py-2" ${erBusy ? 'disabled' : ''}>${erBusy ? '採点中…' : '採点開始'}</button><p class="text-sm text-gray-500">同一資料・基準の保存済み結果があれば再利用します。基準・対象回スクリプトが未登録の場合は実行しません。</p>`;
      if (erLastInput) {
        document.getElementById('er-round').value = erLastInput.round;
        document.getElementById('er-tutor').value = erLastInput.tutorId;
        document.getElementById('er-notion').value = erLastInput.notionUrl;
        document.getElementById('er-doc').value = erLastInput.documentUrl;
      }
    } else if (erTab === 'result') erRenderResult();
    else if (erTab === 'history') await erRenderHistory();
    else if (erTab === 'analysis') await erRenderAnalysis();
    else if (erTab === 'settings') await erRenderSettings();
    else panel.innerHTML = `${erInputFields()}<button onclick="erDiagnose()" class="bg-orange-600 text-white px-4 py-2 rounded">接続診断（採点APIは呼び出しません）</button><pre id="er-diagnosis" class="whitespace-pre-wrap text-sm"></pre>`;
  } catch (error) { panel.textContent = error.response?.data?.error || '画面の読み込みに失敗しました'; }
}
async function erSelectTab(tab) { erTab = tab; await renderExtensionReviewPage(); }
async function erGenerate(force = false) {
  if (erBusy) return;
  if (force && !confirm('再採点には追加のAPI料金が発生します。新しい採点結果として保存します。実行しますか？')) return;
  const input = force ? erLastInput : { round: Number(document.getElementById('er-round').value), tutorId: document.getElementById('er-tutor').value,
    notionUrl: document.getElementById('er-notion').value.trim(), documentUrl: document.getElementById('er-doc').value.trim() };
  if (!input?.tutorId || !input.notionUrl || !input.documentUrl) return showNotification('実施TutorとURLを入力してください', 'error');
  const gradingToken = sessionToken;
  erLastInput = input; erBusy = true;
  const button = document.getElementById('er-start'); if (button) { button.disabled = true; button.textContent = '採点中…'; }
  try {
    erResult = await erRequest('/generate', 'post', { ...input, force, regradeConfirmed: force });
    erTab = 'result'; await renderExtensionReviewPage();
    showNotification(erResult.reused ? '保存済みの結果を再利用しました' : '採点を保存しました', 'success');
  } catch (error) { if (gradingToken === sessionToken) showNotification(error.response?.data?.error || '採点に失敗しました', 'error'); }
  finally { if (gradingToken === sessionToken) { erBusy = false; if (button?.isConnected) { button.disabled = false; button.textContent = '採点開始'; } } }
}
function erRenderResult() {
  const panel = document.getElementById('er-panel');
  if (!erResult) { panel.textContent = '採点するか、履歴から結果を選択してください。'; return; }
  const row = erResult, result = row.result;
  if (!result) { panel.textContent = row.safe_error || '採点結果がまだありません'; return; }
  const points = (title, list) => `<h3 class="font-semibold mt-3">${title}</h3><ul class="list-disc pl-6">${list.map(p => `<li>${erEscape(p.text)}<details><summary class="text-sm text-orange-600 cursor-pointer">採点根拠</summary>${p.evidence.map(e => `<blockquote class="bg-gray-50 p-2 whitespace-pre-wrap">${erEscape(e.quote)}<small class="block">${erEscape(e.speaker || '発言者不明')} ${erEscape(e.timestamp || '時刻不明')}</small></blockquote>`).join('')}</details></li>`).join('') || '<li>該当なし</li>'}</ul>`;
  panel.innerHTML = `<div class="flex flex-wrap justify-between gap-3"><div><p>${erEscape(row.student_name)} / ${erEscape(row.tutor_name)} / ${row.round}回目</p><p class="text-sm text-gray-500">基準v${erEscape(row.settings_id)}・${erEscape(row.model)}・${row.confirmed_at ? '確定済み' : row.reviewed_at ? '確認済み' : 'AI一次評価'} ${row.edited_result ? '（管理者編集あり）' : ''}</p></div><div class="text-4xl font-bold text-orange-600">${result.score}<span class="text-sm"> / 100点</span></div></div>
    <div class="flex flex-wrap gap-2"><button onclick="erCopy()" class="border rounded p-2">Markdownコピー</button><button onclick="erDownload()" class="border rounded p-2">Markdownダウンロード</button>
    <a href="https://docs.google.com/document/d/${encodeURIComponent(row.document_id)}/edit" target="_blank" rel="noopener noreferrer" class="border rounded p-2">元の文字起こし</a>
    <button onclick="erGenerate(true)" class="border rounded p-2">再採点</button>
    ${!row.confirmed_at ? `<button onclick="erReview(false)" class="border rounded p-2">確認済みにする</button>${currentUser.role === 'admin' ? '<button onclick="erReview(true)" class="border rounded p-2">確定する</button><button onclick="erEdit()" class="border rounded p-2">管理者編集</button>' : ''}` : ''}</div>
    ${points('加点ポイント',result.bonuses)}${points('減点ポイント',result.penalties)}${points('改善できた点',result.improvements)}
    <h3 class="font-semibold">トークスクリプト</h3><p>一致度 ${result.scriptMatch.score}% / オリジナリティ ${result.originality.score}%</p>${points('根拠',[result.scriptMatch,result.originality])}
    <h3 class="font-semibold">生徒様の人物像</h3><p>一致率 ${row.target_match.rate === null ? '算出不可' : row.target_match.rate + '%'} / 確認済み ${row.target_match.matched}/${row.target_match.known}件一致</p>
    <div class="grid md:grid-cols-2 gap-2">${row.target_match.conditions.map(c => `<div class="border rounded p-2">${erEscape(c.label)}: ${erEscape(c.state)}</div>`).join('')}</div>
    <dl class="grid md:grid-cols-2 gap-2">${Object.entries({streams:'やってみたい配信',age:'年齢',companyReasons:'企業がいい理由',expenseConsent:'実費負担への合意',classification:'6分類'}).map(([key,label]) => `<div class="border rounded p-2"><dt class="text-sm text-gray-500">${label}</dt><dd>${erEscape(row.profile[key] === null || row.profile[key] === undefined ? '不明' : Array.isArray(row.profile[key]) ? row.profile[key].join('、') : row.profile[key] === true ? 'Yes' : row.profile[key] === false ? 'No' : row.profile[key])}</dd></div>`).join('')}</dl>
    ${points('要因分析：良かった点',result.goodFactors)}${points('要因分析：課題点',result.issues)}${points('総括',[result.summary])}
    <details><summary>Markdownプレビュー</summary><pre class="whitespace-pre-wrap">${erEscape(row.markdown)}</pre></details>
    <details><summary>AI一次評価（保存時の原本）</summary><pre class="whitespace-pre-wrap">${erEscape(JSON.stringify(row.ai_result,null,2))}</pre></details>`;
}
async function erCopy() { try { await navigator.clipboard.writeText(erResult.markdown); showNotification('コピーしました','success'); } catch { showNotification('コピーできません。Markdownプレビューからコピーしてください','error'); } }
function erDownload() {
  const url = URL.createObjectURL(new Blob([erResult.markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `extension-review-${erResult.id}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function erReview(confirmResult) {
  if (confirmResult && !confirm('確定後は編集できません。確定しますか？')) return;
  try { erResult = await erRequest(`/results/${erResult.id}/${confirmResult ? 'confirm' : 'review'}`, 'post', {}); erRenderResult(); }
  catch (error) { showNotification(error.response?.data?.error || '更新に失敗しました','error'); }
}
async function erEdit() {
  const edits = await erRequest(`/results/${erResult.id}/edits`);
  document.getElementById('er-panel').innerHTML = `<h2 class="font-bold">管理者編集（AI原本は維持されます）</h2><textarea id="er-edit-json" class="border rounded p-2 w-full h-96">${erEscape(JSON.stringify(erResult.result,null,2))}</textarea><button onclick="erSaveEdit()" class="bg-orange-600 text-white p-2 rounded">編集内容を保存</button><details><summary>編集履歴 ${edits.length}件</summary><pre class="whitespace-pre-wrap">${erEscape(JSON.stringify(edits,null,2))}</pre></details>`;
}
async function erSaveEdit() {
  try { erResult = await erRequest(`/results/${erResult.id}`, 'put', JSON.parse(document.getElementById('er-edit-json').value)); erRenderResult(); }
  catch (error) { showNotification(error.response?.data?.error || 'JSONまたは編集内容が不正です','error'); }
}
async function erOpenResult(id) {
  try {
    erResult = await erRequest(`/results/${encodeURIComponent(id)}`);
    erLastInput = { round: erResult.round, tutorId: erResult.tutor_id, notionUrl: `https://app.notion.com/p/${erResult.notion_page_id.replaceAll('-','')}`, documentUrl: `https://docs.google.com/document/d/${erResult.document_id}/edit` };
    erTab = 'result'; await renderExtensionReviewPage();
  } catch (error) { showNotification(error.response?.data?.error || '結果取得に失敗しました','error'); }
}
async function erRenderHistory() {
  document.getElementById('er-panel').innerHTML = `<div class="grid md:grid-cols-3 gap-2"><input id="er-search" placeholder="生徒名・学籍番号" class="border rounded p-2"><select id="er-filter-tutor" class="border rounded p-2"><option value="">全Tutor</option>${erTutors.map(t => `<option value="${erEscape(t.employee_id)}">${erEscape(t.tutor_name)}</option>`).join('')}</select><select id="er-filter-round" class="border rounded p-2"><option value="">全審査回数</option>${[1,2,3,4].map(n => `<option>${n}</option>`).join('')}</select><input id="er-from" type="date" class="border rounded p-2"><input id="er-to" type="date" class="border rounded p-2"><select id="er-sort" class="border rounded p-2"><option value="date">日時順</option><option value="score">点数の高い順</option></select></div><button onclick="erSearchHistory(0)" class="border p-2 rounded">検索</button><div id="er-history-list"></div>`;
  await erSearchHistory(0);
}
async function erSearchHistory(offset) {
  const params = new URLSearchParams({ student: document.getElementById('er-search').value, tutor: document.getElementById('er-filter-tutor').value,
    round: document.getElementById('er-filter-round').value, from: document.getElementById('er-from').value, to: document.getElementById('er-to').value,
    sort: document.getElementById('er-sort').value, offset: String(offset), limit: '50' });
  try {
    const rows = await erRequest('/history?' + params); erHistoryOffset = offset;
    document.getElementById('er-history-list').innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr>${['日時','生徒','Tutor','回数','スコア','状態',''].map(h => `<th class="p-2">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr class="border-t"><td class="p-2">${erEscape(new Date(row.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}</td><td>${erEscape(row.student_name)}<br>${erEscape(row.student_id)}</td><td>${erEscape(row.tutor_name)}</td><td>${row.round}</td><td>${row.score ?? '-'}</td><td>${row.state === 'failed' ? erEscape(row.safe_error) : row.confirmed_at ? '確定' : row.reviewed_at ? '確認済み' : row.state === 'pending' ? '処理中' : 'AI一次評価'}</td><td><button onclick="erOpenResult('${row.id}')" class="text-orange-600">表示</button></td></tr>`).join('') || '<tr><td colspan="7">該当なし</td></tr>'}</tbody></table></div><div class="flex gap-3"><button onclick="erSearchHistory(${Math.max(0,offset-50)})" ${offset === 0 ? 'disabled' : ''}>前へ</button><span>${offset+1}〜${offset+rows.length}件 / ${rows[0]?.total || 0}件</span><button onclick="erSearchHistory(${offset+50})" ${rows.length < 50 ? 'disabled' : ''}>次へ</button></div>`;
  } catch (error) { showNotification(error.response?.data?.error || '検索に失敗しました','error'); }
}
async function erRenderAnalysis() {
  const data = await erRequest('/analysis');
  if (erAnalysisTutor) data.tutors = data.tutors.filter(t => t.tutorId === erAnalysisTutor);
  const detail = t => {
    const averages = (title, values) => `<h4 class="font-semibold mt-2">${title}</h4><table class="w-full"><thead><tr><th>区分</th><th>件数</th><th>平均点</th></tr></thead><tbody>${Object.entries(values).map(([key,value]) => `<tr><td>${erEscape(key)}</td><td>${value.count}</td><td>${value.score.toFixed(1)}</td></tr>`).join('')}</tbody></table>`;
    const frequency = (title, values) => `<h4 class="font-semibold mt-2">${title}</h4><ul class="list-disc pl-5">${Object.entries(values).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([reason,count])=>`<li>${erEscape(reason)}：${count}件</li>`).join('') || '<li>該当なし</li>'}</ul>`;
    return averages('審査回数別',t.rounds)+averages('月別スコア推移',t.months)+frequency('主な減点理由',t.penalties)+frequency('改善項目の出現頻度',t.improvements);
  };
  document.getElementById('er-panel').innerHTML = `<p class="text-sm text-gray-500">${erEscape(data.warning)}</p>${erAnalysisTutor ? '<button onclick="erAnalysisTutor=null;erRenderAnalysis()" class="border rounded p-2">すべてのTutorを表示</button>' : ''}<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Tutor</th><th>平均点</th><th>スクリプト一致率</th><th>件数</th><th>確定件数</th><th>詳細</th></tr></thead><tbody>${data.tutors.map(t => `<tr class="border-t"><td class="p-2">${erEscape(t.tutorName)}</td><td>${t.score.toFixed(1)}</td><td>${t.scriptMatch.toFixed(1)}%</td><td>${t.count}</td><td>${t.confirmed}</td><td><details><summary>回数別・月別・減点理由・改善頻度</summary>${detail(t)}</details></td></tr>`).join('') || '<tr><td>採点履歴なし</td></tr>'}</tbody></table></div><p class="text-sm">減点理由・改善項目の頻度は同一文言の件数です。</p>`;
}
async function erOpenTutorAnalysis(tutorId) {
  erAnalysisTutor = tutorId; erTab = 'analysis'; await changePage('extension-review');
}
async function erRenderSettings(version) {
  erSettings = await erRequest('/settings' + (version ? '?id=' + encodeURIComponent(version) : ''));
  const versions = await erRequest('/settings/versions');
  const config = erSettings.config;
  const area = (id,title,value) => `<label class="block font-medium">${title}<textarea id="${id}" class="border rounded p-2 w-full h-32 font-normal">${erEscape(value)}</textarea></label>`;
  document.getElementById('er-panel').innerHTML = `<h2 class="font-bold">基準v${erEscape(erSettings.id || '未登録')}</h2><select onchange="erRenderSettings(this.value)" class="border rounded p-2"><option value="">最新バージョン</option>${versions.map(v => `<option value="${v.id}">v${v.id} ${erEscape(v.created_at)}</option>`).join('')}</select><p class="text-sm">過去バージョンを選択して参照・コピーできます。保存は常に新しいバージョンを作り、過去の採点結果を変更しません。</p>
    ${area('er-criteria','Tutorのトーク内容の採点基準',config.criteria)}${config.scripts.map((s,i) => area(`er-script-${i}`,`${i+1}回目延長審査スクリプト`,s)).join('')}
    ${area('er-template','出力テンプレート（空欄で延長審査採点・トークスクリプト・人物像・要因分析を区切り線付きで出力。カスタム時は{{grading}} {{script}} {{profile}} {{factors}}すべてを使用）',config.template)}
    ${area('er-mapping','Notion項目マッピング(JSON)：streams / age / companyReasons / expenseConsent / classification',JSON.stringify(config.mapping,null,2))}
    <button onclick="erApplyNotionMapping()" class="border rounded p-2">CSVに合わせた標準マッピングを入力</button>
    <p class="text-sm">年齢は「生年月日」から採点当日（日本時間）の満年齢を計算します。空欄・不正日付は不明になります。ボタンで入力した後、新しいバージョンとして保存してください。</p>
    <p class="text-sm">例：{"streams":{"source":"property","name":"実際のプロパティ名"}}。本文の見出しはsourceをblockに指定。企業理由は複数選択・リレーション・箇条書き・件数のみ数え、自由文を推測で分割しません。実際の名前・型はAPI接続診断で確認してください。</p>
    ${area('er-speaker-aliases','Tutor発言者別名(JSON、Tutor番号→名前配列)。登録名と文字起こしの表記が異なる場合に設定',JSON.stringify(config.speakerAliases || {},null,2))}
    <p class="text-sm">${erTutors.map(t=>`${erEscape(t.tutor_name)}：${erEscape(t.employee_id)}`).join(' / ')}。例：{"Tutor番号":["文字起こしの実際の名前"]}。接続診断で発言者ラベルを確認できます。</p>
    ${area('er-target','ターゲット条件(JSON)',JSON.stringify(config.target,null,2))}
    ${area('er-limits','利用上限(JSON)',JSON.stringify(config.limits,null,2))}
    <button onclick="erSaveSettings()" class="bg-orange-600 text-white p-2 rounded">新しいバージョンとして保存</button><button onclick="erPreviewSettings()" class="border rounded p-2 ml-2">プレビュー</button><pre id="er-settings-preview" class="whitespace-pre-wrap text-sm"></pre>`;
}
function erApplyNotionMapping() {
  document.getElementById('er-mapping').value = JSON.stringify({
    streams: {source:'property',name:'やってみたい配信'},
    age: {source:'property',name:'生年月日',transform:'ageFromBirthDate'},
    companyReasons: {source:'property',name:'企業が良い理由'},
    expenseConsent: {source:'property',name:'実費負担への合意'},
    classification: {source:'property',name:'6分類'}
  }, null, 2);
}
function erReadSettings() {
  return { criteria: document.getElementById('er-criteria').value, scripts: [0,1,2,3].map(i => document.getElementById(`er-script-${i}`).value),
    template: document.getElementById('er-template').value, mapping: JSON.parse(document.getElementById('er-mapping').value), speakerAliases: JSON.parse(document.getElementById('er-speaker-aliases').value),
    target: JSON.parse(document.getElementById('er-target').value), prices: null, limits: JSON.parse(document.getElementById('er-limits').value) };
}
function erPreviewSettings() { try { document.getElementById('er-settings-preview').textContent = JSON.stringify(erReadSettings(),null,2); } catch { showNotification('設定JSONが不正です','error'); } }
async function erSaveSettings() {
  try { await erRequest('/settings','post',erReadSettings()); showNotification('新しい基準バージョンを保存しました','success'); await erRenderSettings(); }
  catch (error) { showNotification(error.response?.data?.error || '設定JSONを確認してください','error'); }
}
async function erDiagnose() {
  try {
    const data = await erRequest('/diagnostics','post',{ notionUrl: document.getElementById('er-notion').value.trim(), documentUrl: document.getElementById('er-doc').value.trim() });
    document.getElementById('er-diagnosis').textContent = JSON.stringify(data,null,2);
  } catch (error) { showNotification(error.response?.data?.error || '診断できませんでした','error'); }
}

// app.js initializes asynchronously; refresh once this script becomes available.
refreshExtensionReviewCapability();
