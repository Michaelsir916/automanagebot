const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const ticketsDb = require('../../db/tickets');
const auditDb = require('../../db/audit');
const usersDb = require('../../db/users');
const { btn, btnPrimary, btnSuccess } = require('../../utils/keyboards');
const { escapeHtml, fmtDate } = require('../../utils/format');
const { sendToUser } = require('../../utils/notify');
const { t } = require('../../utils/i18n');

function register(bot) {
  bot.action('admin_tickets', async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const open = ticketsDb.listOpen().sort((a, b) => a.no - b.no).slice(0, 12);
    const rows = open.map(tk => {
      const u = usersDb.get(tk.userId);
      const who = (u && (u.username ? `@${u.username}` : u.firstName)) || tk.userId;
      const preview = tk.messages[0].text.replace(/\s+/g, ' ').slice(0, 24);
      return [btnPrimary(`#${tk.no} ${who}: ${preview}`, `admin_ticket_${tk.no}`)];
    });
    rows.push([btn('⬅️ Back', 'admin_members')]);
    await ctx.reply(
      open.length ? `🎫 <b>Open tickets</b> (${open.length})` : '🎫 No open tickets 🎉',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  });

  bot.action(/^admin_ticket_(\d+)$/, async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const tk = ticketsDb.get(ctx.match[1]);
    if (!tk) return ctx.reply('Ticket not found.');
    const lines = tk.messages.slice(-8).map(m => `${m.from === 'user' ? '👤' : '🛠'} <i>${fmtDate(m.at)}</i>\n${escapeHtml(m.text).slice(0, 500)}`).join('\n\n');
    const rows = [[btnPrimary('💬 Reply', `contact_${tk.userId}`), btnPrimary('👤 User', `admin_u_${tk.userId}`)]];
    if (tk.status === 'open') rows.push([btnSuccess(`✅ Close #${tk.no}`, `ticket_close_${tk.no}`)]);
    rows.push([btn('⬅️ Back', 'admin_tickets')]);
    await ctx.reply(`🎫 <b>Ticket #${tk.no}</b> (${tk.status})\nUser: <code>${tk.userId}</code>\n\n${lines}`, {
      parse_mode: 'HTML', ...Markup.inlineKeyboard(rows)
    });
  });

  bot.action(/^ticket_close_(\d+)$/, async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const tk = ticketsDb.close(ctx.match[1], ctx.from.id);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) { /* ignore */ }
    if (!tk) return ctx.replyNew('Ticket already closed or not found.');
    auditDb.add(ctx.from.id, 'ticket_close', `#${tk.no}`);
    await sendToUser(ctx.telegram, tk.userId, t(tk.userId, 'ticket_closed', { no: tk.no }));
    await ctx.replyNew(`✅ Ticket #${tk.no} closed and the user was notified.`);
  });
}

module.exports = { register };
