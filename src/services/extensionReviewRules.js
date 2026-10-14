import { createHash } from 'node:crypto';

export const PROFILE_KEYS = ['streams', 'age', 'companyReasons', 'expenseConsent', 'classification'];
export const EXTENSION_REVIEW_POLICY_VERSION = 'criteria-priority-v3';
export const DEFAULT_REVIEW_MAPPING = {
  streams: { source: 'property', name: 'やってみたい配信' },
  age: { source: 'property', name: '生年月日', transform: 'ageFromBirthDate' },
  companyReasons: { source: 'property', name: '企業が良い理由' },
  expenseConsent: { source: 'property', name: '実費負担への合意' },
  classification: { source: 'property', name: '6分類' }
};
export const DEFAULT_REVIEW_SETTINGS = {
  criteria: '', scripts: ['', '', '', ''], template: '',
  mapping: DEFAULT_REVIEW_MAPPING, speakerAliases: {},
  target: { chat: '雑談', collaboration: 'コラボ', ageMin: 30, ageMax: 34, reasonMin: 2, pride: 'プライドが高い', yes: ['Yes'], no: ['No'] },
  prices: null,
  limits: { maxTranscriptChars: 100000, maxOutputTokens: 6000, monthlyCalls: 100 }
};

export function reviewError(message, status = 400) {
  return Object.assign(new Error(message), { safe: true, status });
}

function checkKeys(value, allowed, status = 400) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw reviewError('未定義の項目または不正な構造を検出しました', status);
}

export function parseReviewUrl(value, type) {
  if (typeof value !== 'string' || value.length > 2048) throw reviewError('URLの形式が不正です');
  let url;
  try { url = new URL(value); } catch { throw reviewError('URLの形式が不正です'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw reviewError('HTTPSの正規URLを指定してください');
  if (type === 'docs') {
    const match = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]{10,})(?:\/(?:edit|view|preview))?\/?$/);
    if (url.hostname !== 'docs.google.com' || !match) throw reviewError('GoogleドキュメントURLを指定してください');
    return match[1];
  }
  if (!['notion.so', 'www.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com'].includes(url.hostname)) throw reviewError('NotionページURLを指定してください');
  const last = url.pathname.split('/').filter(Boolean).at(-1) || '';
  const match = last.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (!match) throw reviewError('NotionページIDが見つかりません');
  const id = match[1].replaceAll('-', '').toLowerCase();
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

