const { Markup } = require('telegraf');
const wallets = require('../db/wallets');
const admins = require('../db/admins');
const { btnPrimary } = require('../utils/keyboards');

function mainMenuKeyboard(userId) {
  const rows = [
    [btnPrimary('🛒 Plans', 'menu_plans')],
    [btnPrimary('📢 Channels', 'menu_channels')],
    [btnPrimary('💰 Wallet', 'menu_wallet')],
    [Markup.button.callback('🆘 Support', 'menu_support')]
  ];
  if (admins.isAdmin(userId)) {
    rows.push([btnPrimary('⚙️ Admin Panel', 'menu_admin')]);
  }
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.start(async ctx => {
    wallets.getWallet(ctx.from.id); // make sure a wallet record exists
    await ctx.reply(
      `👋 Welcome, ${ctx.from.first_name}!\n\n` +
      `This bot gives you paid access to private channels using Telegram Stars ⭐\n\n` +
      `1️⃣ Browse Plans — single channels or money-saving bundles\n` +
      `2️⃣ Pay with Stars — you'll instantly get your join link(s)\n` +
      `3️⃣ That link works for you only\n\n` +
      `Use the buttons below to get started 👇`,
      mainMenuKeyboard(ctx.from.id)
    );
  });

  bot.action('menu_main', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Main Menu', mainMenuKeyboard(ctx.from.id));
  });

  bot.action('menu_support', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('🆘 Send your message here and our team will get back to you directly.');
  });
}

module.exports = { register, mainMenuKeyboard };
