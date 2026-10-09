const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const usersDb = require('../../db/users');
const walletsDb = require('../../db/wallets');
const bansDb = require('../../db/bans');
const subscriptionsDb = require('../../db/subscriptions');
const plansDb = require('../../db/plans');
const channelsDb = require('../../db/channels');
const ticketsDb = require('../../db/tickets');
const auditDb = require('../../db/audit');
const { setState, getState, clearState } = require('../../state');
const { btn, btnPrimary, btnSuccess, btnDanger } = require('../../utils/keyboards');
const { escapeHtml, fmtDate, fmtDay, fmtNum, timeLeft } = require('../../utils/format');

function resolveUser(query) {
  const q = String(query).trim();
  if (/^\d{4,}$/.test(q)) {
    const u = usersDb.get(q);
    if (u) return u;
    // Known only through a wallet (e.g. very old user) - synthesize a card.
    if (walletsDb.listAll().some(w => w.userId === q)) return { id: q, firstName: '', username: '', joinedAt: null, lastSeen: null, lang: '-' };
    return null;
  }
  if (/^@?[A-Za-z0-9_]{3,}$/.test(q)) {
    const byName = usersDb.findByUsername(q);
    if (byName) return byName;
    return usersDb.findByReferralCode(q);
  }
  return null;
}

function userCard(u) {
  const now = new Date();
  const wallet = walletsDb.getWallet(u.id);
  const recharged = wallet.transactions.filter(x => ['recharge', 'upi_recharge'].includes(x.type)).reduce((s, x) => s + x.amount, 0);
  const spent = wallet.transactions.filter(x => ['plan_purchase', 'channel_unlock', 'plan_renew', 'plan_auto_renew'].includes(x.type)).reduce((s, x) => s - x.amount, 0);

  const groups = new Map();
  subscriptionsDb.listByUser(u.id).filter(s => s.status === 'active' && new Date(s.expiresAt) > now)
    .forEach(s => { if (!groups.has(s.groupId)) groups.set(s.groupId, s); });
  const subLines = Array.from(groups.values()).map(s => {
    const plan = s.planId ? plansDb.getById(s.planId) : null;
    const ch = channelsDb.getById(s.channelId);
    return `• ${escapeHtml(plan ? plan.title : (ch ? ch.title : '?'))} — ${timeLeft(s.expiresAt, now)} left${s.autoRenew ? ' 🔁' : ''}`;
  });

  const ban = bansDb.isBanned(u.id) ? bansDb.list().find(b => b.id === String(u.id)) : null;
  const refs = usersDb.listReferrals(u.id);
  const openTicket = ticketsDb.getOpenByUser(u.id);

  const name = escapeHtml([u.firstName, u.lastName].filter(Boolean).join(' ') || '(no name)');
  return (
    `👤 <b>${name}</b>${u.username ? ` @${escapeHtml(u.username)}` : ''}\n` +
    `🆔 <code>${u.id}</code> · 🌐 ${u.lang || '-'}\n` +
    `📅 Joined: ${u.joinedAt ? fmtDay(u.joinedAt) : '-'} · Last seen: ${u.lastSeen ? fmtDate(u.lastSeen) : '-'}\n\n` +
    `💰 Balance: <b>${fmtNum(wallet.balance)}⭐</b>\n` +
    `➕ Recharged: ${fmtNum(recharged)}⭐ · 🛒 Spent: ${fmtNum(spent)}⭐\n` +
    `👥 Referred: ${refs.length}${u.referredBy ? ` · Invited by <code>${u.referredBy}</code>` : ''}\n` +
    (ban ? `🚫 <b>BANNED</b>: ${escapeHtml(ban.reason || '')}\n` : '') +
    (openTicket ? `🎫 Open ticket #${openTicket.no}\n` : '') +
    `\n📜 <b>Active subscriptions</b>\n${subLines.length ? subLines.join('\n') : '—'}`
  );
}

function userKeyboard(adminId, u) {
  const rows = [[btnPrimary('💬 Message', `contact_${u.id}`), btnPrimary('🧾 History', `admin_uhist_${u.id}`)]];
  const r2 = [];
  if (adminsDb.hasPermission(adminId, 'wallet_adjust')) r2.push(btnPrimary('💳 Adjust Balance', `admin_uadj_${u.id}`));
  if (adminsDb.hasPermission(adminId, 'ban')) {
    r2.push(bansDb.isBanned(u.id) ? btnSuccess('✅ Unban', `admin_uunban_${u.id}`) : btnDanger('🚫 Ban', `admin_uban_${u.id}`));
  }
  if (r2.length) rows.push(r2);
  rows.push([btn('⬅️ Back', 'admin_members'), btn('🏠 Admin', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

async function showUser(ctx, u) {
  return ctx.reply(userCard(u), { parse_mode: 'HTML', ...userKeyboard(ctx.from.id, u) });
}

function register(bot) {
  bot.action('admin_user_search', async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    setState(ctx.from.id, 'admin_user_search');
    await ctx.reply(
      '🔍 Send a Telegram ID, @username or referral code:',
      Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_members')]])
    );
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_user_search' || !adminsDb.isAdmin(ctx.from.id)) return next();
    clearState(ctx.from.id);
    const u = resolveUser(ctx.message.text);
    if (!u) {
      return ctx.reply('❌ No user found. (Users appear here after they message the bot.)',
        Markup.inlineKeyboard([[btn('🔍 Try again', 'admin_user_search'), btn('⬅️ Back', 'admin_members')]]));
    }
    return showUser(ctx, u);
  });

  bot.action(/^admin_u_(\d+)$/, async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const u = resolveUser(ctx.match[1]);
    if (!u) return ctx.reply('User not found.');
    await showUser(ctx, u);
  });

  bot.action(/^admin_uhist_(\d+)$/, async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const id = ctx.match[1];
    const txns = walletsDb.getWallet(id).transactions.slice(-15).reverse();
    const lines = txns.length
      ? txns.map(x => `${x.amount >= 0 ? '+' : ''}${fmtNum(x.amount)}⭐ ${x.type} <i>${fmtDate(x.date)}</i>`).join('\n')
      : 'No transactions.';
    await ctx.reply(`🧾 <b>Last transactions</b> — <code>${id}</code>\n\n${lines}`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[btn('⬅️ Back', `admin_u_${id}`)]])
    });
  });

  bot.action(/^admin_uadj_(\d+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;
    const id = ctx.match[1];
    setState(ctx.from.id, 'admin_wallet_amount', { targetId: id });
    await ctx.reply(
      `Current balance: ${fmtNum(walletsDb.getBalance(id))}⭐\n\nSend the amount to adjust by (negative to deduct, e.g. -50):`,
      Markup.inlineKeyboard([[btn('❌ Cancel', `admin_u_${id}`)]])
    );
  });

  bot.action(/^admin_uban_(\d+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const id = ctx.match[1];
    if (adminsDb.isAdmin(id)) return ctx.reply('❌ You cannot ban an admin.');
    bansDb.ban(id, 'banned by admin', ctx.from.id);
    auditDb.add(ctx.from.id, 'ban', `user ${id}`);
    await showUser(ctx, resolveUser(id));
  });

  bot.action(/^admin_uunban_(\d+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const id = ctx.match[1];
    bansDb.unban(id);
    auditDb.add(ctx.from.id, 'unban', `user ${id}`);
    await showUser(ctx, resolveUser(id));
  });
}

module.exports = { register, resolveUser, userCard };
