const { Markup } = require('telegraf');
const channelsDb = require('../db/channels');
const walletsDb = require('../db/wallets');
const linksDb = require('../db/links');
const bansDb = require('../db/bans');
const adminsDb = require('../db/admins');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const { genId } = require('../utils/ids');
const { btn, btnPrimary, btnSuccess, navRow } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, fmtDate, fmtNum } = require('../utils/format');

const NO_PREVIEW = { link_preview_options: { is_disabled: true } };

// Admins see a special (usually much lower) test price so they can try the
// full purchase flow without spending real Stars.
function priceForUser(channel, userId) {
  if (adminsDb.isAdmin(userId) && channel.testPrice !== undefined && channel.testPrice !== null) {
    return channel.testPrice;
  }
  return channel.price;
}

const recentUnlocks = new Map();
const REPEAT_WINDOW_MS = 25 * 1000;

function register(bot) {
  bot.action('menu_channels', async ctx => {
    const userId = ctx.from.id;
    const list = channelsDb.listActive();
    if (list.length === 0) {
      return ctx.reply(t(userId, 'no_channels'), Markup.inlineKeyboard([navRow(null, '', t(userId, 'home'))]));
    }
    const rows = list.map(c => {
      const price = priceForUser(c, userId);
      const test = adminsDb.isAdmin(userId) && price !== c.price ? ' (test)' : '';
      return [btnPrimary(`${c.title} — ${fmtNum(price)}⭐${test}`, `view_channel_${c.id}`)];
    });
    rows.push([btn(t(userId, 'home'), 'menu_main')]);
    await ctx.reply(t(userId, 'channels_title'), Markup.inlineKeyboard(rows));
  });

  bot.action(/^view_channel_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const channel = channelsDb.getById(ctx.match[1]);
    const back = Markup.inlineKeyboard([navRow('menu_channels', t(userId, 'back'), t(userId, 'home'))]);
    if (!channel || !channel.active) return ctx.reply(t(userId, 'channel_unavailable'), back);
    const price = priceForUser(channel, userId);
    const balance = walletsDb.getBalance(userId);
    await ctx.reply(
      t(userId, 'channel_card', {
        title: escapeHtml(channel.title),
        desc: channel.description ? `${escapeHtml(channel.description)}\n\n` : '',
        price: fmtNum(price),
        duration: channel.durationDays ? t(userId, 'channel_duration', { days: channel.durationDays }) : '',
        balance: fmtNum(balance)
      }),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess(t(userId, 'btn_unlock_channel'), `unlock_${channel.id}`)],
          navRow('menu_channels', t(userId, 'back'), t(userId, 'home'))
        ])
      }
    );
  });

  bot.action(/^unlock_(\S+)$/, async ctx => {
    const userId = ctx.from.id;
    const back = Markup.inlineKeyboard([navRow('menu_channels', t(userId, 'back'), t(userId, 'home'))]);

    if (bansDb.isBanned(userId)) return ctx.reply(t(userId, 'banned'), back);

    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel || !channel.active) return ctx.reply(t(userId, 'channel_unavailable'), back);

    const repeatKey = `${userId}:${channel.id}`;
    const last = recentUnlocks.get(repeatKey);
    if (last && Date.now() - last < REPEAT_WINDOW_MS) return; // same unlock just finished

    const price = priceForUser(channel, userId);
    const balance = walletsDb.getBalance(userId);

    if (balance < price) {
      return ctx.reply(
        t(userId, 'insufficient', { price: fmtNum(price), balance: fmtNum(balance), short: fmtNum(price - balance) }),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [btnSuccess(t(userId, 'btn_recharge_now'), 'wallet_recharge')],
            navRow(`view_channel_${channel.id}`, t(userId, 'back'), t(userId, 'home'))
          ])
        }
      );
    }

    // Instant feedback while Telegram creates the link (can be slow).
    try { await ctx.editMessageText(t(userId, 'processing')); } catch (e) { /* not editable */ }

    let invite = null;
    try {
      // Create the invite link FIRST. Only deduct from the wallet once we
      // know link creation actually succeeded, so a Telegram API failure
      // never charges the user for nothing.
      invite = await ctx.telegram.createChatInviteLink(channel.chatId, {
        creates_join_request: true,
        name: `paid-${userId}-${Date.now()}`.slice(0, 32)
      });

      const debited = walletsDb.tryDebit(userId, price, 'channel_unlock', {
        channelId: channel.id, channelTitle: channel.title
      });
      if (!debited) {
        // Balance changed while we were talking to Telegram.
        ctx.telegram.revokeChatInviteLink(channel.chatId, invite.invite_link).catch(() => {});
        return ctx.reply(t(userId, 'insufficient', {
          price: fmtNum(price), balance: fmtNum(walletsDb.getBalance(userId)), short: fmtNum(price - walletsDb.getBalance(userId))
        }), { parse_mode: 'HTML', ...back });
      }
      recentUnlocks.set(repeatKey, Date.now());

      const link = {
        id: genId('lnk'),
        channelId: channel.id,
        chatId: channel.chatId,
        inviteLink: invite.invite_link,
        ownerUserId: userId,
        type: 'paid',
        status: 'pending',
        createdAt: new Date().toISOString(),
        createdBy: userId,
        usedAt: null,
        usedBy: null,
        price
      };
      linksDb.add(link);

      // Paying again is how a user "renews" - always clear any earlier
      // expiry block so their fresh link actually works.
      removedMembersDb.remove(channel.id, userId);

      let expiry = t(userId, 'lifetime_line');
      if (channel.durationDays && channel.durationDays > 0) {
        const sub = subscriptionsDb.start(channel.id, userId, channel.chatId, link.id, channel.durationDays);
        expiry = t(userId, 'expiry_line', { date: fmtDate(sub.expiresAt) });
      }

      const txn = debited.transactions[debited.transactions.length - 1];
      await ctx.reply(
        t(userId, 'channel_unlocked', { title: escapeHtml(channel.title), link: invite.invite_link, expiry }) +
        t(userId, 'receipt_purchase', { id: txn.id, amount: fmtNum(price), balance: fmtNum(debited.balance), date: fmtDate(new Date()) }),
        {
          parse_mode: 'HTML', ...NO_PREVIEW,
          ...Markup.inlineKeyboard([[btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btn(t(userId, 'home'), 'menu_main')]])
        }
      );
    } catch (err) {
      console.error('[channels] unlock failed:', err.message);
      await ctx.reply(t(userId, 'channel_unlock_failed'), back);
    }
  });
}

module.exports = { register, priceForUser };
