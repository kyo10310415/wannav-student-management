function studentFilterEventsAllowed() {
  return sessionToken && currentUser && ['admin', 'leader', 'crew'].includes(currentUser.role) && currentPage === 'students';
}
function handleStudentFilterClick(event) {
  if (!studentFilterEventsAllowed()) return;
  const content = document.getElementById('content');
  const modal = document.getElementById('filter-modal');
  if (event.target === modal && content?.contains(modal)) return closeFilterModal();
  const button = event.target?.closest?.('button[data-student-filter-action]');
  if (!button || button.disabled || !content?.contains(button)) return;
  const column = button.dataset.studentFilterColumn;
  switch (button.dataset.studentFilterAction) {
    case 'sort':
      if (['student_id', 'name', 'status', 'contract_plan', 'character_name', 'homeroom_tutor', 'lesson_progress', 'lesson_start_date', 'continued_months', 'pro_plan_start_date', 'pro_plan_continued_months', 'result_overall', 'wanami_usage', 'result_absence'].includes(column)) return toggleSort(column);
      return;
    case 'open':
      if (['student_id', 'name', 'status', 'contract_plan', 'character_name', 'homeroom_tutor', 'result_overall'].includes(column)) return toggleFilter(column);
      return;
    case 'survey': return toggleSurveyFilter();
    case 'clear-all': return clearAllFilters();
    case 'close': if (modal?.contains(button)) return closeFilterModal(); return;
    case 'apply': if (modal?.contains(button)) return applyFilter(); return;
    case 'clear': if (modal?.contains(button)) return clearFilter(); return;
  }
}
function handleStudentFilterInput(event) {
  const input = event.target?.closest?.('input[data-student-filter-search]');
  const modal = document.getElementById('filter-modal');
  if (!input || input.disabled || !studentFilterEventsAllowed() || !document.getElementById('content')?.contains(modal) || !modal?.contains(input)) return;
  return filterOptions();
}
function handleStudentFilterChoice(event) {
  const input = event.target?.closest?.('input[data-student-filter-choice]');
  const modal = document.getElementById('filter-modal');
  if (!input || input.disabled || !input.checked || !studentFilterEventsAllowed() || !document.getElementById('content')?.contains(modal) || !modal?.contains(input)) return;
  return updateSearchInput(input.dataset.studentFilterChoice);
}
document.addEventListener('click', handleStudentFilterClick);
document.addEventListener('input', handleStudentFilterInput);
document.addEventListener('change', handleStudentFilterChoice);
