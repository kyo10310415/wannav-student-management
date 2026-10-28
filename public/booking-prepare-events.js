function handleBookingPrepareClick(event) {
  const button = event.target?.closest?.('button[data-booking-prepare-action]');
  if (!button || button.disabled || !currentUser || currentUser.role !== 'admin' || !sessionToken) return;
  const modal = document.getElementById('edit-booking-links-modal');
  switch (button.dataset.bookingPrepareAction) {
    case 'open': {
      if (currentPage !== 'users' || !document.getElementById('content')?.contains(button) || !/^\d+$/.test(button.dataset.userId || '')) return;
      const id = Number(button.dataset.userId);
      if (Number.isSafeInteger(id) && id > 0) return showEditBookingLinksModal(button);
      return;
    }
    case 'close':
      if (modal?.contains(button)) return closeEditBookingLinksModal();
      return;
    case 'restore':
      if (modal?.contains(button) && document.getElementById('booking-links-history')?.contains(button)) return restoreTutorBookingLinksFromHistory(button);
  }
}
document.addEventListener('click', handleBookingPrepareClick);
