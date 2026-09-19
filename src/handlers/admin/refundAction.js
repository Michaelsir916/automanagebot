const linksDb = require('../../db/links');
const walletsDb = require('../../db/wallets');
const adminsDb = require('../../db/admins');

// Attached as a button to misuse alerts (see joinRequest.js). Lets an admin
// manually credit the paid link's price back to the owner's wallet and
// permanently kill the link - a deliberate, admin-triggered action rather
// than an automatic policy.
function register(bot) {
  bot.action(/refund_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;

    const link = linksDb.getById(ctx.match[1]);
    if (!link) return ctx.reply('Link not found (may already be handled).');
    if (link.status === 'refunded') return ctx.reply('Already refunded.');

    if (link.price > 0 && link.ownerUserId) {
      walletsDb.addTransaction(link.ownerUserId, link.price, 'refund', {
        channelId: link.channelId,
        linkId: link.id,
        reason: 'link misuse'
      });
      try {
        await ctx.telegram.sendMessage(
          link.ownerUserId,
          `🔄 You've been refunded ${link.price}⭐ to your wallet due to link misuse. Feel free to unlock access again.`
        );
      } catch (e) {}
    }

    try {
      await ctx.telegram.revokeChatInviteLink(link.chatId, link.inviteLink);
    } catch (e) {}

    linksDb.update(link.id, { status: 'refunded' });
    await ctx.reply('✅ Refunded to wallet and link revoked.');
  });
}

module.exports = { register };
