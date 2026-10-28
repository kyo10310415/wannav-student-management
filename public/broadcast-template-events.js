function handleBroadcastTemplateClick(event) {
  const button = event.target?.closest?.('button[data-broadcast-template-action]');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken || currentPage !== 'broadcast') return;
  if (button.dataset.broadcastTemplateAction === 'open') {
    if (document.getElementById('content')?.contains(button)) return showTemplatesModal();
    return;
  }
  if (button.dataset.broadcastTemplateAction === 'close') {
    const view = button.closest('[data-broadcast-template-view]');
    if (view && document.getElementById('broadcast-modal')?.contains(view)) return closeModal();
  }
}
// Shared broadcast dialogs stop bubbling; capture only this fixed namespace.
document.addEventListener('click', handleBroadcastTemplateClick, true);
