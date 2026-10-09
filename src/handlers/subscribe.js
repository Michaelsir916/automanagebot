const { Markup } = require('telegraf');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const linksDb = require('../db/links');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const walletsDb = require('../db/wallets');
const bansDb = require('../db/bans');
const usersDb = require('../db/users');
const couponsDb = require('../db/coupons');
const { genId } = require('../utils/ids');
const { setState, getState, clearState, setCoupon, getCoupon, clearCoupon } = require('../state');
const { btn, btnPrimary, btnSuccess, btnDanger, navRow } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, fmtDate, fmtNum, timeLeft } = require('../utils/format');
const { quote } = require('../services/pricing');

const NO_PREVIEW = { link_preview_options: { is_disabled: true } };

function durationLabel(userId, days) {
  if (!(days > 0)) return 'Lifetime ♾';
  return usersDb.getLang(userId) === 'en' ? `${days} day(s)` : `${days} ദിവസം`;
}

// A laggy client can still show an old "Confirm" button after the purchase
// already went through. Remember finished purchases for a short while and
// refuse to repeat the same one.
const recentBuys = new Map();
const REPEAT_WINDOW_MS = 25 * 1000;

function channelTitles(channelIds) {
  return channelIds
    .map(id => escapeHtml((channelsDb.getById(id) || { title: '?' }).title))
    .join(' + ');
}

function planIcon(plan) {
  return plan.type === 'bundle' ? '📦' : '🎟';
}

// What the user would pay RIGHT NOW (renewal discount included).
function listLabel(userId, plan) {
  const q = quote(plan, userId, null);
  const icon = plan.oncePerUser ? '🎁' : planIcon(plan);
  const price = q.final === 0 ? 'FREE' : `${fmtNum(q.final)}⭐`;
  return `${icon} ${plan.title} — ${price} / ${durationLabel(userId, plan.durationDays)}`;
}

