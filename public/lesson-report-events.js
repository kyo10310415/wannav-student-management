// The reports page is recreated on navigation; keep only its read controls delegated.
function handleLessonReportReadClick(event) {
  const button = event.target?.closest?.('button[data-report-read-action]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button)) return;
  if (!sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'lesson-reports') return;
  switch (button.dataset.reportReadAction) {
    case 'search': return searchLessonReports();
    case 'quick-filter':
      if (['today', 'week', 'month'].includes(button.dataset.reportPeriod)) return setQuickFilter(button.dataset.reportPeriod);
      return;
    case 'clear-filters': return clearReportFilters();
    case 'page': {
      if (!/^\d+$/.test(button.dataset.reportPage || '')) return;
      const page = Number(button.dataset.reportPage);
      if (Number.isSafeInteger(page) && page >= 0) return searchLessonReports(page);
      return;
    }
  }
}

document.addEventListener('click', handleLessonReportReadClick);
