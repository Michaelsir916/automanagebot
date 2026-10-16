// Shared pagination helpers so long admin lists never exceed Telegram's
// 4096-character message limit.

function paginate(list, page = 0, size = 10) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, Number.isFinite(page) ? page : 0), pages - 1);
  return { items: list.slice(p * size, p * size + size), page: p, pages, total: list.length };
}

// Returns an array of inline buttons ([] when there is only one page).
function pagerButtons(prefix, page, pages) {
  const row = [];
  if (page > 0) row.push({ text: '◀️ Prev', callback_data: `${prefix}${page - 1}` });
  if (page < pages - 1) row.push({ text: 'Next ▶️', callback_data: `${prefix}${page + 1}` });
  return row;
}

module.exports = { paginate, pagerButtons };
