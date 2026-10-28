function helperPrepareAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role);
}
function handleHelperPrepareClick(event) {
  if (!helperPrepareAllowed()) return;
  const modal = document.getElementById('helper-request-modal');
  const link = event.target?.closest?.('a[data-helper-prepare-link]');
  if (link && modal?.contains(link)) return;
  const control = event.target?.closest?.('[data-helper-prepare-action]');
  if (!control || control.disabled) return;
  if (control.dataset.helperPrepareAction === 'open') {
    if (currentPage === 'reservations' && document.getElementById('content')?.contains(control)) return openHelperRequestModal();
    return;
  }
  if (!modal?.contains(control)) return;
  switch (control.dataset.helperPrepareAction) {
    case 'close': return closeHelperRequestModal();
    case 'select':
      if (control.dataset.helperStudentId) return selectLesson(control.dataset.helperStudentId);
      return;
    case 'confirm': return showHelperRequestConfirmation();
    case 'back': return showHelperRequestForm();
  }
}
function handleHelperPrepareDateChange(event) {
  const input = event.target?.closest?.('input[data-helper-prepare-date]');
  if (!input || input.disabled || !helperPrepareAllowed() || !document.getElementById('helper-request-modal')?.contains(input)) return;
  return loadLessonsForDate();
}
function handleHelperPrepareSearchInput(event) {
  const input = event.target?.closest?.('input[data-helper-prepare-search]');
  if (!input || input.disabled || !helperPrepareAllowed() || !document.getElementById('helper-request-modal')?.contains(input)) return;
  return filterLessons();
}
document.addEventListener('click', handleHelperPrepareClick);
document.addEventListener('change', handleHelperPrepareDateChange);
document.addEventListener('input', handleHelperPrepareSearchInput);
