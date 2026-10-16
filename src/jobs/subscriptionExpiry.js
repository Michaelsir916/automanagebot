const { Markup } = require('telegraf');
const subscriptionsDb = require('../db/subscriptions');
const removedMembersDb = require('../db/removedMembers');
const channelsDb = require('../db/channels');
const config = require('../config');
const access = require('../services/access');
const { notifyAdmins } = require('../utils/notify');
const { btnSuccess } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml } = require('../utils/format');

// Sweeps every "active" subscription, and for any whose expiry has passed,
// expires the WHOLE bundle group together (a plain single-channel
// subscription is just a "group of one", so the same code path covers both):
//   1. Queues a durable "remove member" job for every channel in the group.
//      The job checks the member's real state, retries with backoff and
//      survives restarts (see services/access.js and jobs/jobRunner.js), so a
//      Telegram outage can no longer leave an expired member inside.
//   2. Marks every subscription record in the group as expired. The jobs are
//      queued FIRST: if the process dies in between, the next sweep finds the
//      subscriptions still active and queues the same jobs again (deduplicated).
//   3. Adds them to the removed-members list per channel (blocks a stale link
//      from letting them back in - see joinRequest.js). They come off the list
//      automatically the moment they unlock access again.
//   4. Notifies the user (with a Renew button) and the admins.
async function sweepExpiredSubscriptions(telegram, now = new Date()) {
  const expired = subscriptionsDb.listActiveExpired(now);
  if (expired.length === 0) return 0;

  const processedGroups = new Set();
  let handled = 0;

  for (const sub of expired) {
    if (processedGroups.has(sub.groupId)) continue;
    processedGroups.add(sub.groupId);

    const groupMembers = subscriptionsDb.listByGroup(sub.groupId).filter(s => s.status === 'active');
    if (groupMembers.length === 0) continue;
    const channelTitles = [];

    for (const member of groupMembers) {
      access.enqueueRemoval({
        channelId: member.channelId, chatId: member.chatId, userId: member.userId,
        reason: 'subscription_expired', subId: member.id
      });
      const channel = channelsDb.getById(member.channelId);
      channelTitles.push(channel ? channel.title : member.chatId);
    }
    for (const member of groupMembers) {
      subscriptionsDb.markExpired(member.channelId, member.userId);
      removedMembersDb.add(member.channelId, member.userId, 'subscription_expired');
    }
    handled += 1;

    const userId = groupMembers[0].userId;
    const titleList = channelTitles.join(', ');

    try {
      await telegram.sendMessage(
        userId,
        t(userId, 'expired_msg', { titles: escapeHtml(titleList) }),
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btnSuccess(t(userId, 'btn_renew_now'), 'menu_plans')]]) }
      );
    } catch (err) {
      console.error(`[subscriptionExpiry] notify failed for user ${userId}:`, err.message);
    }

    await notifyAdmins(telegram,
      `⌛ <b>Subscription expired</b>\n\n` +
      `Channels: ${escapeHtml(titleList)}\n` +
      `User: ${userId}\n` +
      `Expired: ${new Date(groupMembers[0].expiresAt).toLocaleString()}\n` +
      `Action: removal queued (retried automatically; you are alerted if it keeps failing)`
    );
  }
  return handled;
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
