const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const channelsDb = require('../db/channels');
const config = require('../config');
const { notifyAdmins } = require('../utils/notify');

// Sweeps every "active" subscription, and for any whose expiry has passed:
//   1. Kicks the member from the channel
//   2. Marks the subscription as expired
//   3. Adds them to the removed-members list for that channel (this is what
//      blocks a stale/leftover link from letting them back in - see
//      joinRequest.js). They come off this list automatically the moment
//      they unlock access again (see handlers/channels.js).
//   4. Notifies the user and the admins
async function sweepExpiredSubscriptions(telegram) {
  const expired = subscriptionsDb.listActiveExpired(new Date());
  if (expired.length === 0) return;

  for (const sub of expired) {
    subscriptionsDb.markExpired(sub.channelId, sub.userId);
    removedMembersDb.add(sub.channelId, sub.userId, 'subscription_expired');

    const channel = channelsDb.getById(sub.channelId);
    const channelTitle = channel ? channel.title : sub.chatId;

    let kicked = false;
    try {
      await telegram.banChatMember(sub.chatId, sub.userId);
      await telegram.unbanChatMember(sub.chatId, sub.userId); // kick, not a permanent ban
      kicked = true;
    } catch (err) {
      console.error(`[subscriptionExpiry] kick failed for user ${sub.userId} in ${sub.chatId}:`, err.message);
    }

    try {
      await telegram.sendMessage(
        sub.userId,
        `⌛ Your subscription to <b>${channelTitle}</b> has expired and you've been removed from the channel.\n\n` +
        `Recharge your wallet and unlock access again anytime to rejoin.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error(`[subscriptionExpiry] notify failed for user ${sub.userId}:`, err.message);
    }

    await notifyAdmins(telegram,
      `⌛ <b>Subscription expired</b>\n\n` +
      `Channel: ${channelTitle}\n` +
      `User: ${sub.userId}\n` +
      `Started: ${new Date(sub.startedAt).toLocaleString()}\n` +
      `Expired: ${new Date(sub.expiresAt).toLocaleString()}\n` +
      `Action: ${kicked ? 'Kicked automatically' : 'Kick FAILED — check bot permissions'}`
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
