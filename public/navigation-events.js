function handleNavigationClick(event) {
  const button = event.target?.closest?.('button[data-nav-page]');
  const header = document.getElementById('app')?.querySelector('header');
  if (!button || button.disabled || !header?.contains(button) || !sessionToken || !currentUser) return;
  const role = currentUser.role;
  if (!['admin', 'leader', 'crew'].includes(role)) return;
  const page = button.dataset.navPage;
  const common = ['today', 'reservations', 'helpers', 'students', 'red-list', 'extensions', 'suspensions', 'broadcast', 'tutors', 'daily-reports', 'schedules'];
  const managers = ['handover', 'funnel', 'vq-diagnosis', 'lesson-reports', 'minutes', 'lesson-contents'];
  const admins = ['users', 'database', 'tutor-red-list'];
  if (!common.includes(page) && !(managers.includes(page) && ['admin', 'leader'].includes(role)) && !(admins.includes(page) && role === 'admin')) return;
  if (page === 'minutes') { minutesCurrentStudentId = null; minutesCurrentStudentName = null; }
  return changePage(page);
}
document.addEventListener('click', handleNavigationClick);
