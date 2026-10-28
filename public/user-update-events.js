// Fixed actions keep user updates out of inline handlers and serialize each field.
const pendingUserFieldUpdates = new Set();
function userUpdateContextMatches(input, content, token) {
  return Boolean(input && currentUser?.role === 'admin' && sessionToken === token && token && currentPage === 'users' && document.getElementById('content') === content && content?.contains(input));
}
function restoreUserFieldValue(input, action, previous) {
  if (action === 'reply-alerts') input.checked = previous === 'true';
  else input.value = previous;
}
async function saveUserFieldUpdate(action, userId, value, input) {
  const content = document.getElementById('content');
  const token = sessionToken;
  const id = String(userId ?? '');
  if (!userUpdateContextMatches(input, content, token) || input.disabled || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || input.dataset.userUpdateAction !== action || input.dataset.userUpdateId !== id) return;
  const previous = input.dataset.userUpdatePrevious;
  const valid = action === 'role' ? ['admin', 'leader', 'crew'].includes(value)
    : action === 'job-title' ? ['', 'マネージャー', '統括', 'リーダー', 'クルー', '部署移動', '契約解除'].includes(value)
    : action === 'reply-alerts' && typeof value === 'boolean';
  if (!valid || typeof previous !== 'string') return;
  const key = `${id}:${action}`;
  if (pendingUserFieldUpdates.has(key)) return;
  pendingUserFieldUpdates.add(key);
  input.disabled = true;
  try {
    if (action === 'role' && !confirm('このユーザーの権限を変更しますか?')) {
      restoreUserFieldValue(input, action, previous);
      return;
    }
    if (!userUpdateContextMatches(input, content, token)) return;
    const suffix = action === 'role' ? '' : `/${action}`;
    const body = action === 'role' ? { role: value } : action === 'job-title' ? { job_title: value || null } : { enabled: value };
    const response = await axios.put(`${API_BASE}/api/users/${id}${suffix}`, body, { headers: { Authorization: `Bearer ${token}` } });
    if (!userUpdateContextMatches(input, content, token)) return;
    if (!response.data.success) throw new Error('User field update failed');
    input.dataset.userUpdatePrevious = String(value);
    if (action === 'role') {
      alert('ユーザーの権限を更新しました');
      await renderUsersPage();
    } else if (action === 'job-title') showNotification('役職を更新しました', 'success');
    else showNotification(`未返信通知を${value ? 'ON' : 'OFF'}にしました（Tutor・管理側の両方）`, 'success');
  } catch {
    if (userUpdateContextMatches(input, content, token)) {
      restoreUserFieldValue(input, action, previous);
      alert(action === 'role' ? '権限更新に失敗しました' : action === 'job-title' ? '役職更新に失敗しました' : '未返信通知の更新に失敗しました');
    }
  } finally {
    pendingUserFieldUpdates.delete(key);
    input.disabled = false;
  }
}
function handleUserUpdateChange(event) {
  const input = event.target?.closest?.('select[data-user-update-action], input[type="checkbox"][data-user-update-action]');
  if (!input || input.disabled) return;
  const id = input.dataset.userUpdateId;
  if (input.dataset.userUpdateAction === 'role' && input.tagName === 'SELECT') return updateUserRole(id, input.value, input);
  if (input.dataset.userUpdateAction === 'job-title' && input.tagName === 'SELECT') return updateUserJobTitle(id, input.value, input);
  if (input.dataset.userUpdateAction === 'reply-alerts' && input.tagName === 'INPUT' && input.type === 'checkbox') return updateUserReplyAlerts(id, input);
}
document.addEventListener('change', handleUserUpdateChange);
