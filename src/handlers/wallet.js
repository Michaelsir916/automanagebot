const { Markup } = require('telegraf');
const walletsDb = require('../db/wallets');
const paymentsDb = require('../db/payments');
const bansDb = require('../db/bans');
const usersDb = require('../db/users');
const settingsDb = require('../db/settings');
const { setState, getState, clearState } = require('../state');
const { btn, btnPrimary, btnSuccess, btnDanger, navRow, grid } = require('../utils/keyboards');
const { t, hasKey } = require('../utils/i18n');
const { fmtDate, fmtNum, escapeHtml } = require('../utils/format');
const { creditRecharge } = require('../services/rewards');
const { sendToUser } = require('../utils/notify');

const MAX_STARS_PER_INVOICE = 10000;
const PAGE_SIZE = 8;

// History filters -> which transaction types they include
const FILTERS = {
  all: null,
  in: ['recharge', 'bonus', 'upi_recharge', 'referral_reward'],
  spent: ['plan_purchase', 'channel_unlock', 'plan_auto_renew', 'plan_renew'],
  gift: ['gift_sent', 'gift_received']
};
const FILTER_LABEL_KEY = { all: 'f_all', in: 'f_recharge', spent: 'f_spent', gift: 'f_gift' };

function txnLabel(userId, type) {
  const key = `txn_${type}`;
  return hasKey(userId, key) ? t(userId, key) : type;
}

async function sendRechargeInvoice(ctx, amount) {
  const userId = ctx.from.id;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_STARS_PER_INVOICE) {
    return ctx.replyNew
      ? ctx.replyNew(t(userId, 'invalid_amount'))
      : ctx.reply(t(userId, 'invalid_amount'));
  }
  try {
    await ctx.telegram.sendInvoice(userId, {
      title: t(userId, 'invoice_title'),
      description: t(userId, 'invoice_desc', { amount }),
      payload: `recharge_${userId}_${Date.now()}`,
      provider_token: '', // must be empty for Telegram Stars payments
      currency: 'XTR',
      prices: [{ label: t(userId, 'invoice_label', { amount }), amount }]
    });
    await ctx.reply(t(userId, 'invoice_sent'), Markup.inlineKeyboard([navRow('menu_wallet', t(userId, 'back'), t(userId, 'home'))]));
  } catch (err) {
    console.error('[wallet] sendInvoice failed:', err.message);
    await ctx.reply(t(userId, 'invoice_failed'), Markup.inlineKeyboard([navRow('wallet_recharge', t(userId, 'back'), t(userId, 'home'))]));
  }
}

function walletScreen(userId) {
  const wallet = walletsDb.getWallet(userId);
  const last = wallet.transactions[wallet.transactions.length - 1];
  const extra = last
    ? t(userId, 'wallet_recent', {
      line: `${last.amount >= 0 ? '+' : ''}${fmtNum(last.amount)}⭐ · ${txnLabel(userId, last.type)}`
    })
    : '';
  const text = t(userId, 'wallet_title', { balance: fmtNum(wallet.balance), extra });
  const kb = Markup.inlineKeyboard([
    [btnSuccess(t(userId, 'btn_recharge'), 'wallet_recharge')],
    [btnPrimary(t(userId, 'btn_history'), 'wallet_hist_all_0'), btnPrimary(t(userId, 'btn_gift'), 'wallet_gift')],
    [btn(t(userId, 'home'), 'menu_main')]
  ]);
  return { text, kb };
}

