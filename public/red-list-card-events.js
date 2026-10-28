function handleRedListCardEvent(event) {
  const control = event.target?.closest?.('[data-red-list-card-action]');
  const content = document.getElementById('content');
  if (!control || control.disabled || !content?.contains(control) || !sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'red-list') return;
  const action = control.dataset.redListCardAction;
  if ((['status', 'assigned'].includes(action) ? 'change' : 'click') !== event.type) return;
  const id = control.dataset.redListStudentId;
  const month = control.dataset.redListYearMonth;
  if (!id || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '')) return;
  const item = [...currentRedListData, ...historyRedListData].find(row => row.student_id === id && row.year_month === month);
  if (!item) return;
  if (action === 'status' && ['未対応', '対応中', '対応済み'].includes(control.value)) return updateRedListStatus(id, month, control.value);
  if (action === 'assigned') return updateRedListAssigned(id, month, control.value);
  if (action === 'send-prepare') {
    const student = students.find(row => row.student_id === id);
    return openRedListDiscordModal(id, student ? student.name : item.student_name || '不明', month);
  }
  if (action === 'ex') return toggleExRank(id, month, item.ex_rank === true || item.final_ex_rank === true);
}
document.addEventListener('click', handleRedListCardEvent);
document.addEventListener('change', handleRedListCardEvent);
