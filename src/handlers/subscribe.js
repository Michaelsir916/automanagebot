const { Markup } = require('telegraf');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const bansDb = require('../db/bans');
const adminsDb = require('../db/admins');
const { genId } = require('../utils/ids');
const { btnPrimary, btnSuccess, btnDanger } = require('../utils/keyboards');

// Admins see a lower test price on plans too, same idea as channels.js.
function priceForUser(plan, userId) {
  if (adminsDb.isAdmin(userId) && plan.testPrice !== undefined && plan.testPrice !== null) {
    return plan.testPrice;
  }
  return plan.price;
}

function durationLabel(days) {
  return days > 0 ? `${days} day(s)` : 'lifetime';
}

function channelTitles(channelIds) {
  return channelIds.map(id => (channelsDb.getById(id) || { title: 'Unknown' }).title).join(' + ');
}

async function sendPlanInvoice(ctx, plan) {
  const price = priceForUser(plan, ctx.from.id);
  try {
    await ctx.telegram.sendInvoice(ctx.from.id, {
      title: plan.title,
      description: `${plan.type === 'bundle' ? '📦 Bundle' : '🎟 Plan'}: ${channelTitles(plan.channelIds)} — ${durationLabel(plan.durationDays)} access`,
      // '|' as delimiter (not '_') so we can tell this apart from wallet
      // recharge payloads and from genId's own use of '_'
      payload: `planpay|${plan.id}|${ctx.from.id}|${Date.now()}`,
      provider_token: '', // must be empty for Telegram Stars payments
      currency: 'XTR',
      prices: [{ label: `${plan.title} (${price}⭐)`, amount: price }]
    });
  } catch (err) {
    console.error('[subscribe] sendInvoice failed:', err.message);
    await ctx.reply('⚠️ Could not create the payment invoice. Please try again later.');
  }
}

async function fulfillPlanPurchase(ctx, plan, userId) {
  const entries = [];
  for (const channelId of plan.channelIds) {
    const channel = channelsDb.getById(channelId);
    if (!channel) continue;
    const invite = await ctx.telegram.createChatInviteLink(channel.chatId, {
      creates_join_request: true,
      name: `plan-${plan.id}-${userId}-${Date.now()}`
    });
    const linkRecord = require('../db/links').add({
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
      price: priceForUser(plan, userId)
    });
    // Paying again always clears any earlier expiry block for this channel.
    removedMembersDb.remove(channel.id, userId);
    entries.push({ channelId: channel.id, chatId: channel.chatId, linkId: linkRecord.id, inviteLink: invite.invite_link, title: channel.title });
  }

  if (entries.length === 0) {
    await ctx.reply('⚠️ None of the channels in this plan are available anymore. Please contact support - you have not lost your Stars, contact an admin for a manual refund.');
    return;
  }

  let subs = [];
  if (plan.durationDays > 0) {
    subs = subscriptionsDb.startGroup(
      entries.map(e => ({ channelId: e.channelId, chatId: e.chatId, linkId: e.linkId })),
      userId, plan.durationDays, plan.id
    );
  }

  const linkLines = entries.map(e => `• <b>${e.title}</b>\n${e.inviteLink}`).join('\n\n');
  const expiryLine = subs.length
    ? `\n⏳ Access valid until <b>${new Date(subs[0].expiresAt).toLocaleString()}</b>. You'll be automatically removed after that unless you renew.\n`
    : '\n♾ Lifetime access - no expiry.\n';
  const renewRow = subs.length
    ? [btnSuccess('🔁 Enable Auto-Renew', `autorenew_on_${subs[0].groupId}`)]
    : [];

  await ctx.reply(
    `✅ <b>${plan.title}</b> unlocked!\n\n${linkLines}\n${expiryLine}\n` +
    `⚠️ These links work for <b>you only</b>. Tap each, send the join request, and it'll be approved automatically.`,
    {
      parse_mode: 'HTML',
      ...(renewRow.length ? Markup.inlineKeyboard([renewRow]) : {})
    }
  );
}

