export const REPLY_ALERT_DELAY_MS = 12 * 60 * 60 * 1000;

export async function fetchReplyRecoveryMessages(fetchPage, cursor) {
  let before;
  const messages = [];
  while (true) {
    const batch = await fetchPage({ limit: 100, ...(before ? { before } : {}), cache: false });
    if (!batch.size) break;
    const sorted = [...batch.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    messages.push(...sorted.filter(message => BigInt(message.id) > BigInt(cursor)));
    if (BigInt(sorted[0].id) <= BigInt(cursor) || batch.size < 100) break;
    before = sorted[0].id;
  }
  return messages.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
}

export function classifyReplyMessage(message, studentDiscordId, staffIds) {
  if (message.author?.bot) return 'ignore';
  if (message.author?.id === studentDiscordId) return 'student';
  return staffIds.has(message.author?.id) ? 'staff' : 'ignore';
}

export function buildReplyAlert(row) {
  const date = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium'
  }).format(new Date(row.posted_at));
  // Names must not create unintended Discord mentions.
  const safe = value => String(value || '未設定').replace(/@/g, '＠').replace(/[\r\n]/g, ' ');
  return `以下の生徒様への返信が出来てない可能性があります。確認してください\n\n生徒名：${safe(row.student_name)}\n担当Tutor：${safe(row.tutor_name)}\nメッセージの日時：${date}（日本時間）\nメッセージリンク：https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}`;
}
