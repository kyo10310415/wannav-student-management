function handleDiscordMappingClick(event) {
  const button = event.target?.closest?.('button[data-discord-mapping-action]');
  if (!button || button.disabled || !currentUser || currentUser.role !== 'admin' || !sessionToken) return;
  if (button.dataset.discordMappingAction === 'open') {
    if (currentPage === 'users' && document.getElementById('content')?.contains(button)) return checkDiscordMapping();
    return;
  }
  if (button.dataset.discordMappingAction === 'close' && document.getElementById('discord-mapping-modal')?.contains(button)) return closeDiscordMappingModal();
}
document.addEventListener('click', handleDiscordMappingClick);
