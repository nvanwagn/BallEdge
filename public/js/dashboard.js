// Delete buttons on the "My Articles" dashboard.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  if (!confirm(`Delete "${btn.dataset.title}"? This can't be undone.`)) return;
  const res = await fetch('/api/articles/' + btn.dataset.delete, { method: 'DELETE' });
  if (res.ok) btn.closest('tr').remove();
  else window.beToast('Could not delete the article.', true);
});
