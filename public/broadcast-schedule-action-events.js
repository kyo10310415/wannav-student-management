// Serialize toggle and delete for the same schedule in this browser.
const pendingBroadcastScheduleActions = new Set();
function broadcastScheduleActionCurrent(state) {
  return Boolean(state && sessionToken && sessionToken === state.token && currentUser?.id === state.userId && currentUser?.role === state.role && ['admin', 'leader', 'crew'].includes(currentUser?.role) && currentPage === 'broadcast' && document.getElementById('content') === state.root && document.getElementById('schedule-list-container') === state.list && state.root?.contains(state.button) && state.list?.contains(state.button));
}
async function runBroadcastScheduleAction(action, idValue, button) {
  const id = String(idValue ?? '');
  if (!['toggle', 'delete'].includes(action) || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !button || button.disabled || button.dataset.broadcastScheduleAction !== action || button.dataset.broadcastScheduleId !== id) return;
  const state = { root: document.getElementById('content'), list: document.getElementById('schedule-list-container'), button, token: sessionToken, userId: currentUser?.id, role: currentUser?.role };
  if (!broadcastScheduleActionCurrent(state) || pendingBroadcastScheduleActions.has(id) || (typeof pendingBroadcastScheduleSaves !== 'undefined' && pendingBroadcastScheduleSaves.has(id)) || !broadcastSchedules.some(schedule => Number(schedule.id) === Number(id))) return;
  const buttons = Array.from(state.list.querySelectorAll(`button[data-broadcast-schedule-id="${id}"]`));
  if (!buttons.includes(button)) return;
  pendingBroadcastScheduleActions.add(id);
  const originalDisabled = buttons.map(control => control.disabled);
  buttons.forEach(control => { control.disabled = true; });
  try {
    if (action === 'delete' && !confirm('このスケジュールを削除しますか？\nこの操作は取り消せません。')) return;
    if (!broadcastScheduleActionCurrent(state)) return;
    const options = { headers: { Authorization: `Bearer ${state.token}` } };
    const response = action === 'toggle'
      ? await axios.post(`${API_BASE}/api/broadcast/schedules/${id}/toggle`, {}, options)
      : await axios.delete(`${API_BASE}/api/broadcast/schedules/${id}`, options);
    if (!broadcastScheduleActionCurrent(state)) return;
    if (!response.data.success || (action === 'toggle' && typeof response.data.enabled !== 'boolean')) throw new Error('Schedule action failed');
    showNotification(action === 'toggle' ? `✅ スケジュールを${response.data.enabled ? '有効' : '無効'}にしました` : '✅ スケジュールを削除しました', 'success');
    await loadSchedules();
  } catch {
    if (broadcastScheduleActionCurrent(state)) showNotification(action === 'toggle' ? 'スケジュールの切り替えに失敗しました' : 'スケジュールの削除に失敗しました', 'error');
  } finally {
    pendingBroadcastScheduleActions.delete(id);
    buttons.forEach((control, index) => { control.disabled = originalDisabled[index]; });
  }
}
function handleBroadcastScheduleActionClick(event) {
  const button = event.target?.closest?.('button[data-broadcast-schedule-action]');
  if (!button || button.disabled) return;
  if (button.dataset.broadcastScheduleAction === 'toggle') return toggleSchedule(button.dataset.broadcastScheduleId, button);
  if (button.dataset.broadcastScheduleAction === 'delete') return deleteSchedule(button.dataset.broadcastScheduleId, button);
}
document.addEventListener('click', handleBroadcastScheduleActionClick);
