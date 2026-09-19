const linksDb = require('../db/links');
const channelsDb = require('../db/channels');
const config = require('../config');
const { notifyAdmins } = require('../utils/notify');
const { userTag } = require('../utils/format');
const { contactUserButton } = require('./relayChat');

// Safety net: catches anyone who becomes a channel member WITHOUT going
// through our chat_join_request approval flow - e.g. added directly by an
// existing admin/member, or joined via the channel's own primary invite
// link if one still exists. Requires the bot to be a channel admin with
// "chat_member" updates enabled (see bot.js allowedUpdates).
function register(bot) {
  bot.on('chat_member', async ctx => {
    const update = ctx.update.chat_member;
    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    const becameMember = newStatus === 'member' && oldStatus !== 'member';
    if (!becameMember) return;

    const chatId = update.chat.id;
    const user = update.new_chat_member.user;
    const userId = user.id;
    const inviteLink = update.invite_link ? update.invite_link.invite_link : null;

    // If this matches a link WE already approved for this exact user, it's legitimate
    if (inviteLink) {
      const usedLink = linksDb.findUsedByInvite(chatId, inviteLink);
      if (usedLink && String(usedLink.usedBy) === String(userId)) {
        return;
      }
    }

    const channel = channelsDb.getByChatId(chatId);
    const channelTitle = channel ? channel.title : (update.chat.title || chatId);

    let kicked = false;
    if (config.AUTO_KICK_UNPAID) {
      try {
        await ctx.telegram.banChatMember(chatId, userId);
        await ctx.telegram.unbanChatMember(chatId, userId); // kick, not a permanent ban
        kicked = true;
      } catch (err) {
        console.error('[memberGuard] kick failed:', err.message);
      }
    }

    await notifyAdmins(ctx.telegram,
      `🚨 <b>Unauthorized channel join detected</b>\n\n` +
      `Channel: ${channelTitle}\n` +
      `User: ${userTag(user)} (id: ${userId})\n` +
      `Link used: ${inviteLink || 'unknown / added manually'}\n` +
      `Action taken: ${kicked ? 'Kicked automatically' : 'NOT kicked (AUTO_KICK_UNPAID=false)'}`,
      contactUserButton(userId));
  });
}

module.exports = { register };
