let studentVQHistoryRead = null;
function clearStudentVQHistoryRead() {
  studentVQHistoryRead?.modal?.remove();
  studentVQHistoryRead = null;
}
function studentVQHistoryReadCurrent(state) {
  return state && studentVQHistoryRead === state && sessionToken === state.token &&
    currentUser?.id === state.userId && ['admin', 'leader'].includes(currentUser?.role) &&
    currentPage === state.page && ['students', 'vq-diagnosis'].includes(currentPage) &&
    document.getElementById('content') === state.root;
}
function beginStudentVQHistoryRead(studentId) {
  clearStudentVQHistoryRead();
  if (typeof studentId !== 'string' || !studentId.trim() || studentId.length > 255 || /[\u0000-\u001f\u007f]/.test(studentId) ||
      !sessionToken || !['admin', 'leader'].includes(currentUser?.role) || !['students', 'vq-diagnosis'].includes(currentPage)) return null;
  const root = document.getElementById('content');
  if (!root) return null;
  studentVQHistoryRead = { root, token: sessionToken, userId: currentUser.id, page: currentPage, modal: null };
  return studentVQHistoryRead;
}
function handleVQHistoryClick(event) {
  const button = event.target?.closest?.('[data-vq-history-action]');
  if (!button || button.disabled || !sessionToken || !['admin', 'leader'].includes(currentUser?.role) || currentPage !== 'vq-diagnosis' ||
      !document.getElementById('content')?.contains(button)) return;
  const id = Number(button.dataset.vqHistoryId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const record = vqDiagnosisHistory.find(row => Number(row.id) === id);
  if (!record) return;
  if (button.dataset.vqHistoryAction === 'resend') return resendVQDiagnosis(id);
  if (button.dataset.vqHistoryAction === 'delete') return deleteVQHistory(id, record.student_name || record.student_id_code || '-');
}
document.addEventListener('click', handleVQHistoryClick);
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => {
    const state = studentVQHistoryRead;
    if (state && (!studentVQHistoryReadCurrent(state) || (state.modal && !document.body.contains(state.modal)))) clearStudentVQHistoryRead();
  }).observe(document.body, { childList: true, subtree: true });
}
