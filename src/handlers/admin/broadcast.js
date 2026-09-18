const adminsDb = require('../../db/admins');
const walletsDb = require('../../db/wallets');
const { setState, getState, clearState } = require('../../state');

function register(bot) {
  bot.action('admin_broadcast', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'broadcast')) return;
    setState(ctx.from.id, 'admin_broadcast_text');
    await ctx.reply('Send the message you want to broadcast to everyone who has recharged their wallet at least once:');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_broadcast_text') return next();
    clearState(ctx.from.id);
    const text = ctx.message.text;

    const paidUserIds = walletsDb.listUsersWithRecharge();
    await ctx.reply(`📣 Broadcasting to ${paidUserIds.length} users...`);

    let sent = 0, failed = 0;
    for (const id of paidUserIds) {
      try {
        await ctx.telegram.sendMessage(id, `📣 ${text}`);
        sent++;
      } catch (err) {
        failed++;
      }
    }
    await ctx.reply(`✅ Broadcast complete. Sent: ${sent}, Failed: ${failed}`);
  });
}

module.exports = { register };
