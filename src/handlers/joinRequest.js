const linksDb = require('../db/links');
const channelsDb = require('../db/channels');
const removedMembersDb = require('../db/removedMembers');
const { notifyAdmins } = require('../utils/notify');
const { userTag } = require('../utils/format');
const { misuseActionButtons } = require('../utils/keyboards');

// This is the heart of the access-control logic. Every channel invite link
// we generate has creates_join_request: true, so nobody ever joins
// instantly - they send a "join request" that we approve or decline here
// based on whether the requester is the exact user the link was made for.
function register(bot) {
  bot.on('chat_join_request', async ctx => {
    const req = ctx.chatJoinRequest;
    const chatId = req.chat.id;
    const userId = req.from.id;
    const inviteLinkStr = req.invite_link ? req.invite_link.invite_link : null;

    if (!inviteLinkStr) {
      // Join request with no invite link attached at all - reject to be safe
      try { await ctx.telegram.declineChatJoinRequest(chatId, userId); } catch (e) {}
      await notifyAdmins(ctx.telegram,
        `⚠️ <b>Join request without an invite link</b>\n` +
        `User: ${userTag(req.from)}\nChat: ${req.chat.title || chatId}\n` +
        `Declined automatically.`);
      return;
    }

    const pendingLink = linksDb.findPendingByInvite(chatId, inviteLinkStr);

    if (!pendingLink) {
      // Link is unknown to us, already used, or expired/revoked
      try { await ctx.telegram.declineChatJoinRequest(chatId, userId); } catch (e) {}
      await notifyAdmins(ctx.telegram,
        `🚫 <b>Rejected join request — link not valid or already used</b>\n` +
        `User: ${userTag(req.from)}\nChat: ${req.chat.title || chatId}\n` +
        `Link: ${inviteLinkStr}`,
        misuseActionButtons(userId, null));
      return;
    }

    // ownerUserId is null for "open" manual links - first requester wins
    const isOpenLink = pendingLink.ownerUserId === null || pendingLink.ownerUserId === undefined;
    const isOwner = isOpenLink || String(pendingLink.ownerUserId) === String(userId);

    if (isOwner) {
      // Extra safety net: if this exact user was kicked for this exact
      // channel (expired subscription, etc.) and hasn't been cleared since,
      // block them even though the link itself matches. In normal flow
      // this never triggers, because unlocking access again already clears
      // the block - this only catches edge-case races.
      if (removedMembersDb.isRemoved(pendingLink.channelId, userId)) {
        try { await ctx.telegram.declineChatJoinRequest(chatId, userId); } catch (e) {}
        try {
          await ctx.telegram.sendMessage(
            userId,
            `⚠️ Your previous access to this channel was removed and hasn't been cleared yet. Please recharge and unlock access again.`
          );
        } catch (e) {}
        return;
      }

      try {
        await ctx.telegram.approveChatJoinRequest(chatId, userId);
        linksDb.update(pendingLink.id, { status: 'used', usedAt: new Date().toISOString(), usedBy: userId });
        // Fully kill the link so it can never be reused, even by the same
        // person leaving and rejoining, or a screenshot of the link.
        await ctx.telegram.revokeChatInviteLink(chatId, inviteLinkStr).catch(() => {});
      } catch (err) {
        console.error('[joinRequest] approve failed:', err.message);
      }
      return;
    }

    // Someone other than the paying/assigned user tried to use this link
    try { await ctx.telegram.declineChatJoinRequest(chatId, userId); } catch (e) {}

    const channel = channelsDb.getById(pendingLink.channelId);
    const channelTitle = channel ? channel.title : req.chat.title;

    // Let the rightful owner know their link is still safe
    try {
      await ctx.telegram.sendMessage(
        pendingLink.ownerUserId,
        `⚠️ Someone else tried to use your link for <b>${channelTitle}</b> and was blocked.\n` +
        `Your link is still valid — only you can use it.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('[joinRequest] notify owner failed:', err.message);
    }

    await notifyAdmins(ctx.telegram,
      `🚨 <b>Link misuse attempt</b>\n\n` +
      `Channel: ${channelTitle}\n` +
      `Link owner (paid): ${pendingLink.ownerUserId}\n` +
      `Attempted by: ${userTag(req.from)} (id: ${userId})\n` +
      `Link: ${inviteLinkStr}\n\n` +
      `Request was declined automatically. The owner's link is untouched.`,
      misuseActionButtons(userId, pendingLink.id));
  });
}

module.exports = { register };
