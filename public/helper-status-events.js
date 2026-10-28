function handleHelperStatusClick(event) {
  const button = event.target?.closest?.('button[data-helper-status]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button)) return;
  if (!sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || currentPage !== 'helpers') return;
  if (['all', 'pending', 'accepted', 'rescheduled'].includes(button.dataset.helperStatus)) return filterHelpersByStatus(button.dataset.helperStatus);
}
document.addEventListener('click', handleHelperStatusClick);
