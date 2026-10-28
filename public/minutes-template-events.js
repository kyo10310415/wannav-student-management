let minutesTemplateView = null;
const pendingMinutesTemplateSaves = new Set();
function minutesTemplateViewCurrent(state) {
  return Boolean(state && minutesTemplateView === state && sessionToken === state.token && currentUser && ['admin', 'leader'].includes(currentUser.role) && currentUser.id === state.userId && currentPage === 'minutes' && document.getElementById('content') === state.content && document.getElementById('minutes-template-modal') === state.modal && state.content?.contains(state.modal) && !state.modal.classList.contains('hidden'));
}
function beginMinutesTemplateView() {
  const content = document.getElementById('content');
  const modal = document.getElementById('minutes-template-modal');
  const button = document.getElementById('minutes-template-save-btn');
  if (!sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'minutes' || !content?.contains(modal) || !button || !modal.contains(button)) return null;
  minutesTemplateView = { content, modal, button, token: sessionToken, userId: currentUser.id, ready: false, saving: false, id: null };
  button.disabled = true;
  return minutesTemplateView;
}
function handleMinutesTemplateClick(event) {
  const button = event.target?.closest?.('button[data-minutes-template-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !content?.contains(button) || !currentUser || !['admin', 'leader'].includes(currentUser.role) || !sessionToken || currentPage !== 'minutes') return;
  switch (button.dataset.minutesTemplateAction) {
    case 'open': return showMinutesTemplateModal();
    case 'save':
      if (document.getElementById('minutes-template-modal')?.contains(button)) return saveMinutesTemplate();
      return;
    case 'close':
      if (document.getElementById('minutes-template-modal')?.contains(button)) return closeMinutesTemplateModal();
  }
}
document.addEventListener('click', handleMinutesTemplateClick);
