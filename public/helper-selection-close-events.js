function handleHelperSelectionClose(event) {
  const button = event.target?.closest?.('button[data-helper-selection-close]');
  if (!button || button.disabled || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || !sessionToken) return;
  if (document.getElementById('tutor-selection-modal')?.contains(button)) return closeTutorSelectionModal();
}
document.addEventListener('click', handleHelperSelectionClose);
