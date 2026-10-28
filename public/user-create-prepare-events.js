function handleUserCreatePrepareClick(event) {
  const button = event.target?.closest?.('button[data-user-create-action]');
  if (!button || button.disabled || !currentUser || currentUser.role !== 'admin' || !sessionToken) return;
  if (button.dataset.userCreateAction === 'open') {
    if (currentPage === 'users' && document.getElementById('content')?.contains(button)) return showCreateUserModal();
    return;
  }
  if (button.dataset.userCreateAction === 'close' && document.getElementById('create-user-modal')?.contains(button)) return closeCreateUserModal();
}
document.addEventListener('click', handleUserCreatePrepareClick);
