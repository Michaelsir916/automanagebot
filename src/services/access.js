const linksDb = require('../db/links');
const subscriptionsDb = require('../db/subscriptions');
const jobsDb = require('../db/jobs');
const config = require('../config');
const { genId } = require('../utils/ids');
const { errText } = require('../utils/resilience');

// ---------------------------------------------------------------------------
// Everything that touches a channel's access list goes through here: creating
// invite links, revoking them, removing members, checking the bot's rights.
// Destructive operations (removal, revocation) are queued as durable jobs so a
// Telegram outage or a restart can never make an expired member "stick".
// ---------------------------------------------------------------------------

const NOT_IN_CHAT_RE = /user not found|participant_id_invalid|user_not_participant|member not found|user is not a member/i;
const LINK_GONE_RE = /invite_hash_(expired|invalid)|already revoked|link (is )?(expired|revoked|invalid)|invite link.*not found/i;

function enqueueRemoval({ channelId, chatId, userId, reason = 'subscription_expired', subId = '' }) {
  return jobsDb.enqueue(
    'remove_member',
    { channelId, chatId: String(chatId), userId: String(userId), reason, subId },
    { dedupeKey: `remove:${chatId}:${userId}:${subId || reason}`, maxAttempts: config.JOB_MAX_ATTEMPTS }
  );
}

function enqueueRevoke({ chatId, inviteLink, linkId = null }) {
  return jobsDb.enqueue(
    'revoke_link',
    { chatId: String(chatId), inviteLink, linkId },
    { dedupeKey: `revoke:${chatId}:${inviteLink}`, maxAttempts: config.JOB_MAX_ATTEMPTS }
  );
}

// Job handler. Returns a short result string; throws to trigger a retry.
// Before any destructive call it checks the member's REAL state, so a retry
// after "Telegram succeeded but we crashed" never repeats the action blindly.
async function handleRemoveMember(telegram, payload, job = {}, now = new Date()) {
  const { chatId, userId, channelId, reason } = payload;

  if (reason === 'subscription_expired') {
    const s = subscriptionsDb.get(channelId, userId);
    if (s && s.status === 'active' && new Date(s.expiresAt) > now) return 'skipped_renewed';
  }

  let member;
  try {
    member = await telegram.getChatMember(chatId, userId);
  } catch (err) {
    if (NOT_IN_CHAT_RE.test(errText(err))) return 'not_a_member';
    throw err;
  }

  if (member.status === 'creator' || member.status === 'administrator') return 'skipped_admin';
  if (member.status === 'left') return 'already_gone';

  if (member.status === 'kicked') {
    // Banned. Only lift the ban if THIS bot placed it earlier in the same
    // removal (crash between ban and unban); never release someone an admin banned.
    if (payload.bannedByBot) {
      await telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
      return 'unbanned';
    }
    return 'already_banned';
  }

  // member / restricted: kick = ban then unban, so the user can join again after renewing.
  await telegram.banChatMember(chatId, userId);
  if (job.id) jobsDb.patchPayload(job.id, { bannedByBot: true });
  await telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
  return 'removed';
}

async function handleRevokeLink(telegram, payload) {
  const { chatId, inviteLink, linkId } = payload;
  try {
    await telegram.revokeChatInviteLink(chatId, inviteLink);
  } catch (err) {
    if (!LINK_GONE_RE.test(errText(err))) throw err;
  }
  if (linkId) {
    const l = linksDb.getById(linkId);
    if (l && l.status === 'pending') linksDb.update(linkId, { status: 'revoked', revokedAt: new Date().toISOString() });
  }
  return 'revoked';
}

// Create a join-request invite link owned by one user and remember it.
// The link expires on Telegram's side after LINK_EXPIRY_HOURS. If we cannot
// store it locally the just-created link is revoked through the job queue,
// so no orphan link stays valid.
async function issueLink(telegram, channel, userId, { type = 'plan', price = 0, createdBy = userId, namePrefix = 'plan', clearOldBan = true } = {}) {
  if (clearOldBan && userId) {
    // A leftover ban from an earlier removal would make the new link useless.
    try { await telegram.unbanChatMember(channel.chatId, userId, { only_if_banned: true }); } catch (e) { /* best effort */ }
  }
  const expireAt = Math.floor(Date.now() / 1000) + Math.round(config.LINK_EXPIRY_HOURS * 3600);
  const invite = await telegram.createChatInviteLink(channel.chatId, {
    creates_join_request: true,
    expire_date: expireAt,
    name: `${namePrefix}-${userId || 'open'}-${Date.now()}`.slice(0, 32)
  });
  let record;
  try {
    record = linksDb.add({
      id: genId('lnk'),
      channelId: channel.id,
      chatId: channel.chatId,
      inviteLink: invite.invite_link,
      ownerUserId: userId === null || userId === undefined ? null : String(userId),
      type,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expireAt * 1000).toISOString(),
      createdBy,
      usedAt: null,
      usedBy: null,
      price
    });
  } catch (err) {
    enqueueRevoke({ chatId: channel.chatId, inviteLink: invite.invite_link });
    throw err;
  }
  return { record, invite };
}

// Revoke every still-pending link a user holds for a channel (used before
// issuing a replacement and when rolling back a failed purchase).
function revokePendingLinks(channelId, userId) {
  let n = 0;
  for (const l of linksDb.listByOwner(userId)) {
    if (l.status === 'pending' && l.channelId === channelId) {
      linksDb.update(l.id, { status: 'revoked', revokedAt: new Date().toISOString() });
      enqueueRevoke({ chatId: l.chatId, inviteLink: l.inviteLink, linkId: l.id });
      n += 1;
    }
  }
  return n;
}

// Pending links past their expiry are closed locally and revoked on Telegram.
function sweepExpiredLinks(now = new Date()) {
  let n = 0;
  for (const l of linksDb.listAll()) {
    if (l.status === 'pending' && l.expiresAt && new Date(l.expiresAt) <= now) {
      linksDb.update(l.id, { status: 'expired' });
      enqueueRevoke({ chatId: l.chatId, inviteLink: l.inviteLink, linkId: l.id });
      n += 1;
    }
  }
  return n;
}

// Checks that the bot can actually manage a chat before it is added.
let botId = null;
async function checkBotPermissions(telegram, chatId) {
  try {
    if (!botId) botId = (await telegram.getMe()).id;
    const chat = await telegram.getChat(chatId);
    const m = await telegram.getChatMember(chatId, botId);
    const missing = [];
    if (m.status !== 'administrator' && m.status !== 'creator') {
      missing.push('Bot is not an administrator');
    } else if (m.status === 'administrator') {
      if (!m.can_invite_users) missing.push('Invite users via link');
      if (!m.can_restrict_members) missing.push('Ban users');
    }
    return { ok: missing.length === 0, status: m.status, title: chat.title || '', type: chat.type, missing };
  } catch (err) {
    return { ok: false, error: errText(err), missing: [] };
  }
}

module.exports = {
  enqueueRemoval, enqueueRevoke, handleRemoveMember, handleRevokeLink,
  issueLink, revokePendingLinks, sweepExpiredLinks, checkBotPermissions
};
