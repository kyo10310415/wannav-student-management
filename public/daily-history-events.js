function dailyHistoryTutorAllowed(id) {
  if (!currentUser || !sessionToken) return false;
  if (['admin', 'leader'].includes(currentUser.role)) return true;
  // Match the existing crew row visibility; the API independently checks authenticated tutor_id.
  return currentUser.role === 'crew' && dailyReportTutors.some(t => String(t.tutor_id) === String(id) && t.tutor_name === (currentUser.tutorName || currentUser.email));
}
function handleDailyHistoryClick(event) {
  const button = event.target?.closest?.('button[data-daily-history-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken || currentPage !== 'daily-reports' || !content?.contains(button)) return;
  const action = button.dataset.dailyHistoryAction;
  const modal = document.getElementById('dailyReportHistoryModal');
  if (action === 'close') {
    if (modal?.contains(button)) return closeDailyReportHistory();
    return;
  }
  if (!/^\d+$/.test(button.dataset.dailyTutorId || '')) return;
  const id = Number(button.dataset.dailyTutorId);
  if (!Number.isSafeInteger(id) || id <= 0 || !dailyHistoryTutorAllowed(id)) return;
  if (action === 'open') return openDailyReportHistory(id, button.dataset.dailyTutorName || '');
  if (action === 'page' && modal?.contains(button) && id === dailyReportViewTutorId) {
    if (!/^\d+$/.test(button.dataset.dailyOffset || '')) return;
    const offset = Number(button.dataset.dailyOffset);
    if (Number.isSafeInteger(offset) && offset >= 0) return loadDailyReportHistory(id, offset);
  }
}
document.addEventListener('click', handleDailyHistoryClick);
