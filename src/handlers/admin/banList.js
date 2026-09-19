const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const bansDb = require('../../db/bans');
const { setState, getState, clearState } = require('../../state');
const { btnDanger, btnSuccess } = require('../../utils/keyboards');

function register(bot) {
  bot.action('admin_bans', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const list = bansDb.list();
    const lines = list.length
      ? list.map(b => `${b.id} — ${b.reason} (${new Date(b.bannedAt).toLocaleDateString()})`).join('\n')
      : 'No banned users.';
    await ctx.reply(
      `🚫 <b>Banned Users</b>\n\n${lines}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnDanger('➕ Ban User', 'admin_ban_add')],
          [btnSuccess('➖ Unban User', 'admin_ban_remove')],
          [Markup.button.callback('⬅️ Back', 'admin_back')]
        ])
      }
    );
  });

  bot.action('admin_ban_add', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    setState(ctx.from.id, 'admin_ban_user_id');
    await ctx.reply('Send the Telegram user ID to ban:');
  });

  bot.action('admin_ban_remove', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    setState(ctx.from.id, 'admin_unban_user_id');
    await ctx.reply('Send the Telegram user ID to unban:');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_ban_user_id') {
      const targetId = ctx.message.text.trim();
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      setState(ctx.from.id, 'admin_ban_reason', { targetId });
      return ctx.reply('Send a reason for the ban:');
    }

    if (state.step === 'admin_ban_reason') {
      const reason = ctx.message.text.trim();
      clearState(ctx.from.id);
      bansDb.ban(state.data.targetId, reason, ctx.from.id);
      return ctx.reply(`🚫 User ${state.data.targetId} banned.`);
    }

    if (state.step === 'admin_unban_user_id') {
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      bansDb.unban(targetId);
      return ctx.reply(`✅ User ${targetId} unbanned.`);
    }

    return next();
  });
}

module.exports = { register };
