// Row and nested controls share one delegate so a nested action never opens the row too.
function handleMinutesReadClick(event) {
  const control = event.target?.closest?.('[data-minutes-read-action]');
  if (!control || control.disabled || !currentUser || !['admin', 'leader'].includes(currentUser.role) || !sessionToken) return;
  const content = document.getElementById('content');
  if (!content?.contains(control)) return;
  const action = control.dataset.minutesReadAction;
  if (action === 'open-student') {
    if (['students', 'reservations', 'today'].includes(currentPage) && control.dataset.minutesStudentId) {
      return openMinutesForStudent(control.dataset.minutesStudentId, control.dataset.minutesStudentName || '');
    }
    return;
  }
  if (currentPage !== 'minutes') return;
  switch (action) {
    case 'search': return minutesSearchStudent();
    case 'all-students':
      minutesCurrentStudentId = null;
      minutesCurrentStudentName = null;
      return renderMinutesPage();
    case 'back-students': return changePage('students');
    case 'select-student':
      if (!control.dataset.minutesStudentId) return;
      minutesCurrentStudentId = control.dataset.minutesStudentId;
      minutesCurrentStudentName = control.dataset.minutesStudentName || '';
      return renderMinutesPage();
    case 'detail': {
      if (!/^\d+$/.test(control.dataset.minutesId || '')) return;
      const id = Number(control.dataset.minutesId);
      if (Number.isSafeInteger(id) && id > 0) return openMinutesDetail(id);
      return;
    }
    case 'delete': {
      if (!/^[1-9]\d*$/.test(control.dataset.minutesId || '')) return;
      const id = Number(control.dataset.minutesId);
      if (Number.isSafeInteger(id)) return deleteMinutes(id, control);
      return;
    }
    case 'detail-tab':
      if (document.getElementById('minutes-detail-modal')?.contains(control) && ['text', 'quality'].includes(control.dataset.minutesTab)) return switchMinutesDetailTab(control.dataset.minutesTab);
      return;
    case 'close-detail':
      if (document.getElementById('minutes-detail-modal')?.contains(control)) return closeMinutesModal();
  }
}
document.addEventListener('click', handleMinutesReadClick);
