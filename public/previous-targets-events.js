function handlePreviousTargetsClick(event) {
  const button = event.target?.closest?.('button[data-previous-targets-action]');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken) return;
  if (button.dataset.previousTargetsAction === 'close') {
    if (document.getElementById('previous-lesson-targets-modal')?.contains(button)) return closePreviousLessonTargetsModal();
    return;
  }
  if (button.dataset.previousTargetsAction !== 'open' || currentPage !== 'today' || !document.getElementById('content')?.contains(button)) return;
  if (button.dataset.studentId && button.dataset.lessonDate) return showPreviousLessonTargets(button.dataset.studentId, button.dataset.lessonDate);
}
document.addEventListener('click', handlePreviousTargetsClick);
