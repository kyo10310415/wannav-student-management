function handleExtensionStatsChange(event) {
  const select = event.target?.closest?.('select[data-extension-stats-tutor]');
  if (!select || select.disabled || !document.getElementById('content')?.contains(select)) return;
  if (!sessionToken || !currentUser || !['admin', 'leader'].includes(currentUser.role) || currentPage !== 'extensions') return;
  return changeExtensionTutor(select.value);
}
function handleSuspensionReloadClick(event) {
  const button = event.target?.closest?.('button[data-suspension-action]');
  if (!button || button.disabled || !document.getElementById('content')?.contains(button)) return;
  if (!sessionToken || !currentUser || !['admin', 'leader', 'crew'].includes(currentUser.role) || currentPage !== 'suspensions') return;
  if (button.dataset.suspensionAction === 'reload') return renderSuspensionsPage();
}
document.addEventListener('change', handleExtensionStatsChange);
document.addEventListener('click', handleSuspensionReloadClick);
