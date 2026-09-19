const { Markup } = require('telegraf');
const channelsDb = require('../db/channels');
const walletsDb = require('../db/wallets');
const linksDb = require('../db/links');
const bansDb = require('../db/bans');
const adminsDb = require('../db/admins');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const { genId } = require('../utils/ids');

// Admins see a special (usually much lower) test price so they can try the
// full purchase flow without spending real Stars.
function priceForUser(channel, userId) {
  if (adminsDb.isAdmin(userId) && channel.testPrice !== undefined && channel.testPrice !== null) {
    return channel.testPrice;
  }
  return channel.price;
}

function register(bot) {
  bot.action('menu_channels', async ctx => {
    await ctx.answerCbQuery();
    const list = channelsDb.listActive();
    if (list.length === 0) {
      return ctx.reply('No channels available right now. Please check back later.');
    }
    const rows = list.map(c => {
      const price = priceForUser(c, ctx.from.id);
      const label = adminsDb.isAdmin(ctx.from.id) && price !== c.price
        ? `${c.title} — ${price}⭐ (test price)`
        : `${c.title} — ${price}⭐`;
      return [Markup.button.callback(label, `view_channel_${c.id}`)];
    });
    rows.push([Markup.button.callback('⬅️ Back', 'menu_main')]);
    await ctx.reply('📢 Available Channels:', Markup.inlineKeyboard(rows));
  });

  bot.action(/view_channel_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel || !channel.active) return ctx.reply('This channel is no longer available.');
    const price = priceForUser(channel, ctx.from.id);
    const balance = walletsDb.getBalance(ctx.from.id);
    const durationLine = channel.durationDays
      ? `Access length: <b>${channel.durationDays} day(s)</b>\n`
      : '';
    await ctx.reply(
      `📢 <b>${channel.title}</b>\n\n` +
      `Price: <b>${price} ⭐</b>\n` +
      durationLine +
      `Your wallet balance: <b>${balance} ⭐</b>\n\n` +
      `Unlocking gives you a one-time join link that works only for you.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔓 Unlock Access', `unlock_${channel.id}`)],
          [Markup.button.callback('⬅️ Back', 'menu_channels')]
        ])
      }
    );
  });

  bot.action(/unlock_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;

    if (bansDb.isBanned(userId)) {
      return ctx.reply('🚫 You are banned from using this service. Contact support if you think this is a mistake.');
    }

    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel || !channel.active) return ctx.reply('This channel is no longer available.');

    const price = priceForUser(channel, userId);
    const balance = walletsDb.getBalance(userId);

    if (balance < price) {
      return ctx.reply(
        `❌ Insufficient balance.\n\nYou need ${price}⭐ but your wallet has ${balance}⭐.`,
        Markup.inlineKeyboard([[Markup.button.callback('💰 Recharge Wallet', 'menu_wallet')]])
      );
    }

    try {
      // Create the invite link FIRST. Only deduct from the wallet once we
      // know link creation actually succeeded, so a Telegram API failure
      // never charges the user for nothing.
      const invite = await ctx.telegram.createChatInviteLink(channel.chatId, {
        creates_join_request: true,
        name: `paid-${userId}-${Date.now()}`
      });

      walletsDb.addTransaction(userId, -price, 'channel_unlock', {
        channelId: channel.id,
        channelTitle: channel.title
      });

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

      let expiryLine = '';
      if (channel.durationDays && channel.durationDays > 0) {
        const sub = subscriptionsDb.start(channel.id, userId, channel.chatId, link.id, channel.durationDays);
        const expiryDate = new Date(sub.expiresAt).toLocaleString();
        expiryLine = `\n⏳ Your access is valid until <b>${expiryDate}</b>. You'll be automatically removed after that unless you recharge and unlock again.\n`;
      }

      await ctx.reply(
        `✅ Access unlocked for <b>${channel.title}</b>!\n\n` +
        `🔗 Your one-time join link:\n${invite.invite_link}\n` +
        expiryLine +
        `\n⚠️ This link works for <b>you only</b>. Tap it, send the join request, and it will be approved automatically within seconds.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('[channels] unlock failed:', err.message);
      await ctx.reply('⚠️ Something went wrong generating your link. Please contact support — you have not been charged.');
    }
  });
}

module.exports = { register, priceForUser };
