function handleDailyPrepareClick(event) {
  const button = event.target?.closest?.('button[data-daily-prepare-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken || currentPage !== 'daily-reports' || !content?.contains(button)) return;
  const modal = document.getElementById('dailyReportModal');
  switch (button.dataset.dailyPrepareAction) {
    case 'open': {
      if (!/^\d+$/.test(button.dataset.dailyPrepareId || '')) return;
      const id = Number(button.dataset.dailyPrepareId);
      if (Number.isSafeInteger(id) && id > 0 && dailyHistoryTutorAllowed(id)) return openDailyReportModal(id, button.dataset.dailyPrepareName || '', null);
      return;
    }
    case 'close':
      if (modal?.contains(button)) return closeDailyReportModal();
      return;
    case 'date': {
      if (!modal?.contains(button) || !dailyHistoryTutorAllowed(_drCurrentTutorId)) return;
      const value = button.dataset.date || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      const date = new Date(value + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return;
      document.getElementById('drModalDate').value = value;
      return _drHighlightDateBtn(button);
    }
  }
}
document.addEventListener('click', handleDailyPrepareClick);
