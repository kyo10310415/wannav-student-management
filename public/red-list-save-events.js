const redListSaveRequests = new Map();
const redListSaveViews = new WeakMap();
function invalidateRedListSaveView(modal) {
  if (modal) redListSaveViews.set(modal, {});
}
function redListSaveAllowed() {
  return sessionToken && currentUser && ['admin', 'leader'].includes(currentUser.role) && currentPage === 'red-list';
}
function beginRedListSave(kind) {
  if (!['msg', 'sender'].includes(kind) || redListSaveRequests.has(kind) || !redListSaveAllowed()) return null;
  const root = document.getElementById('content');
  const modal = document.getElementById(`redlist-${kind}-edit-modal`);
  if (!root?.contains(modal) || modal.classList.contains('hidden')) return null;
  const id = document.getElementById(`redlist-${kind}-edit-id`)?.value;
  const records = kind === 'msg' ? redListMessages : redListSenders;
  if (id !== '' && (!/^\d+$/.test(id || '') || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !records.some(record => Number(record.id) === Number(id)))) return null;
  const action = kind === 'msg' ? 'message' : 'sender';
  const button = modal.querySelector(`button[data-red-save-action="${action}"]`);
  if (!button || button.disabled) return null;
  const state = { kind, root, modal, button, token: sessionToken, userId: currentUser.id, view: redListSaveViews.get(modal) };
  redListSaveRequests.set(kind, state);
  button.disabled = true;
  return state;
}
function redListSaveResponseCurrent(state) {
  return redListSaveRequests.get(state.kind) === state && redListSaveAllowed() && sessionToken === state.token && currentUser.id === state.userId && document.getElementById('content') === state.root && document.getElementById(`redlist-${state.kind}-edit-modal`) === state.modal && redListSaveViews.get(state.modal) === state.view && !state.modal.classList.contains('hidden');
}
function finishRedListSave(state) {
  if (redListSaveRequests.get(state.kind) !== state) return;
  redListSaveRequests.delete(state.kind);
  state.button.disabled = false;
}
function handleRedListSaveClick(event) {
  const button = event.target?.closest?.('button[data-red-save-action]');
  if (!button || button.disabled || !redListSaveAllowed() || !document.getElementById('content')?.contains(button)) return;
  const action = button.dataset.redSaveAction;
  if (action === 'message' && document.getElementById('redlist-msg-edit-modal')?.contains(button)) return saveRedListMessage();
  if (action === 'sender' && document.getElementById('redlist-sender-edit-modal')?.contains(button)) return saveRedListSender();
}
document.addEventListener('click', handleRedListSaveClick);
