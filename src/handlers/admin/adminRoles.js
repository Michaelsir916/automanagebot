const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const { setState, getState, clearState } = require('../../state');
const { btnSuccess, btnDanger } = require('../../utils/keyboards');

function register(bot) {
  bot.action('admin_roles', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    const list = adminsDb.listAdmins();
    const lines = list.map(a => `${a.id} — ${a.role}`).join('\n');
    await ctx.reply(
      `👑 <b>Admins</b>\n\n${lines}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess('➕ Add Moderator', 'admin_add_mod')],
          [btnDanger('➖ Remove Admin', 'admin_remove_mod')],
          [Markup.button.callback('⬅️ Back', 'admin_back')]
        ])
      }
    );
  });

  bot.action('admin_add_mod', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    setState(ctx.from.id, 'admin_add_mod_id');
    await ctx.reply('Send the Telegram user ID to make a moderator:');
  });

  bot.action('admin_remove_mod', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    setState(ctx.from.id, 'admin_remove_mod_id');
    await ctx.reply('Send the Telegram user ID to remove from admins:');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_add_mod_id') {
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      adminsDb.addAdmin(targetId, 'moderator', ['generate_link', 'view_payments'], ctx.from.id);
      return ctx.reply(
        `✅ ${targetId} added as moderator with default permissions (generate_link, view_payments).\n` +
        `To give a different permission set, edit data/admins.json directly.`
      );
    }

    if (state.step === 'admin_remove_mod_id') {
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      adminsDb.removeAdmin(targetId);
      return ctx.reply(`✅ ${targetId} removed from admins.`);
    }

    return next();
  });
}

module.exports = { register };
