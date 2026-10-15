// Shared wording; only Discord adds mentions and Markdown emphasis.
export function parseLessonReminderDate(lessonInfo) {
  const date = String(lessonInfo.lesson_date || '').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\S+))?$/);
  if (!date) return null;
  const [year, month, day] = date.slice(1,4).map(Number);
  const check = new Date(Date.UTC(year,month-1,day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month-1 || check.getUTCDate() !== day) return null;
  // E may hold only the date; J is the separate lesson_time column.
  const rawTime = date[4] || String(lessonInfo.lesson_time || '').trim();
  const time = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59) return null;
  return {
    dateKey: `${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`,
    timeKey: `${time[1].padStart(2,'0')}:${time[2]}:${time[3] || '00'}`,
    dateText: `${date[1]}/${date[2]}/${date[3]}`,
    timeText: `${time[1].padStart(2,'0')}:${time[2]}`
  };
}

export function buildLessonReminderBody(studentName, lessonInfo, { discord = false, discordId } = {}) {
  const dateTimeStr = String(lessonInfo.lesson_date || '日時未設定');
  const parsed = parseLessonReminderDate(lessonInfo);
  let dateStr = dateTimeStr, timeStr = '';
  if (parsed) {
    dateStr = parsed.dateText; timeStr = parsed.timeText;
  } else if (dateTimeStr !== '日時未設定' && dateTimeStr.includes(' ')) {
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
