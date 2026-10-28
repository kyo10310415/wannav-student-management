// Stored image settings are data, never markup or executable URL schemes.
let vqImageSavePending = null;
let vqImageDeletePending = null;
function vqImageSafeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function vqImageAttribute(value) { return escapeHtml(String(value ?? '')).replace(/"/g, '&quot;'); }
function renderVQImageSetting(image) {
  const id = Number(image.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  return `<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
    <div class="flex-1"><div class="font-semibold text-gray-800">${escapeHtml(String(image.diagnosis_type ?? ''))}</div>
      <div class="text-sm text-gray-600 truncate">${escapeHtml(String(image.image_url ?? ''))}</div></div>
    <div class="flex items-center gap-2"><a ${vqImageSafeUrl(image.image_url) ? `href="${vqImageAttribute(image.image_url)}"` : ''} target="_blank" rel="noopener" class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-sm"><i class="fas fa-external-link-alt"></i></a>
      <button ${validId ? `data-vq-image-action="delete" data-vq-image-id="${id}"` : 'disabled'} class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-sm"><i class="fas fa-trash"></i></button></div></div>`;
}
function vqImageSaveCurrent(state) {
  return Boolean(vqImageSavePending === state && sessionToken === state.token && currentUser && ['admin', 'leader'].includes(currentUser.role) && currentUser.id === state.userId && currentPage === 'vq-diagnosis' && document.getElementById('content') === state.root && document.getElementById('vq-image-save-btn') === state.button && state.root?.contains(state.button));
}
function beginVQImageSave() {
  if (vqImageSavePending || vqImageDeletePending || !sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'vq-diagnosis') return null;
  const root = document.getElementById('content'), button = document.getElementById('vq-image-save-btn');
  const typeInput = document.getElementById('new-diagnosis-type'), urlInput = document.getElementById('new-image-url');
  if (!button || button.disabled || !root?.contains(button) || !root.contains(typeInput) || !root.contains(urlInput)) return null;
  const state = { root, button, typeInput, urlInput, token: sessionToken, userId: currentUser.id };
  vqImageSavePending = state;
  button.disabled = typeInput.disabled = urlInput.disabled = true;
  return state;
}
function finishVQImageSave(state) {
  if (vqImageSavePending !== state) return;
  vqImageSavePending = null;
  state.button.disabled = state.typeInput.disabled = state.urlInput.disabled = false;
}
function vqImageDeleteCurrent(state) {
  return Boolean(vqImageDeletePending === state && sessionToken === state.token && currentUser?.id === state.userId && ['admin', 'leader'].includes(currentUser?.role) && currentPage === 'vq-diagnosis' && document.getElementById('content') === state.root && state.root?.contains(state.button));
}
async function runVQImageDelete(imageId, button) {
  const id = String(imageId ?? '');
  if (vqImageSavePending || vqImageDeletePending || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !button || button.disabled || button.dataset.vqImageAction !== 'delete' || button.dataset.vqImageId !== id || !vqDiagnosisImages.some(image => Number(image.id) === Number(id))) return;
  const state = { root: document.getElementById('content'), button, token: sessionToken, userId: currentUser?.id };
  if (!sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'vq-diagnosis' || !state.root?.contains(button)) return;
  vqImageDeletePending = state;
  button.disabled = true;
  try {
    if (!confirm('この画像設定を削除しますか？') || !vqImageDeleteCurrent(state)) return;
    const response = await axios.delete(`${API_BASE}/api/vq-diagnosis/images/${id}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!vqImageDeleteCurrent(state)) return;
    if (!response.data.success) throw new Error('Image setting delete failed');
    showNotification('画像設定を削除しました', 'success');
    await renderVQDiagnosisPage();
  } catch {
    if (vqImageDeleteCurrent(state)) showNotification('画像設定の削除に失敗しました', 'error');
  } finally {
    if (vqImageDeletePending === state) vqImageDeletePending = null;
    button.disabled = false;
  }
}
function handleVQImageClick(event) {
  const button = event.target?.closest?.('button[data-vq-image-action]');
  if (button?.dataset.vqImageAction === 'delete' && !button.disabled && sessionToken && currentUser && ['admin', 'leader'].includes(currentUser.role) && currentPage === 'vq-diagnosis' && document.getElementById('content')?.contains(button)) {
    const id = button.dataset.vqImageId;
    if (/^\d+$/.test(id || '') && Number.isSafeInteger(Number(id)) && Number(id) > 0 && vqDiagnosisImages.some(image => Number(image.id) === Number(id))) return deleteVQDiagnosisImage(Number(id), button);
  }
  if (button?.dataset.vqImageAction === 'save' && button === document.getElementById('vq-image-save-btn') && !button.disabled) return saveVQDiagnosisImage();
}
document.addEventListener('click', handleVQImageClick);
