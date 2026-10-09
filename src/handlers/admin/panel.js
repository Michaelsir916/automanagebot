const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const { btn, btnPrimary, btnDanger } = require('../../utils/keyboards');
const { dashboard } = require('../../services/stats');
const { fmtNum } = require('../../utils/format');

function adminMenuKeyboard(userId) {
  const has = p => adminsDb.hasPermission(userId, p);
  const rows = [];

  const r1 = [];
  if (has('manage_channels')) r1.push(btnPrimary('📢 Channels', 'admin_channels'), btnPrimary('📈 Stats', 'admin_channel_stats'));
  if (r1.length) rows.push(r1);

  const r2 = [];
  if (has('manage_plans')) r2.push(btnPrimary('🎟 Plans', 'admin_plans'));
  if (has('generate_link')) r2.push(btnPrimary('🔗 Manual Link', 'admin_manual_link'));
  if (r2.length) rows.push(r2);

  const r3 = [];
  if (has('view_payments') || has('wallet_adjust')) r3.push(btnPrimary('💰 Payments', 'admin_money'));
  r3.push(btnPrimary('👥 Members', 'admin_members'));
  rows.push(r3);

  const r4 = [];
  if (has('broadcast')) r4.push(btnPrimary('📣 Broadcast', 'admin_broadcast'));
  if (has('manage_plans')) r4.push(btnPrimary('🎟 Coupons', 'admin_coupons'));
  if (r4.length) rows.push(r4);

  if (adminsDb.isSuperAdmin(userId)) {
    rows.push([btnPrimary('⚙️ Settings', 'admin_settings'), btnPrimary('👑 Admin Roles', 'admin_roles')]);
  }
  rows.push([btn('🏠 Home', 'menu_main')]);
  return Markup.inlineKeyboard(rows);
}

function adminHeader() {
  let d;
  try { d = dashboard(); } catch (e) { return '⚙️ <b>Admin Panel</b>'; }
  const alerts = [];
  if (d.pendingUpi) alerts.push(`🇮🇳 ${d.pendingUpi} UPI to verify`);
  if (d.openTickets) alerts.push(`🎫 ${d.openTickets} open ticket(s)`);
  return (
    '⚙️ <b>Admin Panel</b>\n\n' +
    `📊 <b>Today</b>: +${fmtNum(d.todayRecharged)}⭐ recharged · ${fmtNum(d.todaySpent)}⭐ spent · ${d.todayNewUsers} new\n` +
    `👥 ${d.totalUsers} users · ${d.activeMembers} active · ${d.expiring24h} expiring ≤24h` +
    (alerts.length ? `\n🔔 ${alerts.join(' · ')}` : '')
  );
}

async function showPanel(ctx) {
  if (!adminsDb.isAdmin(ctx.from.id)) return;
  await ctx.reply(adminHeader(), { parse_mode: 'HTML', ...adminMenuKeyboard(ctx.from.id) });
}

function register(bot) {
  bot.action('menu_admin', showPanel);
  bot.action('admin_back', showPanel);
  bot.command('admin', showPanel);

  // ---- Payments hub ----
  bot.action('admin_money', async ctx => {
    const has = p => adminsDb.hasPermission(ctx.from.id, p);
    if (!has('view_payments') && !has('wallet_adjust')) return;
    const rows = [];
    if (has('view_payments')) rows.push([btnPrimary('📊 Revenue Report', 'admin_revenue_7'), btnPrimary('🧾 Recharge History', 'admin_payments')]);
    if (has('wallet_adjust')) rows.push([btnPrimary('💳 Wallet Adjust', 'admin_wallet_adjust'), btnPrimary('🇮🇳 UPI Pending', 'admin_upi_pending')]);
    rows.push([btn('⬅️ Back', 'admin_back')]);
    await ctx.reply('💰 <b>Payments</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  // ---- Members hub ----
  bot.action('admin_members', async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const rows = [[btnPrimary('🔍 Find User', 'admin_user_search'), btnPrimary('🎫 Tickets', 'admin_tickets')]];
    if (adminsDb.hasPermission(ctx.from.id, 'ban')) {
      rows.push([btnDanger('🚫 Ban List', 'admin_bans'), btnDanger('🗑 Removed Members', 'admin_removed_members')]);
    }
    rows.push([btn('⬅️ Back', 'admin_back')]);
    await ctx.reply('👥 <b>Members</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });
}

module.exports = { register, adminMenuKeyboard, adminHeader };
