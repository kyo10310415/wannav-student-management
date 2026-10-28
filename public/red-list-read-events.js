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
  const select = event.target?.closest?.('select[data-red-list-history-month]');
  if (!select || select.disabled || !document.getElementById('content')?.contains(select) || !redListReadAllowed()) return;
  if (select.value === '' || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(select.value)) return loadRedListHistoryData();
}
document.addEventListener('click', handleRedListReadClick);
document.addEventListener('change', handleRedListHistoryMonthChange);
