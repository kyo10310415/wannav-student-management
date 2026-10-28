function handleMinutesTemplateClick(event) {
  const button = event.target?.closest?.('button[data-minutes-template-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !content?.contains(button) || !currentUser || !['admin', 'leader'].includes(currentUser.role) || !sessionToken || currentPage !== 'minutes') return;
  switch (button.dataset.minutesTemplateAction) {
    case 'open': return showMinutesTemplateModal();
    case 'close':
      if (document.getElementById('minutes-template-modal')?.contains(button)) return closeMinutesTemplateModal();
  }
}
document.addEventListener('click', handleMinutesTemplateClick);
