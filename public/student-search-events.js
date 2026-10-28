function studentViewControlsAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role) && ['reservations', 'students'].includes(currentPage);
}
function handleStudentViewClick(event) {
  const button = event.target?.closest?.('button[data-student-view-action]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button) || !studentViewControlsAllowed()) return;
  switch (button.dataset.studentViewAction) {
    case 'previous-month': if (currentPage === 'reservations') return changeMonth(-1); return;
    case 'next-month': if (currentPage === 'reservations') return changeMonth(1); return;
    case 'status-tab':
      if (['active', 'preparing', 'suspended', 'graduated', 'cancelled'].includes(button.dataset.studentStatus)) return switchTab(button.dataset.studentStatus);
      return;
    case 'active-tab':
      if (['lesson', 'pro', 'permanent', 'enrolled'].includes(button.dataset.studentPlan)) return switchActiveSubTab(button.dataset.studentPlan);
      return;
    case 'clear-search':
      if (button.dataset.studentSearchView !== currentPage) return;
      studentSearchQuery = '';
      if (currentPage === 'reservations') {
        const input = document.getElementById('student-search-reservations');
        if (input) input.value = '';
        return renderStudentTable();
      }
      return renderStudentsPage();
  }
}
function handleStudentSearchInput(event) {
  const input = event.target?.closest?.('input[data-student-search-view]');
  if (!input || input.disabled || !document.getElementById('content')?.contains(input) || !studentViewControlsAllowed()) return;
  if (input.dataset.studentSearchView !== currentPage) return;
  studentSearchQuery = input.value;
  if (currentPage === 'reservations') return renderStudentTable();
  return renderStudentsCards();
}
document.addEventListener('click', handleStudentViewClick);
document.addEventListener('input', handleStudentSearchInput);