function historyScreen(userId, filter, page) {
  const wallet = walletsDb.getWallet(userId);
  const types = FILTERS[filter];
  const all = wallet.transactions.filter(x => !types || types.includes(x.type)).reverse();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = all.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const lines = slice.length
    ? slice.map(x => {
      const sign = x.amount >= 0 ? '+' : '';
      return `${sign}${fmtNum(x.amount)}⭐ · ${txnLabel(userId, x.type)}\n   <i>${fmtDate(x.date)}</i>`;
    }).join('\n')
    : t(userId, 'history_empty');

  const text = t(userId, 'history_title', {
    filter: t(userId, FILTER_LABEL_KEY[filter]), page: p + 1, pages, lines
  });

  const filterRow = Object.keys(FILTERS).map(f =>
    (f === filter ? btnSuccess : btn)(t(userId, FILTER_LABEL_KEY[f]), `wallet_hist_${f}_0`));
  const pageRow = [];
  if (p > 0) pageRow.push(btn(t(userId, 'btn_prev'), `wallet_hist_${filter}_${p - 1}`));
  if (p < pages - 1) pageRow.push(btn(t(userId, 'btn_next'), `wallet_hist_${filter}_${p + 1}`));

  const rows = [filterRow];
  if (pageRow.length) rows.push(pageRow);
  rows.push(navRow('menu_wallet', t(userId, 'back'), t(userId, 'home')));
  return { text, kb: Markup.inlineKeyboard(rows) };
}

