const linksDb = require('../db/links');
const channelsDb = require('../db/channels');
const membershipEvents = require('../db/membershipEvents');
const access = require('../services/access');
const { notifyAdmins } = require('../utils/notify');
const { userTag } = require('../utils/format');
const { errText } = require('../utils/resilience');
const config = require('../config');
const { contactUserButton } = require('./relayChat');

// Two jobs in one chat_member handler:
//  1. HISTORY: every membership change in a managed channel is written to the
//     membership event log (joined / left / removed / banned ...). Only what
//     the bot actually observes is recorded; see docs/FEATURES.md for coverage.
//  2. SAFETY NET: catches anyone who becomes a channel member WITHOUT going
//     through our chat_join_request approval flow - e.g. added directly by an
//     existing admin/member, or joined via the channel's own primary invite
//     link if one still exists. Requires the bot to be a channel admin with
//     "chat_member" updates enabled (see bot.js allowedUpdates).
function register(bot) {
  bot.on('chat_member', async ctx => {
    const update = ctx.update.chat_member;
    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    const chatId = update.chat.id;
    const user = update.new_chat_member.user;
    const userId = user.id;
    const inviteLink = update.invite_link ? update.invite_link.invite_link : null;
    const channel = channelsDb.getByChatId(chatId);

    if (channel && oldStatus !== newStatus) {
      try {
        membershipEvents.record({
          chatId, channelId: channel.id, userId,
          kind: membershipEvents.classify(oldStatus, newStatus, update.from && update.from.id, userId),
          oldStatus, newStatus, actorId: update.from && update.from.id,
          inviteLink, updateId: ctx.update.update_id, source: 'telegram',
          at: update.date ? new Date(update.date * 1000).toISOString() : undefined
        });
      } catch (err) {
        console.error('[memberGuard] could not record membership event:', errText(err));
      }
    }

    const becameMember = newStatus === 'member' && oldStatus !== 'member';
    if (!becameMember) return;

    // If this matches a link WE already approved for this exact user, it's legitimate
    if (inviteLink) {
      const usedLink = linksDb.findUsedByInvite(chatId, inviteLink);
      if (usedLink && String(usedLink.usedBy) === String(userId)) {
        return;
      }
    }

    const channelTitle = channel ? channel.title : (update.chat.title || chatId);

    let outcome = 'NOT removed (AUTO_KICK_UNPAID=false)';
    if (config.AUTO_KICK_UNPAID) {
      const payload = {
        channelId: channel ? channel.id : null, chatId: String(chatId), userId: String(userId),
        reason: 'unauthorized_join'
      };
      try {
        // Try right away; if Telegram fails, the durable queue keeps retrying.
        await access.handleRemoveMember(ctx.telegram, payload);
        outcome = 'Kicked automatically';
      } catch (err) {
        console.error('[memberGuard] kick failed, queued for retry:', errText(err));
        access.enqueueRemoval({ ...payload, subId: String(ctx.update.update_id) });
        outcome = 'Kick FAILED - queued for automatic retry (check bot permissions)';
      }
    }

    await notifyAdmins(ctx.telegram,
      `🚨 <b>Unauthorized channel join detected</b>\n\n` +
      `Channel: ${channelTitle}\n` +
      `User: ${userTag(user)} (id: ${userId})\n` +
      `Link used: ${inviteLink ? 'an invite link' : 'unknown / added manually'}\n` +
      `Action taken: ${outcome}`,
      contactUserButton(userId));
  });
}

module.exports = { register };
