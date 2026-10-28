function handleTutorRedMonthClick(event) {
  const button = event.target?.closest?.('button[data-tutor-red-month]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button) || !currentUser || currentUser.role !== 'admin' || !sessionToken || currentPage !== 'tutor-red-list') return;
  if (button.dataset.tutorRedMonth === 'previous') return changeTutorRedListMonth(-1);
  if (button.dataset.tutorRedMonth === 'next') return changeTutorRedListMonth(1);
}
document.addEventListener('click', handleTutorRedMonthClick);
