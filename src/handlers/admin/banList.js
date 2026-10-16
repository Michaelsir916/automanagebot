const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const bansDb = require('../../db/bans');
const { setState, getState, clearState } = require('../../state');
const auditDb = require('../../db/audit');
const { btnDanger, btnSuccess } = require('../../utils/keyboards');
const { escapeHtml } = require('../../utils/format');
const { paginate, pagerButtons } = require('../../utils/paginate');

function register(bot) {
  const showBans = async (ctx, page) => {
    const pg = paginate(bansDb.list(), page, 15);
    const lines = pg.items.length
      ? pg.items.map(b => `${b.id} — ${escapeHtml(b.reason)} (${new Date(b.bannedAt).toLocaleDateString()})`).join('\n')
      : 'No banned users.';
    const rows = [[btnDanger('➕ Ban User', 'admin_ban_add')], [btnSuccess('➖ Unban User', 'admin_ban_remove')]];
    const pager = pagerButtons('admin_bans_p_', pg.page, pg.pages);
    if (pager.length) rows.push(pager);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply(`🚫 <b>Banned Users</b> (${pg.total}) — page ${pg.page + 1}/${pg.pages}\n\n${lines}`, {
      parse_mode: 'HTML', ...Markup.inlineKeyboard(rows)
    });
  };
  bot.action('admin_bans', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    await showBans(ctx, 0);
  });
  bot.action(/^admin_bans_p_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    await showBans(ctx, parseInt(ctx.match[1], 10));
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
      auditDb.add(ctx.from.id, 'ban', `user ${state.data.targetId}`);
      return ctx.reply(`🚫 User ${state.data.targetId} banned.`);
    }

    if (state.step === 'admin_unban_user_id') {
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
      bansDb.unban(targetId);
      auditDb.add(ctx.from.id, 'unban', `user ${targetId}`);
      return ctx.reply(`✅ User ${targetId} unbanned.`);
    }

    return next();
  });
}

module.exports = { register };
