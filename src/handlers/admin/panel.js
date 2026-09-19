const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');

function adminMenuKeyboard(userId) {
  const rows = [];
  if (adminsDb.hasPermission(userId, 'manage_channels')) {
    rows.push([Markup.button.callback('📢 Manage Channels', 'admin_channels')]);
    rows.push([Markup.button.callback('📈 Channel Stats', 'admin_channel_stats')]);
  }
  if (adminsDb.hasPermission(userId, 'generate_link')) rows.push([Markup.button.callback('🔗 Manual Link', 'admin_manual_link')]);
  if (adminsDb.hasPermission(userId, 'view_payments')) rows.push([Markup.button.callback('📊 Payment History', 'admin_payments')]);
  if (adminsDb.hasPermission(userId, 'wallet_adjust')) rows.push([Markup.button.callback('💳 Wallet Adjust', 'admin_wallet_adjust')]);
  if (adminsDb.hasPermission(userId, 'ban')) {
    rows.push([Markup.button.callback('🚫 Ban List', 'admin_bans')]);
    rows.push([Markup.button.callback('🗑 Removed Members', 'admin_removed_members')]);
  }
  if (adminsDb.hasPermission(userId, 'broadcast')) rows.push([Markup.button.callback('📣 Broadcast', 'admin_broadcast')]);
  if (adminsDb.isSuperAdmin(userId)) rows.push([Markup.button.callback('👑 Admin Roles', 'admin_roles')]);
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
