const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const { btn } = require('../../utils/keyboards');
const { escapeHtml, fmtDate } = require('../../utils/format');

const PAGE = 10;

function register(bot) {
  bot.action(/^admin_audit_(\d+)$/, async ctx => {
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    const all = auditDb.list().slice().reverse();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const p = Math.min(parseInt(ctx.match[1], 10), pages - 1);
    const slice = all.slice(p * PAGE, p * PAGE + PAGE);
    const lines = slice.length
      ? slice.map(e => `<i>${fmtDate(e.at)}</i>\n<code>${e.adminId}</code> · <b>${escapeHtml(e.action)}</b> ${escapeHtml(e.detail)}`).join('\n\n')
      : 'Nothing logged yet.';
    const nav = [];
    if (p > 0) nav.push(btn('◀️ Newer', `admin_audit_${p - 1}`));
    if (p < pages - 1) nav.push(btn('Older ▶️', `admin_audit_${p + 1}`));
    const rows = [];
    if (nav.length) rows.push(nav);
    rows.push([btn('⬅️ Back', 'admin_settings')]);
    await ctx.reply(`🧾 <b>Audit log</b> — page ${p + 1}/${pages}\n\n${lines}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });
}

module.exports = { register };