export function validateReviewSettings(value) {
  checkKeys(value, ['criteria','scripts','template','mapping','speakerAliases','target','prices','limits']);
  if (!value || typeof value !== 'object') throw reviewError('設定が不正です');
  if (typeof value.criteria !== 'string' || value.criteria.length > 30000 || typeof value.template !== 'string' || value.template.length > 10000) throw reviewError('採点基準・テンプレートの長さが不正です');
  if (!Array.isArray(value.scripts) || value.scripts.length !== 4 || value.scripts.some(s => typeof s !== 'string' || s.length > 30000)) throw reviewError('スクリプトを4回分指定してください');
  for (const [key, entry] of Object.entries(value.mapping || {})) {
    checkKeys(entry, ['source','name','transform']);
    if (!PROFILE_KEYS.includes(key) || !['property', 'block'].includes(entry?.source) || typeof entry.name !== 'string' || entry.name.length > 100) throw reviewError('項目マッピングが不正です');
    if (entry.transform !== undefined && (key !== 'age' || entry.transform !== 'ageFromBirthDate')) throw reviewError('項目マッピングの変換が不正です');
  }
  for (const [id,names] of Object.entries(value.speakerAliases || {})) if (id.length > 100 || !Array.isArray(names) || names.length > 10 || names.some(name => typeof name !== 'string' || !name.trim() || name.length > 100)) throw reviewError('Tutor発言者別名の設定が不正です');
  const t = value.target;
  checkKeys(t, ['chat','collaboration','ageMin','ageMax','reasonMin','pride','yes','no']);
  if (!t || !['chat', 'collaboration', 'pride'].every(k => typeof t[k] === 'string' && t[k].trim()) || ![t.ageMin, t.ageMax, t.reasonMin].every(Number.isInteger) || t.ageMin < 0 || t.ageMax < t.ageMin || t.ageMax > 120 || t.reasonMin < 1 || ![t.yes, t.no].every(a => Array.isArray(a) && a.length && a.every(s => typeof s === 'string' && s.length <= 100))) throw reviewError('ターゲット条件が不正です');
  if (value.prices !== null) {
    const p = value.prices;
    checkKeys(p, ['input','cachedInput','output','cacheWrite','longInput','longCachedInput','longOutput','longThreshold','longCacheWrite']);
    if (!p || !['input', 'cachedInput', 'output'].every(k => Number.isFinite(p[k]) && p[k] >= 0)) throw reviewError('単価はUSD／100万トークンで指定してください');
    for (const key of ['cacheWrite', 'longInput', 'longCachedInput', 'longOutput', 'longThreshold','longCacheWrite']) {
      if (p[key] !== undefined && (!Number.isFinite(p[key]) || p[key] < 0)) throw reviewError('長文・キャッシュ単価が不正です');
    }
  }
  const l = value.limits;
  checkKeys(l, ['maxTranscriptChars','maxOutputTokens','monthlyCalls']);
  if (!l || !Number.isInteger(l.maxTranscriptChars) || l.maxTranscriptChars < 1000 || l.maxTranscriptChars > 200000 || !Number.isInteger(l.maxOutputTokens) || l.maxOutputTokens < 1000 || l.maxOutputTokens > 12000 || !Number.isInteger(l.monthlyCalls) || l.monthlyCalls < 1 || l.monthlyCalls > 1000) throw reviewError('利用上限が不正です');
  return value;
}

export function targetMatch(profile, target = DEFAULT_REVIEW_SETTINGS.target) {
  const available = value => value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
  const contains = (value, keyword) => {
    if (typeof value !== 'string' && !(Array.isArray(value) && value.every(v => typeof v === 'string'))) return null;
    return available(value) && String(value).trim() ? String(Array.isArray(value) ? value.join('\n') : value).includes(keyword) : null;
  };
  const age = profile.age;
  const ageKnown = typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 120;
  const reasons = profile.companyReasons;
  // Only explicit lists/numeric counts are countable. Do not infer reasons from prose punctuation.
  const reasonCount = Array.isArray(reasons) && reasons.length && reasons.every(r => typeof r === 'string' && r.trim()) ? new Set(reasons.map(r => r.trim())).size : typeof reasons === 'number' && Number.isInteger(reasons) && reasons >= 0 ? reasons : null;
  const agreement = profile.expenseConsent;
  const consent = typeof agreement === 'boolean' ? agreement : target.yes.some(v => v.toLowerCase() === String(agreement).trim().toLowerCase()) ? true : target.no.some(v => v.toLowerCase() === String(agreement).trim().toLowerCase()) ? false : null;
  const values = [contains(profile.streams, target.chat), ageKnown ? age >= target.ageMin && age <= target.ageMax : null,
    reasonCount === null ? null : reasonCount >= target.reasonMin, consent,
    contains(profile.streams, target.collaboration), contains(profile.classification, target.pride)];
  const labels = [`配信に「${target.chat}」`, `年齢${target.ageMin}〜${target.ageMax}歳`, `企業がいい理由${target.reasonMin}件以上`, '実費負担への合意', `配信に「${target.collaboration}」`, `6分類に「${target.pride}」`];
  const matched = values.filter(v => v === true).length;
  const known = values.filter(v => v !== null).length;
  return { rate: known === 6 ? Math.round(matched / 6 * 100) : null, matched, known,
    conditions: values.map((v,i) => ({ label: labels[i], state: v === null ? '不明' : v ? '一致' : '不一致' })) };
}

