function handleTodayDateClick(event) {
  const button = event.target?.closest?.('button[data-today-action]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button)) return;
  if (!sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || currentPage !== 'today') return;
  switch (button.dataset.todayAction) {
    case 'previous': return changeLessonDate(-1);
    case 'next': return changeLessonDate(1);
    case 'today': return resetToToday();
  }
}
document.addEventListener('click', handleTodayDateClick);
