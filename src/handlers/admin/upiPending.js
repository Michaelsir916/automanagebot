const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const manualDb = require('../../db/manualPayments');
const { btn, btnPrimary, btnSuccess, btnDanger } = require('../../utils/keyboards');
const { fmtDate } = require('../../utils/format');

function decisionButtons(id) {
  return Markup.inlineKeyboard([[btnSuccess('✅ Approve', `upi_ok_${id}`), btnDanger('❌ Reject', `upi_no_${id}`)]]);
}

function register(bot) {
  const guard = ctx => adminsDb.hasPermission(ctx.from.id, 'wallet_adjust');

  bot.action('admin_upi_pending', async ctx => {
    if (!guard(ctx)) return;
    const pending = manualDb.listPending().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const rows = pending.slice(0, 10).map(i =>
      [btnPrimary(`₹${i.rupees} → ${i.stars}⭐ · ${i.userId}`, `admin_upi_view_${i.id}`)]);
    rows.push([btn('⬅️ Back', 'admin_money')]);
    await ctx.reply(
      pending.length ? `🇮🇳 <b>UPI waiting for review</b> (${pending.length})\nOldest first.` : '🇮🇳 No UPI payments waiting 🎉',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  });

  // Re-send the screenshot with Approve / Reject (the original alert may be buried in the chat).
  bot.action(/^admin_upi_view_(\S+)$/, async ctx => {
    if (!guard(ctx)) return;
    const req = manualDb.get(ctx.match[1]);
    if (!req) return ctx.reply('Request not found.', Markup.inlineKeyboard([[btn('⬅️ Back', 'admin_upi_pending')]]));
    if (req.status !== 'pending') return ctx.reply(`Already ${req.status}.`, Markup.inlineKeyboard([[btn('⬅️ Back', 'admin_upi_pending')]]));
    const caption =
      `🇮🇳 <b>UPI payment to verify</b>\n\nUser: <code>${req.userId}</code>\nAmount: <b>₹${req.rupees}</b> → <b>${req.stars} ⭐</b>\n` +
      `Ref: <code>${req.id}</code>\nSent: ${fmtDate(req.createdAt)}`;
    const extra = { caption, parse_mode: 'HTML', ...decisionButtons(req.id) };
    try {
      await ctx.telegram.sendPhoto(ctx.chat.id, req.fileId, extra);
    } catch (e) {
      try { await ctx.telegram.sendDocument(ctx.chat.id, req.fileId, extra); }
      catch (e2) { await ctx.replyNew(`Could not load the screenshot.\n\n${caption}`, { parse_mode: 'HTML', ...decisionButtons(req.id) }); }
    }
  });
}

module.exports = { register };