export function estimateReviewCost(usage, prices) {
  if (!prices || !usage) return null;
  const input = Number(usage?.input_tokens || 0), output = Number(usage?.output_tokens || 0);
  const cached = Math.min(input, Number(usage?.input_tokens_details?.cached_tokens || 0));
  const long = prices.longThreshold !== undefined && input > prices.longThreshold;
  if (long && ['longInput', 'longCachedInput', 'longOutput'].some(k => prices[k] === undefined)) return null;
  const write = Math.min(input - cached, Number(usage?.input_tokens_details?.cache_write_tokens || 0));
  const writePrice = long ? prices.longCacheWrite : prices.cacheWrite;
  if (write && writePrice === undefined) return null;
  return ((input - cached - write) * (long ? prices.longInput : prices.input) + cached * (long ? prices.longCachedInput : prices.cachedInput) + output * (long ? prices.longOutput : prices.output) + write * (writePrice || 0)) / 1000000;
}

export function reviewFingerprint(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function transcriptSpeakerLabels(transcript) {
  return [...new Set([...transcript.matchAll(/(?:^|\n)([^\n:：]{1,100})[:：][ \t]*/g)].map(match => match[1].trim()).filter(name => !/^\d+$/.test(name) && !['補足','注意','例','参考','備考'].includes(name)))];
}

function timeSeconds(value) {
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const parts = value.split(':').map(Number);
  if (parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  return parts.length === 3 ? parts[0]*3600+parts[1]*60+parts[2] : parts[0]*60+parts[1];
}

export function transcriptTurns(transcript) {
  const labels = new Set(transcriptSpeakerLabels(transcript));
  const turns = [];
  let timestamp = null, offset = 0;
  for (const line of transcript.split('\n')) {
    const time = line.trim().match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?$/);
    if (time && timeSeconds(time[1]) !== null) {
      timestamp = timeSeconds(time[1]);
      if (turns.length) {
        const speaker = turns.at(-1).speaker;
        turns.at(-1).end = offset;
        turns.push({start:offset,end:transcript.length,speaker,timestamp});
      }
    }
    const header = line.match(/^([^:：\r\n]{1,100})[:：][ \t]*/);
    if (header && labels.has(header[1].trim())) {
      if (turns.length) turns.at(-1).end = offset;
      turns.push({ start: offset, end: transcript.length, speaker: header[1].trim(), timestamp });
    }
    offset += line.length + 1;
  }
  return turns;
}

export function resolveReviewSpeakers(transcript, aliases) {
  const labels = transcriptSpeakerLabels(transcript);
  const matches = labels.filter(label => aliases.some(alias => typeof alias === 'string' && alias.trim() === label));
  if (!matches.length) throw reviewError('実施Tutorの発言者表記を確認できません。接続診断と発言者別名設定を確認してください', 409);
  return matches;
}

function checkPoint(point, transcript, metric = false, turns = []) {
  checkKeys(point, metric ? ['text','evidence','score'] : ['text','evidence'], 502);
  if (!point || typeof point.text !== 'string' || !point.text.trim() || point.text.length > 3000 || !Array.isArray(point.evidence) || !point.evidence.length || point.evidence.length > 4) throw reviewError('採点根拠の構造が不正です', 502);
  for (const e of point.evidence) {
    checkKeys(e, ['quote','speaker','timestamp'], 502);
    if (!e || typeof e.quote !== 'string' || !e.quote.trim() || e.quote.length > 500) throw reviewError('根拠引用が不正です', 502);
    for (const key of ['speaker', 'timestamp']) if (e[key] !== null && (typeof e[key] !== 'string' || e[key].length > 100)) throw reviewError('発言者・時刻の形式が不正です', 502);
    if (e.timestamp !== null && timeSeconds(e.timestamp) === null) throw reviewError('時刻の形式が不正です', 502);
    if (transcript !== undefined) {
      let index = transcript.indexOf(e.quote), found = false, occurrences = 0;
      if (index < 0) throw reviewError('文字起こしに存在しない根拠引用を検出しました', 502);
      while (index >= 0) {
        if (++occurrences > 1000) throw reviewError('根拠引用が曖昧で特定できません', 502);
        const turn = turns.find(t => t.start <= index && index + e.quote.length <= t.end);
        if ((e.speaker === null || turn?.speaker === e.speaker) && (e.timestamp === null || turn?.timestamp === timeSeconds(e.timestamp))) { found = true; break; }
        index = transcript.indexOf(e.quote, index + 1);
      }
      if (!found) throw reviewError('発言者・時刻の根拠を確認できません', 502);
    }
  }
}

export function validateReviewResult(result, transcript, speakerLabels) {
  const turns = transcript === undefined ? [] : transcriptTurns(transcript);
  checkKeys(result, ['score','bonuses','penalties','improvements','goodFactors','issues','scriptMatch','originality','summary'], 502);
  if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > 100) throw reviewError('総合評価が不正です', 502);
  for (const key of ['bonuses', 'penalties', 'improvements', 'goodFactors', 'issues']) {
    if (!Array.isArray(result[key]) || result[key].length > 15) throw reviewError('採点項目が不正です', 502);
    result[key].forEach(p => checkPoint(p, transcript, false, turns));
  }
  for (const key of ['scriptMatch', 'originality']) {
    if (!Number.isFinite(result[key]?.score) || result[key].score < 0 || result[key].score > 100) throw reviewError('一致度・オリジナリティが不正です', 502);
    checkPoint(result[key], transcript, true, turns);
  }
  checkPoint(result.summary, transcript, false, turns);
  if (speakerLabels) {
    const points = [...result.bonuses,...result.penalties,...result.improvements,...result.goodFactors,...result.issues,result.scriptMatch,result.originality,result.summary];
    if (!points.some(point => point.evidence.some(e => speakerLabels.includes(e.speaker)))) throw reviewError('選択した実施Tutorの発言を採点根拠で確認できません', 502);
  }
  return result;
}