function discountBlock(userId, q) {
  if (!q.renewOff && !q.couponOff) return t(userId, 'price_plain', { price: fmtNum(q.final) });
  let lines = '';
  if (q.renewOff) lines += t(userId, 'disc_renew', { off: fmtNum(q.renewOff) });
  if (q.couponOff) lines += t(userId, 'disc_coupon', { code: escapeHtml(q.coupon.code), off: fmtNum(q.couponOff) });
  return t(userId, 'price_discount', { base: fmtNum(q.base), lines, final: fmtNum(q.final) });
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function planCardScreen(userId, plan, notice = '') {
  const couponCode = getCoupon(userId, plan.id);
  let q = quote(plan, userId, couponCode);
  if (couponCode && q.couponError) {
    clearCoupon(userId, plan.id);
    notice = t(userId, `coupon_${q.couponError}`) + '\n\n' + notice;
    q = quote(plan, userId, null);
  }

  const extending = subscriptionsDb.findActiveGroupByPlan(userId, plan.id);
  const trialBlocked = plan.oncePerUser && usersDb.hasUsedTrial(userId, plan.id);

  const text =
    (notice ? notice + '\n' : '') +
    t(userId, 'plan_card', {
      icon: planIcon(plan),
      title: escapeHtml(plan.title),
      trial: plan.oncePerUser ? t(userId, 'trial_tag') : '',
      desc: plan.description ? `${escapeHtml(plan.description)}\n\n` : '',
      channels: channelTitles(plan.channelIds),
      duration: durationLabel(userId, plan.durationDays),
      priceBlock: discountBlock(userId, q),
      balance: fmtNum(walletsDb.getBalance(userId))
    }) +
    (trialBlocked ? `\n\n${t(userId, 'trial_used')}` : '');

  const rows = [];
  if (!trialBlocked) {
    rows.push([btnSuccess(
      t(userId, extending ? 'btn_renew_extend' : 'btn_unlock', { price: fmtNum(q.final) }),
      `plan_confirm_${plan.id}`
    )]);
    if (!q.isTest && !plan.oncePerUser) {
      rows.push([q.coupon
        ? btnDanger(t(userId, 'btn_remove_coupon'), `plan_coupon_rm_${plan.id}`)
        : btn(t(userId, 'btn_coupon'), `plan_coupon_${plan.id}`)]);
    }
  }
  rows.push(navRow('menu_plans', t(userId, 'back'), t(userId, 'home')));
  return { text, kb: Markup.inlineKeyboard(rows) };
}

async function showPlanCard(ctx, plan, notice = '') {
  const { text, kb } = planCardScreen(ctx.from.id, plan, notice);
  return ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

// Confirm screen: shows exactly what will be charged and the balance after.
async function showConfirm(ctx, plan) {
  const userId = ctx.from.id;
  if (bansDb.isBanned(userId)) {
    return ctx.reply(t(userId, 'banned'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
  }
  if (!plan || !plan.active) {
    return ctx.reply(t(userId, 'plan_unavailable'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
  }
  if (plan.oncePerUser && usersDb.hasUsedTrial(userId, plan.id)) {
    return ctx.reply(t(userId, 'trial_used'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
  }

  const couponCode = getCoupon(userId, plan.id);
  let q = quote(plan, userId, couponCode);
  let notice = '';
  if (couponCode && q.couponError) {
    clearCoupon(userId, plan.id);
    notice = t(userId, `coupon_${q.couponError}`) + '\n\n';
    q = quote(plan, userId, null);
  }
  const balance = walletsDb.getBalance(userId);

  if (balance < q.final) {
    return ctx.reply(
      notice + t(userId, 'insufficient', { price: fmtNum(q.final), balance: fmtNum(balance), short: fmtNum(q.final - balance) }),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess(t(userId, 'btn_recharge_now'), 'wallet_recharge')],
          navRow(`plan_view_${plan.id}`, t(userId, 'back'), t(userId, 'home'))
        ])
      }
    );
  }

  const extending = !!subscriptionsDb.findActiveGroupByPlan(userId, plan.id);
  let lines = '';
  if (q.renewOff) lines += t(userId, 'disc_renew', { off: fmtNum(q.renewOff) });
  if (q.couponOff) lines += t(userId, 'disc_coupon', { code: escapeHtml(q.coupon.code), off: fmtNum(q.couponOff) });

  return ctx.reply(
    notice + t(userId, 'confirm_title', {
      icon: planIcon(plan), title: escapeHtml(plan.title),
      duration: durationLabel(userId, plan.durationDays), lines,
      final: fmtNum(q.final), balance: fmtNum(balance), after: fmtNum(balance - q.final),
      note: t(userId, extending ? 'confirm_note_extend' : 'confirm_note_new')
    }),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [btnSuccess(t(userId, 'confirm'), `plan_buy_${plan.id}`), btnDanger(t(userId, 'cancel'), `plan_view_${plan.id}`)]
      ])
    }
  );
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

// Creates invite links + subscription records for every channel of the plan.
// Throws if Telegram fails so the caller can refund.
async function fulfillPlanPurchase(telegram, plan, userId, pricePaid) {
  const entries = [];
  for (const channelId of plan.channelIds) {
    const channel = channelsDb.getById(channelId);
    if (!channel) continue;
    const invite = await telegram.createChatInviteLink(channel.chatId, {
      creates_join_request: true,
      name: `plan-${plan.id}-${userId}-${Date.now()}`.slice(0, 32)
    });
    const linkRecord = linksDb.add({
      id: genId('lnk'),
      channelId: channel.id,
      chatId: channel.chatId,
      inviteLink: invite.invite_link,
      ownerUserId: userId,
      type: 'plan',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: userId,
      usedAt: null,
      usedBy: null,
      price: pricePaid
    });
    // Paying again always clears any earlier expiry block for this channel.
    removedMembersDb.remove(channel.id, userId);
    entries.push({ channelId: channel.id, chatId: channel.chatId, linkId: linkRecord.id, inviteLink: invite.invite_link, title: channel.title });
  }

  let subs = [];
  if (entries.length && plan.durationDays > 0) {
    subs = subscriptionsDb.startGroup(
      entries.map(e => ({ channelId: e.channelId, chatId: e.chatId, linkId: e.linkId })),
      userId, plan.durationDays, plan.id
    );
  }
  return { entries, subs };
}

async function doPurchase(ctx, plan) {
  const userId = ctx.from.id;
  const back = Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]);

  if (bansDb.isBanned(userId)) return ctx.reply(t(userId, 'banned'), back);
  if (!plan || !plan.active) return ctx.reply(t(userId, 'plan_unavailable'), back);
  if (plan.oncePerUser && usersDb.hasUsedTrial(userId, plan.id)) return ctx.reply(t(userId, 'trial_used'), back);

  const repeatKey = `${userId}:${plan.id}`;
  const lastDone = recentBuys.get(repeatKey);
  if (lastDone && Date.now() - lastDone < REPEAT_WINDOW_MS) {
    // Same purchase just completed - don't charge twice, show subscriptions.
    const { text, kb } = mySubsScreen(userId);
    return ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }

  const couponCode = getCoupon(userId, plan.id);
  const q = quote(plan, userId, couponCode);
  if (couponCode && q.couponError) {
    // Coupon went bad between confirm and buy: show the corrected price
    // instead of silently charging a different amount.
    clearCoupon(userId, plan.id);
    return showConfirm(ctx, plan);
  }

  const extendGroup = subscriptionsDb.findActiveGroupByPlan(userId, plan.id);

  // ONE atomic check+debit. A double tap, or two devices, can never spend
  // the same balance twice.
  const debited = walletsDb.tryDebit(userId, q.final, extendGroup ? 'plan_renew' : 'plan_purchase', {
    planId: plan.id, planTitle: plan.title, couponCode: q.coupon ? q.coupon.code : undefined
  });
  if (!debited) return showConfirm(ctx, plan); // shows the "insufficient" screen
  const txn = debited.transactions[debited.transactions.length - 1];
  recentBuys.set(repeatKey, Date.now());

  const receipt = t(userId, 'receipt_purchase', {
    id: txn.id, amount: fmtNum(q.final), balance: fmtNum(debited.balance), date: fmtDate(new Date())
  });

  const finishBookkeeping = () => {
    if (q.coupon) couponsDb.consume(q.coupon.code, userId);
    clearCoupon(userId, plan.id);
    if (plan.oncePerUser) usersDb.markTrialUsed(userId, plan.id);
  };

  // ----- Extend an existing active subscription -----
  if (extendGroup) {
    const touched = subscriptionsDb.renewGroup(extendGroup.groupId, plan.durationDays);
    finishBookkeeping();
    const newExpiry = touched[0] ? touched[0].expiresAt : new Date();
    return ctx.reply(
      t(userId, 'extended', { title: escapeHtml(plan.title), date: fmtDate(newExpiry) }) + receipt,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btn(t(userId, 'home'), 'menu_main')]
        ])
      }
    );
  }

  // ----- Fresh purchase: create links -----
  try {
    const { entries, subs } = await fulfillPlanPurchase(ctx.telegram, plan, userId, q.final);
    if (entries.length === 0) {
      walletsDb.addTransaction(userId, q.final, 'plan_purchase_refund', { planId: plan.id, reason: 'no channels available' });
      recentBuys.delete(repeatKey);
      return ctx.reply(t(userId, 'no_channels_in_plan'), back);
    }
    finishBookkeeping();

    const linkLines = entries.map(e => `• <b>${escapeHtml(e.title)}</b>\n${e.inviteLink}`).join('\n\n');
    const expiry = subs.length
      ? t(userId, 'expiry_line', { date: fmtDate(subs[0].expiresAt) })
      : t(userId, 'lifetime_line');

    const rows = [];
    if (subs.length) rows.push([btnSuccess(t(userId, 'btn_enable_auto'), `autorenew_on_${subs[0].groupId}`)]);
    rows.push([btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btn(t(userId, 'home'), 'menu_main')]);

    return ctx.reply(
      t(userId, 'unlocked', { title: escapeHtml(plan.title), links: linkLines, expiry }) + receipt,
      { parse_mode: 'HTML', ...NO_PREVIEW, ...Markup.inlineKeyboard(rows) }
    );
  } catch (err) {
    console.error('[subscribe] purchase failed:', err.message);
    walletsDb.addTransaction(userId, q.final, 'plan_purchase_refund', { planId: plan.id, reason: 'fulfillment failed' });
    recentBuys.delete(repeatKey);
    return ctx.reply(t(userId, 'purchase_failed'), back);
  }
}

