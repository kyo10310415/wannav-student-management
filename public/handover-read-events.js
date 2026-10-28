function handoverReadAllowed() {
  return currentUser && ['admin', 'leader'].includes(currentUser.role) && sessionToken && currentPage === 'handover';
}
function handleHandoverReadClick(event) {
  const control = event.target?.closest?.('[data-handover-read-action]');
  if (!control || control.disabled || !document.getElementById('content')?.contains(control) || !sessionToken || !currentUser || currentPage !== 'handover') return;
  if (control.dataset.handoverReadAction === 'back-today') {
    if (['admin', 'leader', 'crew'].includes(currentUser.role)) return changePage('today');
    return;
  }
  if (!handoverReadAllowed()) return;
  switch (control.dataset.handoverReadAction) {
    case 'reload': return renderHandoverPage();
    case 'tab':
      if (['handover', 'new'].includes(control.dataset.handoverTab)) return handoverSwitchTab(control.dataset.handoverTab);
      return;
    case 'sort':
      if (['student_id', 'name', 'lesson_progress', 'homeroom_tutor', 'expected_progress'].includes(control.dataset.handoverColumn)) return handoverSort(control.dataset.handoverColumn);
      return;
    case 'sort-new':
      if (['lesson_start_date', 'student_id', 'name', 'lesson_progress', 'homeroom_tutor', 'expected_progress'].includes(control.dataset.handoverColumn)) return newAssignSort(control.dataset.handoverColumn);
  }
}
function handleHandoverReadChange(event) {
  const select = event.target?.closest?.('select[data-handover-read-filter]');
  if (!select || select.disabled || !document.getElementById('content')?.contains(select) || !handoverReadAllowed()) return;
  switch (select.dataset.handoverReadFilter) {
    case 'handover': return handoverApplyFilter();
    case 'new': return newAssignApplyFilter();
    case 'month':
      if (['current', 'next'].includes(select.value)) return newAssignChangeMonth(select.value);
  }
}
document.addEventListener('click', handleHandoverReadClick);
document.addEventListener('change', handleHandoverReadChange);