function register(bot) {
  bot.action('menu_plans', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '🎟 <b>Plans</b>\n\nBrowse single-channel plans or save more with a bundle across several channels.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnPrimary('🎟 Single Channel Plans', 'plans_by_channel')],
          [btnPrimary('📦 Bundles', 'plans_bundles')],
          [btnPrimary('📜 My Active Subscriptions', 'plans_my_subs')],
          [Markup.button.callback('⬅️ Back', 'menu_main')]
        ])
      }
    );
  });

  bot.action('plans_by_channel', async ctx => {
    await ctx.answerCbQuery();
    const channels = channelsDb.listActive().filter(c => plansDb.listActiveByChannel(c.id).some(p => p.type === 'single'));
    if (channels.length === 0) return ctx.reply('No single-channel plans available right now.');
    const rows = channels.map(c => [btnPrimary(c.title, `plans_ch_${c.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu_plans')]);
    await ctx.reply('📢 Choose a channel:', Markup.inlineKeyboard(rows));
  });

  bot.action(/plans_ch_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel not found.');
    const plans = plansDb.listActiveByChannel(channel.id).filter(p => p.type === 'single');
    if (plans.length === 0) return ctx.reply('No plans for this channel right now.');
    const rows = plans.map(p => [btnPrimary(`${p.title} — ${priceForUser(p, ctx.from.id)}⭐ / ${durationLabel(p.durationDays)}`, `plan_view_${p.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'plans_by_channel')]);
    await ctx.reply(`📢 <b>${channel.title}</b> — available plans:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action('plans_bundles', async ctx => {
    await ctx.answerCbQuery();
    const bundles = plansDb.listActiveBundles();
    if (bundles.length === 0) return ctx.reply('No bundles available right now.');
    const rows = bundles.map(p => [btnPrimary(`📦 ${p.title} — ${priceForUser(p, ctx.from.id)}⭐ / ${durationLabel(p.durationDays)}`, `plan_view_${p.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu_plans')]);
    await ctx.reply('📦 Available bundles:', Markup.inlineKeyboard(rows));
  });

  bot.action(/plan_view_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan || !plan.active) return ctx.reply('This plan is no longer available.');
    const price = priceForUser(plan, ctx.from.id);
    await ctx.reply(
      `${plan.type === 'bundle' ? '📦' : '🎟'} <b>${plan.title}</b>\n\n` +
      `Includes: ${channelTitles(plan.channelIds)}\n` +
      `Price: <b>${price} ⭐</b>\n` +
      `Access length: <b>${durationLabel(plan.durationDays)}</b>\n\n` +
      `Payment is via Telegram Stars - you'll get your join link(s) immediately after paying.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess(`💳 Pay ${price}⭐`, `plan_buy_${plan.id}`)],
          [Markup.button.callback('⬅️ Back', 'menu_plans')]
        ])
      }
    );
  });

  bot.action(/plan_buy_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (bansDb.isBanned(ctx.from.id)) return ctx.reply('🚫 You are banned from using this service.');
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan || !plan.active) return ctx.reply('This plan is no longer available.');
    await sendPlanInvoice(ctx, plan);
  });

  bot.action('plans_my_subs', async ctx => {
    await ctx.answerCbQuery();
    const subs = subscriptionsDb.listByUser(ctx.from.id).filter(s => s.status === 'active');
    if (subs.length === 0) return ctx.reply('You have no active subscriptions yet.');
    const groups = new Map();
    subs.forEach(s => {
      if (!groups.has(s.groupId)) groups.set(s.groupId, []);
      groups.get(s.groupId).push(s);
    });
    for (const [groupId, members] of groups) {
      const titles = channelTitles(members.map(m => m.channelId));
      const expiresAt = new Date(members[0].expiresAt).toLocaleString();
      const autoRenew = members[0].autoRenew;
      await ctx.reply(
        `📢 ${titles}\n⏳ Expires: ${expiresAt}\n🔁 Auto-renew: ${autoRenew ? 'ON ✅' : 'OFF'}`,
        Markup.inlineKeyboard([[
          autoRenew
            ? btnDanger('🔁 Turn Off Auto-Renew', `autorenew_off_${groupId}`)
            : btnSuccess('🔁 Turn On Auto-Renew', `autorenew_on_${groupId}`)
        ]])
      );
    }
  });

  bot.action(/autorenew_on_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    subscriptionsDb.setGroupAutoRenew(ctx.match[1], true);
    await ctx.reply(
      '🔁 Auto-renew turned ON.\n\n' +
      'Shortly before expiry, the bot will try to charge your bot-wallet balance ' +
      '(💰 the same one you top up with Stars) for the same plan. Keep it funded so renewal doesn\'t fail!\n\n' +
      'If the charge fails (balance too low), auto-renew turns off automatically and normal expiry/kick applies.'
    );
  });

  bot.action(/autorenew_off_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    subscriptionsDb.setGroupAutoRenew(ctx.match[1], false);
    await ctx.reply('🔁 Auto-renew turned OFF.');
  });

  // Successful payment for a plan/bundle purchase (payload set in
  // sendPlanInvoice above). Wallet-recharge payments are claimed first by
  // handlers/wallet.js and never reach here.
  bot.on('message', async (ctx, next) => {
    const payment = ctx.message.successful_payment;
    if (!payment || !payment.invoice_payload.startsWith('planpay|')) return next();

    const [, planId, payloadUserId] = payment.invoice_payload.split('|');
    const userId = payloadUserId || ctx.from.id;

    const plan = plansDb.getById(planId);
    if (!plan) {
      await ctx.reply('⚠️ That plan no longer exists. Please contact an admin for a refund - your Stars payment succeeded.');
      return;
    }

    require('../db/payments').add(userId, payment.total_amount, payment.telegram_payment_charge_id, {
      type: 'plan_purchase', planId: plan.id, planTitle: plan.title
    });

    try {
      await fulfillPlanPurchase(ctx, plan, userId);
    } catch (err) {
      console.error('[subscribe] fulfillment failed:', err.message);
      await ctx.reply('⚠️ Payment succeeded but something went wrong generating your link(s). Please contact support.');
    }
  });
}

module.exports = { register, priceForUser, fulfillPlanPurchase };
