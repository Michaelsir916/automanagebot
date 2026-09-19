const { Markup } = require('telegraf');
const wallets = require('../db/wallets');
const admins = require('../db/admins');

function mainMenuKeyboard(userId) {
  const rows = [
    [Markup.button.callback('📢 Channels', 'menu_channels')],
    [Markup.button.callback('💰 Wallet', 'menu_wallet')],
    [Markup.button.callback('🆘 Support', 'menu_support')]
  ];
  if (admins.isAdmin(userId)) {
    rows.push([Markup.button.callback('⚙️ Admin Panel', 'menu_admin')]);
  }
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.start(async ctx => {
    wallets.getWallet(ctx.from.id); // make sure a wallet record exists
    await ctx.reply(
      `👋 Welcome, ${ctx.from.first_name}!\n\n` +
      `This bot gives you paid access to private channels using your wallet balance.\n\n` +
      `1️⃣ Recharge your wallet using Telegram Stars ⭐\n` +
      `2️⃣ Unlock a channel — you'll instantly get a one-time join link\n` +
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
