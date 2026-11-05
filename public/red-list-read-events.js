function redListReadAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role) && currentPage === 'red-list';
}
function handleRedListReadClick(event) {
  const button = event.target?.closest?.('button[data-red-list-read-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !content?.contains(button) || !redListReadAllowed()) return;
  switch (button.dataset.redListReadAction) {
    case 'tab':
      if (['current', 'history', 'messages', 'senders'].includes(button.dataset.redListTab)) return switchRedListTab(button.dataset.redListTab);
      return;
    case 'score': {
      const id = button.dataset.redListStudentId;
      if (id && content.contains(document.getElementById(`score-breakdown-${id}`))) return showScoreBreakdown(id);
      return;
    }
    case 'log': {
      const id = button.dataset.redListStudentId;
      const month = button.dataset.redListYearMonth;
      if (id && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '') && content.contains(document.getElementById(`rl-log-detail-${id}`))) return toggleRedListLogDetail(id, month);
    }
  }
}
function handleRedListHistoryMonthChange(event) {
  const select = event.target?.closest?.('select[data-red-list-history-month]') || event.target?.closest?.('input[data-red-list-history-month]');
  if (!select || select.disabled || !document.getElementById('content')?.contains(select) || !redListReadAllowed()) return;
  if (select.value === '' || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(select.value)) return loadRedListHistoryData();
}
document.addEventListener('click', handleRedListReadClick);
document.addEventListener('change', handleRedListHistoryMonthChange);

function handleActionPointFilterChange(event) {
  const select = event.target?.closest?.('select[data-action-point-filter]');
  if (!select || select.disabled || !redListReadAllowed() || !document.getElementById('content')?.contains(select)) return;
  if (!['action-point-status-filter', 'action-point-plan-filter'].includes(select.id) || !Array.from(select.options).some(option => option.value === select.value)) return;
  if (currentRedListTab === 'current') renderRedListCurrentList();
  else if (currentRedListTab === 'history') renderRedListHistoryList();
  updateRedListStats();
}
document.addEventListener('change', handleActionPointFilterChange);

function handleActionPointTrendClick(event) {
  const button = event.target?.closest?.('button[data-action-point-trend-student], button[data-action-point-trend-close]');
  const root = document.getElementById('content');
  if (!button || button.disabled || !root?.contains(button) || currentPage !== 'students' || !sessionToken || !['admin', 'leader', 'crew'].includes(currentUser?.role)) return;
  if (button.hasAttribute('data-action-point-trend-close')) {
    document.getElementById('action-point-trend-modal')?.remove();
    actionPointTrendGeneration++;
    return;
  }
  const studentId = button.dataset.actionPointTrendStudent;
  if (students.some(row => row.student_id === studentId)) return openStudentActionPointTrend(studentId);
}
document.addEventListener('click', handleActionPointTrendClick);