// ---------------------------------------------------------------------------
// My subscriptions
// ---------------------------------------------------------------------------

function mySubsScreen(userId) {
  const now = new Date();
  const groups = new Map();
  subscriptionsDb.listByUser(userId)
    .filter(s => s.status === 'active' && new Date(s.expiresAt) > now)
    .forEach(s => {
      if (!groups.has(s.groupId)) groups.set(s.groupId, []);
      groups.get(s.groupId).push(s);
    });

  if (groups.size === 0) {
    return {
      text: t(userId, 'subs_title') + '\n\n' + t(userId, 'subs_none'),
      kb: Markup.inlineKeyboard([
        [btnSuccess(t(userId, 'btn_plans'), 'menu_plans')],
        navRow('menu_account', t(userId, 'back'), t(userId, 'home'))
      ])
    };
  }

  const blocks = [];
  const rows = [];
  let i = 0;
  for (const [groupId, members] of groups) {
    i += 1;
    if (i > 8) break;
    const plan = members[0].planId ? plansDb.getById(members[0].planId) : null;
    const titles = plan ? escapeHtml(plan.title) : channelTitles(members.map(m => m.channelId));
    const auto = members[0].autoRenew;
    blocks.push(`<b>${i}.</b> ` + t(userId, 'sub_card', {
      titles, expires: fmtDate(members[0].expiresAt), left: timeLeft(members[0].expiresAt, now),
      auto: t(userId, auto ? 'on' : 'off')
    }));
    const row = [];
    row.push(btnSuccess(`🔁 ${i}`, `sub_renew_${groupId}`));
    if (members[0].planId) {
      row.push(auto
        ? btnDanger(`${t(userId, 'btn_disable_auto')} (${i})`, `subs_auto_off_${groupId}`)
        : btn(`${t(userId, 'btn_enable_auto')} (${i})`, `subs_auto_on_${groupId}`));
    }
    rows.push(row);
  }
  rows.push(navRow('menu_account', t(userId, 'back'), t(userId, 'home')));
  return {
    text: t(userId, 'subs_title') + '\n\n' + blocks.join('\n\n'),
    kb: Markup.inlineKeyboard(rows)
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function listablePlans(filterFn) {
  return plansDb.listActive().filter(p => !p.oncePerUser).filter(filterFn);
}

function register(bot) {
  bot.action('menu_plans', async ctx => {
    const userId = ctx.from.id;
    const rows = [
      [btnPrimary(t(userId, 'btn_single_plans'), 'plans_by_channel'), btnPrimary(t(userId, 'btn_bundles'), 'plans_bundles')]
    ];
    if (plansDb.listActiveTrials().length) rows.push([btnSuccess(t(userId, 'btn_trial'), 'plans_trials')]);
    rows.push([btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs')]);
    rows.push([btn(t(userId, 'home'), 'menu_main')]);
    await ctx.reply(t(userId, 'plans_title'), { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action('plans_by_channel', async ctx => {
    const userId = ctx.from.id;
    const channels = channelsDb.listActive().filter(c => plansDb.listActiveByChannel(c.id).some(p => p.type === 'single' && !p.oncePerUser));
    if (channels.length === 0) {
      return ctx.reply(t(userId, 'no_single_plans'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
    }
    const rows = channels.map(c => [btnPrimary(c.title, `plans_ch_${c.id}`)]);
    rows.push(navRow('menu_plans', t(userId, 'back'), t(userId, 'home')));
    await ctx.reply(t(userId, 'choose_channel'), Markup.inlineKeyboard(rows));
  });

  bot.action(/^plans_ch_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const channel = channelsDb.getById(ctx.match[1]);
    const back = Markup.inlineKeyboard([navRow('plans_by_channel', t(userId, 'back'), t(userId, 'home'))]);
    if (!channel) return ctx.reply(t(userId, 'channel_unavailable'), back);
    const plans = plansDb.listActiveByChannel(channel.id).filter(p => p.type === 'single' && !p.oncePerUser);
    if (plans.length === 0) return ctx.reply(t(userId, 'no_channel_plans'), back);
    const rows = plans.map(p => [btnPrimary(listLabel(userId, p), `plan_view_${p.id}`)]);
    rows.push(navRow('plans_by_channel', t(userId, 'back'), t(userId, 'home')));
    await ctx.reply(t(userId, 'channel_plans_title', { title: escapeHtml(channel.title) }), { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action('plans_bundles', async ctx => {
    const userId = ctx.from.id;
    const bundles = listablePlans(p => p.type === 'bundle');
    if (bundles.length === 0) {
      return ctx.reply(t(userId, 'no_bundles'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
    }
    const rows = bundles.map(p => [btnPrimary(listLabel(userId, p), `plan_view_${p.id}`)]);
    rows.push(navRow('menu_plans', t(userId, 'back'), t(userId, 'home')));
    await ctx.reply(t(userId, 'bundles_title'), Markup.inlineKeyboard(rows));
  });

  bot.action('plans_trials', async ctx => {
    const userId = ctx.from.id;
    const trials = plansDb.listActiveTrials();
    if (trials.length === 0) {
      return ctx.reply(t(userId, 'no_bundles'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
    }
    const rows = trials.map(p => [btnSuccess(listLabel(userId, p), `plan_view_${p.id}`)]);
    rows.push(navRow('menu_plans', t(userId, 'back'), t(userId, 'home')));
    await ctx.reply(t(userId, 'btn_trial'), Markup.inlineKeyboard(rows));
  });

  bot.action(/^plan_view_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan || !plan.active) {
      return ctx.reply(t(userId, 'plan_unavailable'), Markup.inlineKeyboard([navRow('menu_plans', t(userId, 'back'), t(userId, 'home'))]));
    }
    await showPlanCard(ctx, plan);
  });

  // ---------- Coupons ----------
  bot.action(/^plan_coupon_rm_(\S+)$/, async ctx => {
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan) return;
    clearCoupon(ctx.from.id, plan.id);
    await showPlanCard(ctx, plan, t(ctx.from.id, 'coupon_removed') + '\n');
  });

  bot.action(/^plan_coupon_(?!rm_)(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan) return;
    setState(userId, 'awaiting_coupon', { planId: plan.id });
    await ctx.reply(t(userId, 'coupon_ask'), Markup.inlineKeyboard([[btn(t(userId, 'cancel'), `plan_view_${plan.id}`)]]));
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'awaiting_coupon') return next();
    const userId = ctx.from.id;
    const plan = plansDb.getById(state.data.planId);
    clearState(userId);
    if (!plan) return ctx.reply(t(userId, 'plan_unavailable'));

    const code = couponsDb.norm(ctx.message.text);
    const v = couponsDb.validate(code, userId, plan.id);
    if (!v.ok) {
      return ctx.reply(
        t(userId, `coupon_${v.reason}`),
        Markup.inlineKeyboard([[btn(t(userId, 'btn_coupon'), `plan_coupon_${plan.id}`)], navRow(`plan_view_${plan.id}`, t(userId, 'back'), t(userId, 'home'))])
      );
    }
    setCoupon(userId, plan.id, code);
    const { text, kb } = planCardScreen(userId, plan, t(userId, 'coupon_applied', { code: escapeHtml(code) }) + '\n');
    return ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });

  // ---------- Purchase ----------
  bot.action(/^plan_confirm_(\S+)$/, async ctx => {
    await showConfirm(ctx, plansDb.getById(ctx.match[1]));
  });

  bot.action(/^plan_buy_(\S+)$/, async ctx => {
    const plan = plansDb.getById(ctx.match[1]);
    // Show instant feedback: fulfilment talks to Telegram and can be slow.
    try { await ctx.editMessageText(t(ctx.from.id, 'processing')); } catch (e) { /* message may not be editable */ }
    try {
      await doPurchase(ctx, plan);
    } catch (err) {
      console.error('[subscribe] unexpected purchase error:', err);
      await ctx.reply(
        t(ctx.from.id, 'err_slow'),
        Markup.inlineKeyboard([navRow('menu_subs', t(ctx.from.id, 'btn_my_subs'), t(ctx.from.id, 'home'))])
      );
    }
  });

  // ---------- My subscriptions ----------
  const showSubs = async ctx => {
    const { text, kb } = mySubsScreen(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  };
  bot.action('menu_subs', showSubs);
  bot.action('plans_my_subs', showSubs); // legacy button

  bot.action(/^sub_renew_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const members = subscriptionsDb.listByGroup(ctx.match[1]).filter(s => String(s.userId) === String(userId));
    if (members.length === 0) return showSubs(ctx);
    const plan = members[0].planId ? plansDb.getById(members[0].planId) : null;
    if (plan) return showConfirm(ctx, plan);
    // Old per-channel unlock (no plan record): send them to that channel.
    await ctx.reply(
      t(userId, 'plan_unavailable'),
      Markup.inlineKeyboard([
        [btnSuccess(t(userId, 'btn_channels'), `view_channel_${members[0].channelId}`)],
        navRow('menu_subs', t(userId, 'back'), t(userId, 'home'))
      ])
    );
  });

  // Toggles from the My Subscriptions list: re-render the list.
  bot.action(/^subs_auto_(on|off)_(\S+)$/, async ctx => {
    const owned = subscriptionsDb.listByGroup(ctx.match[2]).some(s => String(s.userId) === String(ctx.from.id));
    if (owned) subscriptionsDb.setGroupAutoRenew(ctx.match[2], ctx.match[1] === 'on');
    await showSubs(ctx);
  });

  // Toggles from the purchase-success message (keep the links visible!):
  // flip only the button and explain in a separate message.
  bot.action(/^autorenew_on_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const owned = subscriptionsDb.listByGroup(ctx.match[1]).some(s => String(s.userId) === String(userId));
    if (!owned) return;
    subscriptionsDb.setGroupAutoRenew(ctx.match[1], true);
    await ctx.editKeyboard(Markup.inlineKeyboard([
      [btnDanger(t(userId, 'btn_disable_auto'), `autorenew_off_${ctx.match[1]}`)],
      [btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btn(t(userId, 'home'), 'menu_main')]
    ]));
    await ctx.replyNew(t(userId, 'autorenew_on_msg'));
  });

  bot.action(/^autorenew_off_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const owned = subscriptionsDb.listByGroup(ctx.match[1]).some(s => String(s.userId) === String(userId));
    if (!owned) return;
    subscriptionsDb.setGroupAutoRenew(ctx.match[1], false);
    await ctx.editKeyboard(Markup.inlineKeyboard([
      [btnSuccess(t(userId, 'btn_enable_auto'), `autorenew_on_${ctx.match[1]}`)],
      [btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btn(t(userId, 'home'), 'menu_main')]
    ]));
    await ctx.replyNew(t(userId, 'autorenew_off_msg'));
  });
}

module.exports = {
  register, fulfillPlanPurchase, showConfirm, showPlanCard, mySubsScreen, planCardScreen
};
