// The app replaces content nodes; keep these read controls on a stable root.
function funnelReadControlsAllowed() {
  return currentUser && ['admin', 'leader'].includes(currentUser.role) && sessionToken && currentPage === 'funnel';
}
function handleFunnelReadClick(event) {
  const button = event.target?.closest?.('button[data-funnel-action]');
  if (!button || button.disabled || !funnelReadControlsAllowed()) return;
  const content = document.getElementById('content');
  if (button.dataset.funnelAction === 'close-details') {
    if (document.getElementById('funnel-student-details-modal')?.contains(button)) return closeFunnelStudentDetails();
    return;
  }
  if (!content?.contains(button)) return;
  switch (button.dataset.funnelAction) {
    case 'reload': return renderFunnelPage();
    case 'details':
      if (button.dataset.detailKey) return showFunnelStudentDetails(button.dataset.detailKey, button.dataset.detailLabel || '');
      return;
    case 'previous-month': return changeFunnelMonth(-1);
    case 'next-month': return changeFunnelMonth(1);
  }
}
function handleFunnelMonthChange(event) {
  const input = event.target?.closest?.('input[data-funnel-month]');
  if (!input || input.disabled || !document.getElementById('content')?.contains(input) || !funnelReadControlsAllowed()) return;
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.value)) return setFunnelMonth(input.value);
}
document.addEventListener('click', handleFunnelReadClick);
document.addEventListener('change', handleFunnelMonthChange);
