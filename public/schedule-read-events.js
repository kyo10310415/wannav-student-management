function scheduleReadControlsAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role) && currentPage === 'schedules';
}
function handleScheduleReadClick(event) {
  const button = event.target?.closest?.('button[data-schedule-read-action]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button) || !scheduleReadControlsAllowed()) return;
  switch (button.dataset.scheduleReadAction) {
    case 'previous-month': return changeScheduleMonth(-1);
    case 'next-month': return changeScheduleMonth(1);
    case 'tab':
      if (['admin', 'leader'].includes(currentUser.role) && ['confirmed', 'pending'].includes(button.dataset.scheduleTab)) return handleScheduleTabChange(button.dataset.scheduleTab);
      return;
    case 'view':
      if (['list', 'calendar'].includes(button.dataset.scheduleView)) return toggleScheduleViewMode(button.dataset.scheduleView);
      return;
    case 'reload': return renderSchedulesPage();
    case 'clear': return clearScheduleFilters();
  }
}
function handleScheduleReadChange(event) {
  const select = event.target?.closest?.('select[data-schedule-read-filter]');
  if (!select || select.disabled || !document.getElementById('content')?.contains(select) || !scheduleReadControlsAllowed()) return;
  switch (select.dataset.scheduleReadFilter) {
    case 'keyword':
      if (['all', 'ロープレ', '1on1', 'チームMTG', 'チーム研修', '全Tutor MTG'].includes(select.value)) return handleKeywordFilterChange(select.value);
      return;
    case 'date-range':
      if (['all', 'this_week', 'next_week', 'this_month', 'next_month'].includes(select.value)) return handleDateRangeFilterChange(select.value);
      return;
    case 'leader': return handleLeaderFilterChange(select.value);
    case 'attendee': return handleAttendeeFilterChange(select.value);
  }
}
document.addEventListener('click', handleScheduleReadClick);
document.addEventListener('change', handleScheduleReadChange);
