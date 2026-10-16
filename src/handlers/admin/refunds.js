const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const paymentsDb = require('../../db/payments');
const subscriptionsDb = require('../../db/subscriptions');
const removedMembersDb = require('../../db/removedMembers');
const channelsDb = require('../../db/channels');
const access = require('../../services/access');
const { refundStarsPayment } = require('../../services/refunds');
const { btnDanger, btnPrimary } = require('../../utils/keyboards');
const { escapeHtml, fmtDate } = require('../../utils/format');

const CHARGE_RE = /^[A-Za-z0-9_\-=]{6,200}$/;
const USER_RE = /^\d{1,15}$/;

const MESSAGES = {
  not_found: 'No payment with that charge ID.',
  already_refunded: 'That payment is already refunded.',
  not_refundable: 'That payment cannot be refunded yet (it is still being processed).',
  insufficient_balance: null, // built dynamically
  pending: 'Telegram did not confirm the refund (network problem). It stays pending and is retried automatically.',
  telegram_error: 'Telegram refused the refund'
};

function register(bot) {
  // /charges <userId> - find charge IDs for a user (read-only).
  bot.command('charges', async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'view_payments')) return;
    const userId = (ctx.message.text.split(/\s+/)[1] || '').trim();
    if (!USER_RE.test(userId)) return ctx.reply('Usage: /charges <userId>');
    const list = paymentsDb.listByUser(userId).slice(-10).reverse();
    if (list.length === 0) return ctx.reply('No payments for that user.');
    const lines = list.map(p =>
      `${fmtDate(p.date)} · ${p.stars}⭐ · <b>${paymentsDb.statusOf(p)}</b>\n<code>${escapeHtml(p.telegramPaymentChargeId)}</code>`
    );
    await ctx.reply(`💳 <b>Last payments of ${userId}</b>\n\n${lines.join('\n\n')}`, { parse_mode: 'HTML' });
  });

  // /refund <chargeId> - ask for confirmation first.
  bot.command('refund', async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'refund')) return;
    const chargeId = (ctx.message.text.split(/\s+/)[1] || '').trim();
    if (!CHARGE_RE.test(chargeId)) return ctx.reply('Usage: /refund <chargeId>\nFind charge IDs with /charges <userId>.');
    const p = paymentsDb.getByCharge(chargeId);
    if (!p) return ctx.reply(MESSAGES.not_found);
    await ctx.reply(
      `↩️ Refund <b>${p.stars}⭐</b> to user <code>${p.userId}</code>?\n\n` +
      'Telegram returns the Stars to the user and the same value is taken back from their wallet. ' +
      'If they already spent it, the refund is refused. Delivered subscriptions are not revoked (use /revoke).',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[btnDanger('Yes, refund', `refund_do_${chargeId}`), btnPrimary('Cancel', 'refund_cancel')]])
      }
    );
  });

  bot.action('refund_cancel', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Cancelled.');
  });

  bot.action(/^refund_do_([A-Za-z0-9_\-=]{6,200})$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'refund')) return;
    const res = await refundStarsPayment(ctx.telegram, ctx.match[1], { adminId: ctx.from.id, reason: 'admin refund' });
    if (res.ok) return ctx.reply(`✅ Refunded ${res.stars}⭐ to user ${res.userId}.`);
    if (res.code === 'insufficient_balance') {
      return ctx.reply(
        `❌ The wallet holds ${res.balance}⭐ but ${res.needed}⭐ must be taken back.\n` +
        'Revoke their access or adjust the wallet deliberately, then try again.'
      );
    }
    return ctx.reply(`❌ ${MESSAGES[res.code] || res.code}${res.detail ? `\n${String(res.detail).slice(0, 200)}` : ''}`);
  });

  // /revoke <userId> - end all active access right now (queued, retried, audited).
  bot.command('revoke', async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const userId = (ctx.message.text.split(/\s+/)[1] || '').trim();
    if (!USER_RE.test(userId)) return ctx.reply('Usage: /revoke <userId>');
    if (adminsDb.isAdmin(userId)) return ctx.reply('❌ You cannot revoke an admin.');
    const active = subscriptionsDb.listByUser(userId).filter(s => s.status === 'active');
    if (active.length === 0) return ctx.reply('That user has no active subscriptions.');
    const titles = active.map(s => (channelsDb.getById(s.channelId) || { title: s.chatId }).title);
    await ctx.reply(
      `⛔ Revoke access of <code>${userId}</code> to:\n${titles.map(x => `• ${escapeHtml(x)}`).join('\n')}\n\nThey are removed from the channels and cannot rejoin until they pay again.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[btnDanger('Yes, revoke', `revoke_do_${userId}`), btnPrimary('Cancel', 'refund_cancel')]])
      }
    );
  });

  bot.action(/^revoke_do_(\d{1,15})$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const userId = ctx.match[1];
    const groups = new Set(subscriptionsDb.listByUser(userId).filter(s => s.status === 'active').map(s => s.groupId));
    let n = 0;
    for (const groupId of groups) {
      for (const s of subscriptionsDb.revokeGroup(groupId)) {
        access.enqueueRemoval({ channelId: s.channelId, chatId: s.chatId, userId, reason: 'admin_revoke', subId: s.id });
        access.revokePendingLinks(s.channelId, userId);
        removedMembersDb.add(s.channelId, userId, 'admin_revoke');
        n += 1;
      }
    }
    auditDb.add(ctx.from.id, 'revoke', `user ${userId}, ${n} channel(s)`);
    await ctx.reply(`✅ Access revoked in ${n} channel(s). Removal is queued and retried automatically.`);
  });
}

module.exports = { register };
