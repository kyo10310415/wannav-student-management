function redTestPrepareAllowed() {
  return currentUser && ['admin', 'leader'].includes(currentUser.role) && sessionToken && currentPage === 'red-list';
}
function handleRedTestPrepareClick(event) {
  const button = event.target?.closest?.('button[data-red-test-action]');
  if (!button || button.disabled || !redTestPrepareAllowed() || !document.getElementById('content')?.contains(button)) return;
  if (button.dataset.redTestAction === 'close') {
    if (document.getElementById('redlist-test-send-modal')?.contains(button)) return closeRedListTestSendModal();
    return;
  }
  if (button.dataset.redTestAction !== 'open' || !/^\d+$/.test(button.dataset.redTestId || '')) return;
  const id = Number(button.dataset.redTestId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const message = redListMessages.find(item => item.id === id);
  if (message) return openRedListTestSendModal(id, message.title);
}
function handleRedTestSenderChange(event) {
  const select = event.target?.closest?.('select[data-red-test-sender]');
  if (!select || select.disabled || !redTestPrepareAllowed() || !document.getElementById('content')?.contains(select) || !document.getElementById('redlist-test-send-modal')?.contains(select)) return;
  return onRedListTestSendSenderChange();
}
document.addEventListener('click', handleRedTestPrepareClick);
document.addEventListener('change', handleRedTestSenderChange);
