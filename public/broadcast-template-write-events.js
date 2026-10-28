const broadcastTemplateWriteRequests = new Set();
function broadcastTemplateWriteContext(button, view = null) {
  const content = document.getElementById('content');
  if (!button || button.disabled || !sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || currentPage !== 'broadcast') return null;
  if (view ? !document.getElementById('broadcast-modal')?.contains(view) || !view.contains(button) : !content?.contains(button)) return null;
  return { button, view, content, token: sessionToken, userId: currentUser.id, role: currentUser.role };
}
function broadcastTemplateWriteCurrent(state) {
  return Boolean(state && sessionToken === state.token && currentUser?.id === state.userId && currentUser?.role === state.role && currentPage === 'broadcast' && document.getElementById('content') === state.content && (state.view ? document.getElementById('broadcast-modal')?.contains(state.view) && state.view.contains(state.button) : state.content?.contains(state.button)));
}
async function runBroadcastTemplateSave(button) {
  if (button?.dataset.broadcastTemplateWrite !== 'save') return;
  const state = broadcastTemplateWriteContext(button);
  if (!state || broadcastTemplateWriteRequests.has('save')) return;
  const content = document.getElementById('broadcast-content')?.value?.trim();
  const imageId = document.getElementById('broadcast-image-url')?.value?.trim();
  const channelType = document.getElementById('broadcast-channel-type')?.value;
  const targetTutor = document.getElementById('broadcast-target-tutor')?.value;
  if (!content) return showNotification('メッセージ内容を入力してください', 'error');
  if (!['notice', 'tips', 'anken', 'chat'].includes(channelType) || typeof targetTutor !== 'string' || typeof imageId !== 'string') return;
  broadcastTemplateWriteRequests.add('save');
  button.disabled = true;
  try {
    const name = prompt('テンプレート名を入力してください:');
    if (!name || !name.trim() || !broadcastTemplateWriteCurrent(state)) return;
    const response = await axios.post(`${API_BASE}/api/broadcast/templates`, { name, content, imageUrl: imageId || null, channelType, targetTutor: targetTutor === 'all' ? null : targetTutor }, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!broadcastTemplateWriteCurrent(state)) return;
    if (!response.data.success) throw new Error('Template save failed');
    showNotification('✅ テンプレートを保存しました', 'success');
  } catch {
    if (broadcastTemplateWriteCurrent(state)) showNotification('テンプレートの保存に失敗しました', 'error');
  } finally {
    broadcastTemplateWriteRequests.delete('save');
    button.disabled = false;
  }
}
async function runBroadcastTemplateDelete(templateId, button) {
  const id = String(templateId ?? '');
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || button?.dataset.broadcastTemplateWrite !== 'delete' || button.dataset.broadcastTemplateId !== id) return;
  const view = button.closest('[data-broadcast-template-view]');
  const state = view && broadcastTemplateWriteContext(button, view);
  const key = `delete:${id}`;
  if (!state || broadcastTemplateWriteRequests.has(key) || !broadcastTemplates.some(template => Number(template.id) === Number(id))) return;
  broadcastTemplateWriteRequests.add(key);
  button.disabled = true;
  try {
    if (!confirm('このテンプレートを削除しますか？') || !broadcastTemplateWriteCurrent(state)) return;
    const response = await axios.delete(`${API_BASE}/api/broadcast/templates/${id}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!broadcastTemplateWriteCurrent(state)) return;
    if (!response.data.success) throw new Error('Template delete failed');
    showNotification('✅ テンプレートを削除しました', 'success');
    await showTemplatesModal();
  } catch {
    if (broadcastTemplateWriteCurrent(state)) showNotification('テンプレートの削除に失敗しました', 'error');
  } finally {
    broadcastTemplateWriteRequests.delete(key);
    button.disabled = false;
  }
}
function handleBroadcastTemplateWriteClick(event) {
  const button = event.target?.closest?.('button[data-broadcast-template-write]');
  if (!button || button.disabled) return;
  if (button.dataset.broadcastTemplateWrite === 'save') return saveTemplate(button);
  if (button.dataset.broadcastTemplateWrite === 'delete') return deleteTemplate(button.dataset.broadcastTemplateId, button);
}
// Shared dialogs stop bubbling, so handle only these fixed actions in capture.
document.addEventListener('click', handleBroadcastTemplateWriteClick, true);
