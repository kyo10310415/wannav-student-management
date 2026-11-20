export const HANDOVER_EXPORT_HEADER = ['生徒名', '担当Tutor', '引き継ぎ先Tutor', 'Notionリンク', 'Discordリンク', '学籍番号', '希望カリキュラム'];

export function classifyHandoverExport(handover, newAssignments, proAssignments) {
  const proIds = new Set(proAssignments.map(s => s.student_id));
  const data = [
    ...handover.filter(s => !proIds.has(s.student_id)).map(s => ({ ...s, type: '引き継ぎ' })),
    ...newAssignments.filter(s => !proIds.has(s.student_id)).map(s => ({ ...s, type: '新規' })),
    ...new Map(proAssignments.map(s => [s.student_id, s])).values(),
  ];
  return data.filter(s => s.handover_tutor_name?.trim()).map(s => ({ ...s, type: proIds.has(s.student_id) ? 'PROプラン' : s.type }));
}

export function buildHandoverExportLists(rows) {
  const values = [], sectionRows = [], headerRows = [];
  for (const category of ['引き継ぎ', '新規', 'PROプラン']) {
    if (values.length) values.push([]);
    sectionRows.push(values.length); values.push([category]);
    headerRows.push(values.length); values.push(HANDOVER_EXPORT_HEADER);
    const members = rows.filter(s => s.type === category);
    if (!members.length) values.push(['該当なし']);
    for (const s of members) values.push([s.name || '', s.homeroom_tutor || '', s.handover_tutor_name || '',
      s.notion_url || '', s.discord_url || '', s.student_id || '', (s.desired_curricula || []).join('\n')]);
  }
  return { values, sectionRows, headerRows };
}
