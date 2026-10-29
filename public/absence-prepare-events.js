function handleAbsencePrepareClick(event) {
  const button = event.target?.closest?.('button[data-absence-prepare-action]');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken) return;
  if (button.dataset.absencePrepareAction === 'close') {
    if (document.getElementById('absence-request-modal')?.contains(button)) return closeAbsenceRequestModal();
    return;
  }
  if (button.dataset.absencePrepareAction !== 'open' || currentPage !== 'schedules' || !document.getElementById('content')?.contains(button)) return;
  let schedule;
  try { schedule = JSON.parse(decodeURIComponent(button.dataset.absenceSchedule || '')); } catch { return; }
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return;
  const key = schedule.unique_event_key || schedule.event_id;
  if (typeof key !== 'string' || !key) return;
  const cached = getFilteredSchedules().find(row => (row.unique_event_key || row.event_id) === key);
  if (!cached || JSON.stringify(cached) !== JSON.stringify(schedule)) return;
  return openAbsenceRequestModal(cached);
}
document.addEventListener('click', handleAbsencePrepareClick);
