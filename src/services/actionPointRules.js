export const ACTION_RULES = [
  ['satisfaction', '満足度', '当月の最新回答が7点以下'],
  ['absence', '無断キャンセル', '当月に1回以上'],
  ['survey', 'アンケート未回答', '前月に実施済みレッスンがあり、前月の満足度アンケートが未回答'],
  ['reschedule', '生徒都合リスケ', '当月に1回以上'],
  ['reservation', '予約不足', '当月10日以降の初回判定で予約が2回未満（固定）'],
  ['chat_frequency', 'チャット頻度', '直近14日間に本人の投稿が0件'],
  ['chat_quality', 'チャット品質', '直近30日間に必要な回答・情報不足で停滞した別々の場面が2回以上'],
  ['wanami', 'わなみさん利用', '前月の利用が0回'],
  ['x', 'X活動頻度', '直近14日間の投稿が0件'],
  ['youtube', 'YouTube活動頻度', '直近30日間の公開動画・配信が0件'],
  ['attendance', 'レッスン実施率', '前月の実施が月2回未満（実施回数÷2）'],
  ['video', '動画教材', '直近14日間に最終視聴日時がない'],
  ['mission', 'ミッション完了率', '期限到来課題の完了率80%未満（実績連携待ち）'],
  ['dependency', '先生への依存度', '直近30日間に合意した本人の行動がTutorの判断・代行待ちで停止した別々の場面が2回以上'],
  ['handover', '担当Tutor変更', '前月末と現在の担当Tutorが異なる（未設定からの初回割り振りは除外）']
].map(([key, label, criterion]) => ({ key, label, criterion }));

export function summarizeActionPoints(items) {
  const evaluated = items.filter(item => item.status === 'evaluated');
  const total = evaluated.reduce((n, item) => n + (item.point === 1 ? 1 : 0), 0);
  const count = evaluated.length;
  const ratio = count ? total / count : null;
  return { items, total, evaluated: count, ratio, rank: ratio === null ? 'unknown' : total * 10 >= count * 6 ? 'high' : total * 10 >= count * 3 ? 'middle' : 'none' };
}

export function actionMonth(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}

export function actionPeriods(now = new Date()) {
  const month = actionMonth(now);
  const start = new Date(`${month}-01T00:00:00+09:00`);
  const previous = actionMonth(new Date(start.getTime() - 1));
  return { month, previous, start, previousStart: new Date(`${previous}-01T00:00:00+09:00`),
    fourteen: new Date(now.getTime() - 14 * 86400000), thirty: new Date(now.getTime() - 30 * 86400000) };
}

// Model output is evidence, never executable instructions. Require two separate
// incidents and validate every cited message against the fetched conversation.
export function validateChatEvaluation(value, messages, studentDiscordId) {
  const index = new Map(messages.map(m => [String(m.id), m]));
  const output = {};
  for (const key of ['chat_quality', 'dependency']) {
    const result = value?.[key];
    if (!result || typeof result.sufficient !== 'boolean' || !Array.isArray(result.incidents)) throw new Error('Invalid AI evaluation');
    const used = new Set();
    const incidents = result.incidents.map(incident => {
      if (typeof incident.reason !== 'string' || !incident.reason.trim() || incident.reason.length > 1000 || !Array.isArray(incident.message_ids) || !incident.message_ids.length) throw new Error('Invalid AI evidence');
      const ids = [...new Set(incident.message_ids.map(String))];
      if (ids.some(id => !index.has(id) || used.has(id)) || !ids.some(id => index.get(id).authorId === studentDiscordId)) throw new Error('Invalid AI evidence');
      ids.forEach(id => used.add(id));
      return { reason: incident.reason, links: ids.map(id => index.get(id).url) };
    });
    output[key] = { sufficient: result.sufficient, point: result.sufficient && incidents.length >= 2 ? 1 : 0, incidents };
  }
  return output;
}
