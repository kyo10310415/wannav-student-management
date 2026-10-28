// Protected previews use header authentication and memory-only URLs.
const authenticatedBroadcastImages = new Map();
function clearBroadcastAuthenticatedImage(image, wrapper) {
  if (!image) return;
  const state = authenticatedBroadcastImages.get(image);
  if (state?.objectUrl) URL.revokeObjectURL(state.objectUrl);
  authenticatedBroadcastImages.delete(image);
  image.removeAttribute('src');
  (wrapper || state?.wrapper)?.classList.add('hidden');
}
function clearBroadcastImagesWithin(root) {
  if (!root) return;
  for (const [image] of authenticatedBroadcastImages) if (root.contains(image)) clearBroadcastAuthenticatedImage(image);
}
function clearAllBroadcastAuthenticatedImages() {
  for (const [image] of authenticatedBroadcastImages) clearBroadcastAuthenticatedImage(image);
}
function beginBroadcastImageUpdate(image, wrapper) {
  clearBroadcastAuthenticatedImage(image, wrapper);
  if (!image?.isConnected || !sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || currentPage !== 'broadcast') return null;
  const state = { token: sessionToken, userId: currentUser.id, root: document.getElementById('content'), wrapper, objectUrl: null };
  authenticatedBroadcastImages.set(image, state);
  return state;
}
function broadcastImageUpdateCurrent(image, state) {
  return Boolean(state && authenticatedBroadcastImages.get(image) === state && image.isConnected && sessionToken === state.token && currentUser?.id === state.userId && ['admin', 'leader', 'crew'].includes(currentUser?.role) && currentPage === 'broadcast' && document.getElementById('content') === state.root);
}
function showBroadcastLocalImage(image, blob, state) {
  if (!broadcastImageUpdateCurrent(image, state)) return false;
  state.objectUrl = URL.createObjectURL(blob);
  image.src = state.objectUrl;
  state.wrapper?.classList.remove('hidden');
  return true;
}
async function loadBroadcastAuthenticatedImage(image, imageId, wrapper) {
  const state = beginBroadcastImageUpdate(image, wrapper);
  if (!state) return false;
  const id = String(imageId ?? '');
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) { clearBroadcastAuthenticatedImage(image, wrapper); return false; }
  try {
    const response = await axios.get(`${API_BASE}/api/broadcast/images/${encodeURIComponent(id)}`, { responseType: 'blob', headers: { Authorization: `Bearer ${state.token}`, 'Cache-Control': 'no-cache' } });
    if (!broadcastImageUpdateCurrent(image, state)) {
      if (authenticatedBroadcastImages.get(image) === state) clearBroadcastAuthenticatedImage(image, wrapper);
      return false;
    }
    return showBroadcastLocalImage(image, response.data, state);
  } catch {
    if (authenticatedBroadcastImages.get(image) === state) clearBroadcastAuthenticatedImage(image, wrapper);
    return false;
  }
}
async function uploadBroadcastPreviewImage(event, prefix) {
  if (!['broadcast', 'schedule'].includes(prefix)) return;
  const input = document.getElementById(`${prefix}-image-file`);
  if (!input || event.target !== input || input.disabled || !input.isConnected) return;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return showNotification('画像ファイルが大きすぎます（最大8MB）', 'error');
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) return showNotification('対応していないファイル形式です', 'error');
  const image = document.getElementById(`${prefix}-image-preview-img`), wrapper = document.getElementById(`${prefix}-image-preview`);
  const state = beginBroadcastImageUpdate(image, wrapper);
  if (!state) return;
  const status = document.getElementById(`${prefix}-image-upload-status`);
  const field = document.getElementById(prefix === 'broadcast' ? 'broadcast-image-url' : 'schedule-image-id');
  if (!status || !field) { clearBroadcastAuthenticatedImage(image, wrapper); return; }
  input.disabled = true;
  status.className = 'mt-2 text-blue-600'; status.textContent = 'アップロード中...'; status.classList.remove('hidden');
  try {
    const form = new FormData(); form.append('image', file);
    const response = await axios.post(`${API_BASE}/api/broadcast/upload-image`, form, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!broadcastImageUpdateCurrent(image, state)) {
      if (authenticatedBroadcastImages.get(image) === state) clearBroadcastAuthenticatedImage(image, wrapper);
      return;
    }
    if (!response.data.success || !/^[a-zA-Z0-9_-]{1,200}$/.test(String(response.data.imageId ?? ''))) throw new Error('Upload failed');
    field.value = response.data.imageId;
    showBroadcastLocalImage(image, file, state);
    status.className = 'mt-2 text-green-600'; status.textContent = `アップロード完了: ${response.data.filename ?? ''}`;
    showNotification('✅ 画像をアップロードしました', 'success');
  } catch {
    if (!broadcastImageUpdateCurrent(image, state)) {
      if (authenticatedBroadcastImages.get(image) === state) clearBroadcastAuthenticatedImage(image, wrapper);
      return;
    }
    clearBroadcastAuthenticatedImage(image, wrapper);
    status.className = 'mt-2 text-red-600'; status.textContent = '画像のアップロードに失敗しました';
    showNotification('画像のアップロードに失敗しました', 'error');
  } finally { input.disabled = false; }
}
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => {
    for (const [image, state] of authenticatedBroadcastImages) if (!broadcastImageUpdateCurrent(image, state)) clearBroadcastAuthenticatedImage(image);
  }).observe(document.body, { childList: true, subtree: true });
}
