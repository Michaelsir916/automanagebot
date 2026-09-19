function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Human-readable "@username (Name)" or "Name [id: 123]" fallback when no username
function userTag(from) {
  if (!from) return 'Unknown';
  const name = escapeHtml(from.first_name || 'User');
  return from.username ? `@${escapeHtml(from.username)} (${name})` : `${name} [id: ${from.id}]`;
}

module.exports = { escapeHtml, userTag };