function register(bot) {
  bot.action('menu_wallet', async ctx => {
    const { text, kb } = walletScreen(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });

  // ---------- Recharge ----------
  bot.action('wallet_recharge', async ctx => {
    const userId = ctx.from.id;
    if (bansDb.isBanned(userId)) return ctx.reply(t(userId, 'banned'));
    const s = settingsDb.load();
    const buttons = s.rechargePackages.map(p =>
      btnSuccess(
        t(userId, 'pkg_label', {
          popular: p.popular ? t(userId, 'pkg_popular') : '',
          stars: p.stars,
          bonus: p.bonusPct ? t(userId, 'pkg_bonus', { pct: p.bonusPct }) : ''
        }),
        `recharge_${p.stars}`
      ));
    const rows = grid(buttons, 2);
    rows.push([btn(t(userId, 'btn_custom'), 'recharge_custom')]);
    if (s.upiEnabled && s.upiId) rows.push([btnPrimary(t(userId, 'btn_upi'), 'wallet_upi')]);
    rows.push(navRow('menu_wallet', t(userId, 'back'), t(userId, 'home')));
    await ctx.reply(
      t(userId, 'recharge_title', { balance: fmtNum(walletsDb.getBalance(userId)) }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  });

  bot.action('recharge_custom', async ctx => {
    const userId = ctx.from.id;
    setState(userId, 'awaiting_custom_recharge');
    await ctx.reply(t(userId, 'custom_prompt'), Markup.inlineKeyboard([[btn(t(userId, 'cancel'), 'wallet_recharge')]]));
  });

  bot.action(/^recharge_(\d+)$/, async ctx => {
    if (bansDb.isBanned(ctx.from.id)) return ctx.reply(t(ctx.from.id, 'banned'));
    await sendRechargeInvoice(ctx, parseInt(ctx.match[1], 10));
  });

  // ---------- History ----------
  bot.action(/^wallet_hist_(all|in|spent|gift)_(\d+)$/, async ctx => {
    const { text, kb } = historyScreen(ctx.from.id, ctx.match[1], parseInt(ctx.match[2], 10));
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });
  bot.action('wallet_history', async ctx => { // legacy button on old messages
    const { text, kb } = historyScreen(ctx.from.id, 'all', 0);
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });

  // ---------- Gift ----------
  bot.action('wallet_gift', async ctx => {
    const userId = ctx.from.id;
    if (bansDb.isBanned(userId)) return ctx.reply(t(userId, 'banned'));
    setState(userId, 'awaiting_gift_user');
    await ctx.reply(t(userId, 'gift_ask_user'), Markup.inlineKeyboard([[btn(t(userId, 'cancel'), 'gift_cancel')]]));
  });

  bot.action('gift_cancel', async ctx => {
    clearState(ctx.from.id);
    const { text, kb } = walletScreen(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });

  bot.action('gift_confirm', async ctx => {
    const userId = ctx.from.id;
    const state = getState(userId);
    if (!state || state.step !== 'awaiting_gift_confirm') {
      const { text, kb } = walletScreen(userId);
      return ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
    clearState(userId); // clear FIRST so a second tap can't send the gift twice
    const { targetId, amount } = state.data;

    const debited = walletsDb.tryDebit(userId, amount, 'gift_sent', { toUser: targetId });
    if (!debited) {
      return ctx.reply(
        t(userId, 'gift_insufficient', { balance: fmtNum(walletsDb.getBalance(userId)) }),
        Markup.inlineKeyboard([navRow('menu_wallet', t(userId, 'back'), t(userId, 'home'))])
      );
    }
    walletsDb.addTransaction(targetId, amount, 'gift_received', { fromUser: String(userId) });
    await ctx.reply(
      t(userId, 'gift_done', { amount, to: targetId }),
      Markup.inlineKeyboard([navRow('menu_wallet', t(userId, 'back'), t(userId, 'home'))])
    );
    await sendToUser(ctx.telegram, targetId, t(targetId, 'gift_received', { amount }));
  });

  // ---------- Free-text wizard steps ----------
  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();
    const userId = ctx.from.id;

    if (state.step === 'awaiting_custom_recharge') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_STARS_PER_INVOICE) {
        return ctx.reply(t(userId, 'invalid_amount'));
      }
      clearState(userId);
      return sendRechargeInvoice(ctx, amount);
    }

    if (state.step === 'awaiting_gift_user') {
      const targetId = ctx.message.text.trim();
      if (!/^\d+$/.test(targetId)) return ctx.reply(t(userId, 'gift_invalid_user'));
      if (targetId === String(userId)) return ctx.reply(t(userId, 'gift_self'));
      if (!usersDb.get(targetId)) return ctx.reply(t(userId, 'gift_unknown_user'));
      setState(userId, 'awaiting_gift_amount', { targetId });
      return ctx.reply(t(userId, 'gift_ask_amount'));
    }

    if (state.step === 'awaiting_gift_amount') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(amount) || amount < 1) return ctx.reply(t(userId, 'invalid_amount'));
      const balance = walletsDb.getBalance(userId);
      if (balance < amount) {
        clearState(userId);
        return ctx.reply(t(userId, 'gift_insufficient', { balance: fmtNum(balance) }));
      }
      setState(userId, 'awaiting_gift_confirm', { targetId: state.data.targetId, amount });
      return ctx.reply(
        t(userId, 'gift_confirm', {
          to: escapeHtml(state.data.targetId), amount, after: fmtNum(balance - amount)
        }),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[btnSuccess(t(userId, 'confirm'), 'gift_confirm'), btnDanger(t(userId, 'cancel'), 'gift_cancel')]])
        }
      );
    }

    return next();
  });

  // ---------- Stars payments ----------
  bot.on('pre_checkout_query', async ctx => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error('[wallet] pre_checkout error:', err.message);
    }
  });

  bot.on('message', async (ctx, next) => {
    const payment = ctx.message.successful_payment;
    // Only claim wallet-recharge invoices here (payload prefix we set
    // ourselves in sendRechargeInvoice). Other payloads fall through.
    if (!payment || !payment.invoice_payload.startsWith('recharge_')) return next();
    const stars = payment.total_amount; // for XTR, this IS the star count
    const userId = ctx.from.id;
    const chargeId = payment.telegram_payment_charge_id;

    // Idempotent: if Telegram re-delivers this update (slow ack / restart)
    // the same charge must never be credited twice.
    if (walletsDb.hasChargeId(userId, chargeId) || paymentsDb.hasCharge(chargeId)) return;

    await creditRecharge(ctx.telegram, userId, stars, { type: 'recharge', meta: { telegramPaymentChargeId: chargeId } });
    paymentsDb.add(userId, stars, chargeId);
  });
}

module.exports = { register, walletScreen };
