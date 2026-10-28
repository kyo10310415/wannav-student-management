const redListDeleteRequests = new Set();
function redListDeleteContextCurrent(state) {
  return Boolean(sessionToken && sessionToken === state.token && currentUser?.id === state.userId && ['admin', 'leader'].includes(currentUser?.role) && currentPage === 'red-list' && document.getElementById('content') === state.root && state.root?.contains(state.button));
}
async function runRedListDelete(kind, idValue, button) {
  const id = String(idValue ?? '');
  if (!['message', 'sender'].includes(kind) || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !button || button.disabled || button.dataset.redDeleteAction !== kind || button.dataset.redDeleteId !== id) return;
  const root = document.getElementById('content');
  const state = { root, button, token: sessionToken, userId: currentUser?.id };
  if (!redListDeleteContextCurrent(state)) return;
  const records = kind === 'message' ? redListMessages : redListSenders;
  const record = records.find(item => Number(item.id) === Number(id));
  if (!record) return;
  const key = `${kind}:${id}`;
  if (redListDeleteRequests.has(key)) return;
  redListDeleteRequests.add(key);
  button.disabled = true;
  try {
    if (!confirm(`「${kind === 'message' ? record.title : record.name}」を削除してもよいですか？`)) return;
    if (!redListDeleteContextCurrent(state)) return;
    const path = kind === 'message' ? 'messages' : 'senders';
    const response = await axios.delete(`${API_BASE}/api/red-list/${path}/${id}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!redListDeleteContextCurrent(state)) return;
    if (!response.data.success) throw new Error('Delete failed');
    showNotification(kind === 'message' ? 'メッセージを削除しました' : '送信者を削除しました', 'success');
    if (kind === 'message') await loadRedListMessages();
    else {
      redListSenders = [];
      await loadRedListSenders();
    }
  } catch {
    if (redListDeleteContextCurrent(state)) showNotification('削除に失敗しました', 'error');
  } finally {
    redListDeleteRequests.delete(key);
    button.disabled = false;
  }
}
function handleRedListDeleteClick(event) {
  const button = event.target?.closest?.('button[data-red-delete-action]');
  if (!button || button.disabled) return;
  if (button.dataset.redDeleteAction === 'message') return deleteRedListMessage(button.dataset.redDeleteId, button);
  if (button.dataset.redDeleteAction === 'sender') return deleteRedListSender(button.dataset.redDeleteId, button);
}
document.addEventListener('click', handleRedListDeleteClick);
