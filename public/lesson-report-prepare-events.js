function reportPrepareAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role);
}
function handleReportPrepareClick(event) {
  const button = event.target?.closest?.('button[data-report-prepare-action]');
  if (!button || button.disabled || !reportPrepareAllowed()) return;
  if (button.dataset.reportPrepareAction === 'close') {
    if (document.getElementById('lessonReportModal')?.contains(button)) return closeLessonReportModal();
    return;
  }
  if (button.dataset.reportPrepareAction === 'open' && currentPage === 'today' && document.getElementById('content')?.contains(button) && button.dataset.reportStudentId && button.dataset.reportDate) {
    return showLessonReportModal(button.dataset.reportStudentId, button.dataset.reportDate, button.dataset.reportStudentName || '', button.dataset.reportTutorName || '');
  }
}
function handleReportProChange(event) {
  const select = event.target?.closest?.('select[data-report-pro-fields]');
  if (!select || select.disabled || !reportPrepareAllowed() || !document.getElementById('lessonReportModal')?.contains(select)) return;
  return toggleProFields();
}
document.addEventListener('click', handleReportPrepareClick);
document.addEventListener('change', handleReportProChange);
