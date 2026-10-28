// Protected images stay in memory only; tokens are never placed in image URLs.
const authenticatedRedListImages = new Map();
function clearRedListAuthenticatedImage(image, wrapper) {
  if (!image) return;
  const state = authenticatedRedListImages.get(image);
  if (state?.objectUrl) URL.revokeObjectURL(state.objectUrl);
  authenticatedRedListImages.delete(image);
  image.removeAttribute('src');
  (wrapper || state?.wrapper)?.classList.add('hidden');
}
function clearAllRedListAuthenticatedImages() {
  for (const [image] of authenticatedRedListImages) clearRedListAuthenticatedImage(image);
}
async function loadRedListAuthenticatedImage(image, messageId, wrapper) {
  clearRedListAuthenticatedImage(image, wrapper);
  const id = String(messageId ?? '');
  if (!image || !image.isConnected || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role)) return false;
  const state = { token: sessionToken, userId: currentUser.id, wrapper, objectUrl: null };
  authenticatedRedListImages.set(image, state);
  try {
    const response = await axios.get(`${API_BASE}/api/red-list/messages/${encodeURIComponent(id)}/image`, {
      responseType: 'blob',
      headers: { Authorization: `Bearer ${state.token}`, 'Cache-Control': 'no-cache' }
    });
    if (authenticatedRedListImages.get(image) !== state || !image.isConnected || sessionToken !== state.token || !currentUser || currentUser.id !== state.userId || !['admin', 'leader', 'crew'].includes(currentUser.role)) {
      if (authenticatedRedListImages.get(image) === state) clearRedListAuthenticatedImage(image, wrapper);
      return false;
    }
    state.objectUrl = URL.createObjectURL(response.data);
    image.src = state.objectUrl;
    wrapper?.classList.remove('hidden');
    return true;
  } catch {
    if (authenticatedRedListImages.get(image) === state) clearRedListAuthenticatedImage(image, wrapper);
    return false;
  }
}
// Navigation removes content nodes; release URLs and invalidate in-flight responses.
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => {
    for (const [image, state] of authenticatedRedListImages) {
      if (!image.isConnected || sessionToken !== state.token || !currentUser || currentUser.id !== state.userId || !['admin', 'leader', 'crew'].includes(currentUser.role)) clearRedListAuthenticatedImage(image);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
