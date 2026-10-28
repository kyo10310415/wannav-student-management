function handleContentLocalClick(event) {
  const button = event.target?.closest?.('button[data-content-local-action]');
  const content = document.getElementById('content');
  if (!button || button.disabled || !currentUser || !['admin', 'leader'].includes(currentUser.role) || !sessionToken || currentPage !== 'lesson-contents' || !content?.contains(button)) return;
  switch (button.dataset.contentLocalAction) {
    case 'show-add': return showAddLessonContentForm();
    case 'hide-add': {
      const form = document.getElementById('lc-add-form');
      if (form && content.contains(form)) form.classList.add('hidden');
      return;
    }
    case 'edit':
    case 'cancel': {
      const key = button.dataset.lessonNumber;
      if (!key || !lessonContentsCache.some(item => String(item.lesson_number) === key)) return;
      const view = document.getElementById(`lc-view-${key}`);
      const editor = document.getElementById(`lc-edit-${key}`);
      if (!view || !editor || !content.contains(view) || !content.contains(editor)) return;
      return button.dataset.contentLocalAction === 'edit' ? editLessonContent(key) : cancelEditLessonContent(key);
    }
  }
}
document.addEventListener('click', handleContentLocalClick);
