const { Markup } = require('telegraf');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const channelsDb = require('../db/channels');
const config = require('../config');
const { notifyAdmins } = require('../utils/notify');
const { btnSuccess } = require('../utils/keyboards');

// Sweeps every "active" subscription, and for any whose expiry has passed,
// expires + kicks the WHOLE bundle group together (a plain single-channel
// subscription is just a "group of one", so the same code path covers both):
//   1. Kicks the member from every channel in the group
//   2. Marks every subscription record in the group as expired
//   3. Adds them to the removed-members list per channel (this is what
//      blocks a stale/leftover link from letting them back in - see
//      joinRequest.js). They come off this list automatically the moment
//      they unlock access again (see handlers/channels.js, handlers/subscribe.js).
//   4. Notifies the user (with a Renew button) and the admins
async function sweepExpiredSubscriptions(telegram) {
  const expired = subscriptionsDb.listActiveExpired(new Date());
  if (expired.length === 0) return;

  const processedGroups = new Set();

  for (const sub of expired) {
    if (processedGroups.has(sub.groupId)) continue;
    processedGroups.add(sub.groupId);

    const groupMembers = subscriptionsDb.listByGroup(sub.groupId).filter(s => s.status === 'active');
    const channelTitles = [];
    let allKicked = true;

    for (const member of groupMembers) {
      subscriptionsDb.markExpired(member.channelId, member.userId);
      removedMembersDb.add(member.channelId, member.userId, 'subscription_expired');

      const channel = channelsDb.getById(member.channelId);
      channelTitles.push(channel ? channel.title : member.chatId);

      try {
        await telegram.banChatMember(member.chatId, member.userId);
        await telegram.unbanChatMember(member.chatId, member.userId); // kick, not a permanent ban
      } catch (err) {
        allKicked = false;
        console.error(`[subscriptionExpiry] kick failed for user ${member.userId} in ${member.chatId}:`, err.message);
      }
    }

    if (groupMembers.length === 0) continue;
    const userId = groupMembers[0].userId;
    const titleList = channelTitles.join(', ');

    try {
      await telegram.sendMessage(
        userId,
        `⌛ Your access to <b>${titleList}</b> has expired and you've been removed.\n\n` +
        `Tap below to renew and get fresh join link(s) instantly.`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btnSuccess('🔁 Renew', 'menu_plans')]]) }
      );
    } catch (err) {
      console.error(`[subscriptionExpiry] notify failed for user ${userId}:`, err.message);
    }

    await notifyAdmins(telegram,
      `⌛ <b>Subscription expired</b>\n\n` +
      `Channels: ${titleList}\n` +
      `User: ${userId}\n` +
      `Expired: ${new Date(groupMembers[0].expiresAt).toLocaleString()}\n` +
      `Action: ${allKicked ? 'Kicked automatically' : 'Kick FAILED for at least one channel — check bot permissions'}`
    );
  }
}

function start(bot) {
  const intervalMs = Math.max(1, config.SUBSCRIPTION_CHECK_INTERVAL_MINUTES) * 60 * 1000;

  const run = () => {
    sweepExpiredSubscriptions(bot.telegram).catch(err => {
      console.error('[subscriptionExpiry] sweep failed:', err.message);
    });
  };

  run(); // catch anything that expired while the bot was offline
  setInterval(run, intervalMs);

  console.log(`[subscriptionExpiry] Checking for expired subscriptions every ${config.SUBSCRIPTION_CHECK_INTERVAL_MINUTES} minute(s).`);
}

module.exports = { start, sweepExpiredSubscriptions };