export function reviewMarkdown(result, profile, match, template = '') {
  const bullet = points => points.length ? points.map(p => `- ${p.text}\n${p.evidence.map(e => `  > ${e.quote}${e.speaker ? `（${e.speaker}）` : ''}${e.timestamp ? ` ${e.timestamp}` : ''}`).join('\n')}`).join('\n') : '- 該当なし';
  const grading = `## 【延長審査採点】\n### 総合評価\n${result.score} / 100点\n### 加点ポイント\n${bullet(result.bonuses)}\n### 減点ポイント\n${bullet(result.penalties)}\n### 改善できた点\n${result.improvements.map((p,i) => `${i+1}. ${p.text}`).join('\n') || '該当なし'}`;
  const script = `【トークスクリプト】\n\n- **一致度：** ${result.scriptMatch.score}%\n- **オリジナリティ：** ${result.originality.score}%`;
  const person = `【生徒様の人物像】\n\n**理想のターゲット像との一致率：${match.rate === null ? '算出不可' : `${match.rate}%`}**\n\n${PROFILE_KEYS.map(k => {
    const value = profile[k];
    const display = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
      ? '不明' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join('、') : String(value);
    return `- **${({streams:'やってみたい配信',age:'年齢',companyReasons:'企業がいい理由',expenseConsent:'実費負担への合意',classification:'6分類'})[k]}：** ${display}`;
  }).join('\n')}`;
  const factors = `【要因分析】\n\n■ 良かった点\n\n${bullet(result.goodFactors)}\n\n■ 課題点\n\n${bullet(result.issues)}\n\n■ 総括\n\n${bullet([result.summary])}`;
  if (template.trim()) {
    if (!['grading', 'script', 'profile', 'factors'].every(k => template.includes(`{{${k}}}`))) throw reviewError('出力テンプレートには4つのセクション変数が必要です');
    return template.replace(/\{\{(grading|script|profile|factors)\}\}/g, (_, k) => ({ grading, script, profile: person, factors })[k]);
  }
  return [grading, script, person, factors].join('\n\n---\n\n');
}
