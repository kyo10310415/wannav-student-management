let broadcastScheduleEditState = null;
const pendingBroadcastScheduleSaves = new Set();
function broadcastScheduleContextCurrent(state) {
  return Boolean(state && broadcastScheduleEditState === state && sessionToken === state.token && currentUser?.id === state.userId && ['admin', 'leader', 'crew'].includes(currentUser?.role) && currentPage === 'broadcast' && document.getElementById('content') === state.content && document.getElementById('broadcast-modal') === state.modal && state.modal?.contains(state.editor));
}
function registerBroadcastScheduleEditor(id) {
  const state = { id, key: id == null ? 'new' : String(id), content: document.getElementById('content'), modal: document.getElementById('broadcast-modal'), editor: document.getElementById('broadcast-schedule-editor'), token: sessionToken, userId: currentUser?.id };
  state.button = state.editor?.querySelector('button[data-broadcast-schedule-save]');
  broadcastScheduleEditState = state;
  if (state.button) state.button.disabled = pendingBroadcastScheduleSaves.has(state.key);
}
function beginBroadcastScheduleSave(id) {
  const state = broadcastScheduleEditState;
  if (!broadcastScheduleContextCurrent(state) || state.id !== id || !state.button || state.button.disabled || pendingBroadcastScheduleSaves.has(state.key) || (typeof pendingBroadcastScheduleActions !== 'undefined' && pendingBroadcastScheduleActions.has(state.key))) return null;
  if (id != null && (!Number.isSafeInteger(id) || id <= 0 || !broadcastSchedules.some(row => Number(row.id) === id))) return null;
  pendingBroadcastScheduleSaves.add(state.key);
  state.button.disabled = true;
  return state;
}
function finishBroadcastScheduleSave(state) {
  pendingBroadcastScheduleSaves.delete(state.key);
  const current = broadcastScheduleEditState;
  if (broadcastScheduleContextCurrent(current) && current.key === state.key) current.button.disabled = false;
}
function handleBroadcastScheduleSaveClick(event) {
  const button = event.target?.closest?.('button[data-broadcast-schedule-save]');
  const state = broadcastScheduleEditState;
  if (!button || button.disabled || !broadcastScheduleContextCurrent(state) || button !== state.button) return;
  return saveSchedule(state.id);
}
// The shared modal stops bubbling; capture handles only this exact save button.
document.addEventListener('click', handleBroadcastScheduleSaveClick, true);
