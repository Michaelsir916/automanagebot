const { Markup } = require('telegraf');
const walletsDb = require('../db/wallets');
const paymentsDb = require('../db/payments');
const bansDb = require('../db/bans');
const { setState, getState, clearState } = require('../state');

const RECHARGE_PACKAGES = [50, 100, 250, 500];

async function sendRechargeInvoice(ctx, amount) {
  try {
    await ctx.telegram.sendInvoice(ctx.from.id, {
      title: 'Wallet Recharge',
      description: `Add ${amount} Stars to your bot wallet`,
      payload: `recharge_${ctx.from.id}_${Date.now()}`,
      provider_token: '', // must be empty for Telegram Stars payments
      currency: 'XTR',
      prices: [{ label: `${amount} Stars`, amount }]
    });
  } catch (err) {
    console.error('[wallet] sendInvoice failed:', err.message);
    await ctx.reply('⚠️ Could not create the payment invoice. Please try again later.');
  }
}

function register(bot) {
  bot.action('menu_wallet', async ctx => {
    await ctx.answerCbQuery();
    const wallet = walletsDb.getWallet(ctx.from.id);
    await ctx.reply(
      `💰 <b>Your Wallet</b>\n\nBalance: <b>${wallet.balance} ⭐</b>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Recharge', 'wallet_recharge')],
          [Markup.button.callback('📜 Transaction History', 'wallet_history')],
          [Markup.button.callback('🎁 Gift Balance', 'wallet_gift')],
          [Markup.button.callback('⬅️ Back', 'menu_main')]
        ])
      }
    );
  });

  bot.action('wallet_recharge', async ctx => {
    await ctx.answerCbQuery();
    if (bansDb.isBanned(ctx.from.id)) return ctx.reply('🚫 You are banned from using this service.');
    const rows = RECHARGE_PACKAGES.map(p => [Markup.button.callback(`${p} ⭐`, `recharge_${p}`)]);
    rows.push([Markup.button.callback('✏️ Custom Amount', 'recharge_custom')]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu_wallet')]);
    await ctx.reply('Select a recharge amount:', Markup.inlineKeyboard(rows));
  });

  bot.action('recharge_custom', async ctx => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, 'awaiting_custom_recharge');
    await ctx.reply('Send the number of Stars ⭐ you want to recharge (e.g. 150):');
  });

  bot.action(/recharge_(\d+)/, async ctx => {
    await ctx.answerCbQuery();
    await sendRechargeInvoice(ctx, parseInt(ctx.match[1], 10));
  });

  bot.action('wallet_history', async ctx => {
    await ctx.answerCbQuery();
    const wallet = walletsDb.getWallet(ctx.from.id);
    const txns = wallet.transactions.slice(-10).reverse();
    if (txns.length === 0) return ctx.reply('No transactions yet.');
    const lines = txns.map(t => {
      const sign = t.amount >= 0 ? '+' : '';
      const date = new Date(t.date).toLocaleString();
      return `${sign}${t.amount}⭐ — ${t.type} (${date})`;
    });
    await ctx.reply(`📜 <b>Last ${txns.length} transactions:</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.action('wallet_gift', async ctx => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, 'awaiting_gift_user');
    await ctx.reply('Send the Telegram user ID of the person you want to gift balance to:');
  });

  // Free-text steps for recharge/gift wizards
  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'awaiting_custom_recharge') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(amount) || amount < 1) {
        return ctx.reply('Invalid amount. Please try again from the Wallet menu.');
      }
      return sendRechargeInvoice(ctx, amount);
    }

    if (state.step === 'awaiting_gift_user') {
      const targetId = ctx.message.text.trim();
      if (!/^\d+$/.test(targetId)) {
        return ctx.reply('Invalid user ID. Please send a numeric Telegram user ID.');
      }
      setState(ctx.from.id, 'awaiting_gift_amount', { targetId });
      return ctx.reply('How many ⭐ do you want to gift?');
    }

    if (state.step === 'awaiting_gift_amount') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(amount) || amount < 1) {
        return ctx.reply('Invalid amount. Please start over from the Wallet menu.');
      }
      const balance = walletsDb.getBalance(ctx.from.id);
      if (balance < amount) {
        return ctx.reply(`❌ Insufficient balance. You have ${balance}⭐.`);
      }
      const targetId = state.data.targetId;
      walletsDb.addTransaction(ctx.from.id, -amount, 'gift_sent', { toUser: targetId });
      walletsDb.addTransaction(targetId, amount, 'gift_received', { fromUser: ctx.from.id });
      await ctx.reply(`🎁 You gifted ${amount}⭐ to user ${targetId}.`);
      try {
        await ctx.telegram.sendMessage(targetId, `🎁 You received a gift of ${amount}⭐! Check your wallet balance.`);
      } catch (err) {
        console.error('[wallet] gift notify failed:', err.message);
      }
      return;
    }

    return next();
  });

  bot.on('pre_checkout_query', async ctx => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error('[wallet] pre_checkout error:', err.message);
    }
  });

  bot.on('message', async (ctx, next) => {
    if (!ctx.message.successful_payment) return next();
    const payment = ctx.message.successful_payment;
    const stars = payment.total_amount; // for XTR, this IS the star count
    const userId = ctx.from.id;

    walletsDb.addTransaction(userId, stars, 'recharge', {
      telegramPaymentChargeId: payment.telegram_payment_charge_id
    });
    paymentsDb.add(userId, stars, payment.telegram_payment_charge_id);

    const wallet = walletsDb.getWallet(userId);
    await ctx.reply(`✅ Recharge successful!\n\n+${stars} ⭐\nNew balance: ${wallet.balance} ⭐`);
  });
}

module.exports = { register };
