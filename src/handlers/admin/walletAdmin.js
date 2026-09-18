const adminsDb = require('../../db/admins');
const walletsDb = require('../../db/wallets');
const { setState, getState, clearState } = require('../../state');

function register(bot) {
  bot.action('admin_wallet_adjust', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;
    setState(ctx.from.id, 'admin_wallet_target');
    await ctx.reply('Send the Telegram user ID whose wallet you want to adjust:');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_wallet_target') {
      const targetId = ctx.message.text.trim();
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      const balance = walletsDb.getBalance(targetId);
      setState(ctx.from.id, 'admin_wallet_amount', { targetId });
      return ctx.reply(`Current balance: ${balance}⭐\n\nSend the amount to adjust by (use negative numbers to deduct, e.g. -50):`);
    }

    if (state.step === 'admin_wallet_amount') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(amount) || amount === 0) return ctx.reply('Invalid amount.');
      const wallet = walletsDb.addTransaction(state.data.targetId, amount, 'admin_adjust', { adminId: ctx.from.id });
      await ctx.reply(`✅ Adjusted. New balance: ${wallet.balance}⭐`);
      try {
        await ctx.telegram.sendMessage(
          state.data.targetId,
          `ℹ️ Your wallet balance was adjusted by an admin: ${amount >= 0 ? '+' : ''}${amount}⭐. New balance: ${wallet.balance}⭐`
        );
      } catch (e) {}
      return;
    }

    return next();
  });
}

module.exports = { register };
