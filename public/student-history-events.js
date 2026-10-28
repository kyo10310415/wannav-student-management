function handleStudentHistoryClick(event) {
  const target = event.target?.closest?.('[data-student-history-action]');
  if (!target || target.disabled || !sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role)) return;
  const action = target.dataset.studentHistoryAction;
  if (action === 'close-wanami') {
    if (document.getElementById('wanami-history-modal')?.contains(target)) return closeWanamiHistoryModal();
    return;
  }
  if (action === 'close-vq') {
    const modal = target.closest('[data-student-vq-history]');
    if (modal && document.body.contains(modal)) return modal.remove();
    return;
  }
  if (!document.getElementById('content')?.contains(target) || !target.dataset.studentHistoryId) return;
  if (action === 'wanami' && currentPage === 'students') return showWanamiHistory(target.dataset.studentHistoryId);
  if (action === 'vq' && ['students', 'vq-diagnosis'].includes(currentPage) && ['admin', 'leader'].includes(currentUser.role)) return showStudentVQHistory(target.dataset.studentHistoryId);
}
document.addEventListener('click', handleStudentHistoryClick);
