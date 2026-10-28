function redListPrepareAllowed() {
  return sessionToken && currentUser && ['admin', 'leader'].includes(currentUser.role) && currentPage === 'red-list';
}
function redListPrepareId(value) {
  if (!/^\d+$/.test(value || '')) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function handleRedListPrepareClick(event) {
  const button = event.target?.closest?.('button[data-red-prepare-action]');
  if (!button || button.disabled || !redListPrepareAllowed() || !document.getElementById('content')?.contains(button)) return;
  const messageModal = document.getElementById('redlist-msg-edit-modal');
  const senderModal = document.getElementById('redlist-sender-edit-modal');
  switch (button.dataset.redPrepareAction) {
    case 'message-new': return openRedListMessageModal();
    case 'message-edit': {
      const id = redListPrepareId(button.dataset.redPrepareId);
      if (id !== null) return openRedListMessageModal(id);
      return;
    }
    case 'message-close':
      if (messageModal?.contains(button)) return closeRedListMessageModal();
      return;
    case 'image-remove':
      if (messageModal?.contains(button)) return removeRedListMessageImage();
      return;
    case 'sender-new': return openRedListSenderModal();
    case 'sender-edit': {
      const id = redListPrepareId(button.dataset.redPrepareId);
      if (id !== null) return openRedListSenderModal(id);
      return;
    }
    case 'sender-close':
      if (senderModal?.contains(button)) return closeRedListSenderModal();
  }
}
function handleRedListPrepareImageChange(event) {
  const input = event.target?.closest?.('input[data-red-prepare-image]');
  if (!input || input.disabled || !redListPrepareAllowed() || !document.getElementById('content')?.contains(input) || !document.getElementById('redlist-msg-edit-modal')?.contains(input)) return;
  return onRedListImageSelected(input);
}
document.addEventListener('click', handleRedListPrepareClick);
document.addEventListener('change', handleRedListPrepareImageChange);
