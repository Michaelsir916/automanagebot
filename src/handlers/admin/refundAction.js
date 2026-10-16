const linksDb = require('../../db/links');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const access = require('../../services/access');
const { creditBackToWallet } = require('../../services/refunds');

// Attached as a button to misuse alerts (see joinRequest.js). Lets an admin
// manually credit the paid link's price back to the owner's wallet and
// permanently kill the link - a deliberate, admin-triggered action rather
// than an automatic policy. It runs through the refund ledger, so pressing
// the button twice (or retrying after a crash) refunds only once.
function register(bot) {
  bot.action(/^refund_(lnk_\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;

    const link = linksDb.getById(ctx.match[1]);
    if (!link) return ctx.reply('Link not found (may already be handled).');
    if (link.status === 'refunded') return ctx.reply('Already refunded.');

    let credited = false;
    if (link.price > 0 && link.ownerUserId) {
      const res = creditBackToWallet({
        key: `link:${link.id}`, userId: link.ownerUserId, amount: link.price, type: 'refund',
        reason: 'link misuse', adminId: ctx.from.id, meta: { channelId: link.channelId, linkId: link.id }
      });
      credited = res.ok;
      if (res.ok) {
        try {
          await ctx.telegram.sendMessage(
            link.ownerUserId,
            `🔄 You've been refunded ${link.price}⭐ to your wallet due to link misuse. Feel free to unlock access again.`
          );
        } catch (e) { /* user may have blocked the bot */ }
      }
    }

    // Revoke through the durable queue so a Telegram hiccup cannot leave the link alive.
    access.enqueueRevoke({ chatId: link.chatId, inviteLink: link.inviteLink, linkId: link.id });
    linksDb.update(link.id, { status: 'refunded' });
    auditDb.add(ctx.from.id, 'refund_link', `link ${link.id} owner ${link.ownerUserId} ${link.price}⭐${credited ? '' : ' (no credit)'}`);
    await ctx.reply('✅ Refunded to wallet and link revoked.');
  });
}

module.exports = { register };
