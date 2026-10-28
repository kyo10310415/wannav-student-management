function handleDiscordPrepareClick(event) {
  const button = event.target?.closest?.('button[data-discord-prepare-action]');
  if (!button || button.disabled || !currentUser || currentUser.role !== 'admin' || !sessionToken) return;
  if (button.dataset.discordPrepareAction === 'close') {
    if (document.getElementById('edit-discord-modal')?.contains(button)) return closeEditDiscordModal();
    return;
  }
  if (button.dataset.discordPrepareAction !== 'open' || currentPage !== 'users' || !document.getElementById('content')?.contains(button)) return;
  if (!/^\d+$/.test(button.dataset.discordUserId || '')) return;
  const id = Number(button.dataset.discordUserId);
  if (Number.isSafeInteger(id) && id > 0) return showEditDiscordModal(id);
}
document.addEventListener('click', handleDiscordPrepareClick);
