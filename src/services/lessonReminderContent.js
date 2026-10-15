// Shared wording; only Discord adds mentions and Markdown emphasis.
export function buildLessonReminderBody(studentName, lessonInfo, { discord = false, discordId } = {}) {
  const dateTimeStr = String(lessonInfo.lesson_date || '日時未設定');
  let dateStr = dateTimeStr, timeStr = '';
  if (dateTimeStr !== '日時未設定' && dateTimeStr.includes(' ')) {
    const parts = dateTimeStr.split(' ');
    dateStr = parts[0]; timeStr = parts[1];
    if (timeStr && timeStr.split(':').length === 3) timeStr = timeStr.split(':').slice(0, 2).join(':');
  }
  const label = text => discord ? `**${text}**` : text;
  let message = discord && discordId ? `<@${discordId}>\n\n` : '';
  message += `${studentName}様\n\n`;
  message += '明日はレッスンの予定になっております！\n忘れずにご参加ください！\nもしご都合が悪い場合は、必ず担任の先生にご連絡ください！\n\n';
  message += `${label('日時')}: ${timeStr ? `${dateStr} ${timeStr}` : dateTimeStr}\n`;
  if (lessonInfo.tutor_name) message += `${label('担任講師')}: ${lessonInfo.tutor_name}\n`;
  if (lessonInfo.meet_link) message += `${label('Google Meetリンク')}: ${lessonInfo.meet_link}\n`;
  return message + '\nよろしくお願いいたします！';
}
