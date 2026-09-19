const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const { btnPrimary, btnDanger } = require('../../utils/keyboards');

function adminMenuKeyboard(userId) {
  const rows = [];
  if (adminsDb.hasPermission(userId, 'manage_channels')) {
    rows.push([btnPrimary('📢 Manage Channels', 'admin_channels')]);
    rows.push([btnPrimary('📈 Channel Stats', 'admin_channel_stats')]);
  }
  if (adminsDb.hasPermission(userId, 'manage_plans')) rows.push([btnPrimary('🎟 Plans & Bundles', 'admin_plans')]);
  if (adminsDb.hasPermission(userId, 'generate_link')) rows.push([btnPrimary('🔗 Manual Link', 'admin_manual_link')]);
  if (adminsDb.hasPermission(userId, 'view_payments')) rows.push([btnPrimary('📊 Payment History', 'admin_payments')]);
  if (adminsDb.hasPermission(userId, 'wallet_adjust')) rows.push([btnPrimary('💳 Wallet Adjust', 'admin_wallet_adjust')]);
  if (adminsDb.hasPermission(userId, 'ban')) {
    rows.push([btnDanger('🚫 Ban List', 'admin_bans')]);
    rows.push([btnDanger('🗑 Removed Members', 'admin_removed_members')]);
  }
  if (adminsDb.hasPermission(userId, 'broadcast')) rows.push([btnPrimary('📣 Broadcast', 'admin_broadcast')]);
  if (adminsDb.isSuperAdmin(userId)) rows.push([btnPrimary('👑 Admin Roles', 'admin_roles')]);
  rows.push([Markup.button.callback('⬅️ Back', 'menu_main')]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.action('menu_admin', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    await ctx.reply('⚙️ <b>Admin Panel</b>', { parse_mode: 'HTML', ...adminMenuKeyboard(ctx.from.id) });
  });

  bot.action('admin_back', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    await ctx.reply('⚙️ <b>Admin Panel</b>', { parse_mode: 'HTML', ...adminMenuKeyboard(ctx.from.id) });
  });
}

module.exports = { register, adminMenuKeyboard };
