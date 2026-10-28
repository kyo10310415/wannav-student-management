function tutorReadAllowed() {
  return currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role) && sessionToken;
}
function handleTutorReadClick(event) {
  if (!tutorReadAllowed()) return;
  const backdrop = document.getElementById('satisfactionModal');
  if (event.target === backdrop && backdrop?.hasAttribute('data-tutor-satisfaction-backdrop')) return closeSatisfactionModal();
  const button = event.target?.closest?.('button[data-tutor-read-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.tutorReadAction;
  if (action === 'close-satisfaction') {
    if (backdrop?.contains(button)) return closeSatisfactionModal();
    return;
  }
  if (action === 'close-quality') {
    if (document.getElementById('tutor-minutes-quality-modal')?.contains(button)) return closeTutorMinutesQualityModal();
    return;
  }
  if (currentPage !== 'tutors' || !document.getElementById('content')?.contains(button)) return;
  switch (action) {
    case 'previous-month': return changeTutorStatsMonth(-1);
    case 'next-month': return changeTutorStatsMonth(1);
    case 'previous-absence':
      if (['admin', 'leader'].includes(currentUser.role)) return changeAbsenceStatsMonth(-1);
      return;
    case 'next-absence':
      if (['admin', 'leader'].includes(currentUser.role)) return changeAbsenceStatsMonth(1);
      return;
    case 'satisfaction':
      if (button.dataset.tutorId) return showSatisfactionModal(button.dataset.tutorId);
      return;
    case 'quality':
      if (button.dataset.tutorId) return showTutorMinutesQualityModal(button.dataset.tutorId);
  }
}
function handleTutorTeamChange(event) {
  const select = event.target?.closest?.('select[data-tutor-team-filter]');
  if (!select || select.disabled || !tutorReadAllowed() || currentPage !== 'tutors' || !document.getElementById('content')?.contains(select)) return;
  return handleTeamFilterChange(select.value);
}
document.addEventListener('click', handleTutorReadClick);
document.addEventListener('change', handleTutorTeamChange);
