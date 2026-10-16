const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const removedMembersDb = require('../../db/removedMembers');
const channelsDb = require('../../db/channels');
const { setState, getState, clearState } = require('../../state');
const auditDb = require('../../db/audit');
const { btnSuccess } = require('../../utils/keyboards');
const { escapeHtml } = require('../../utils/format');
const { paginate, pagerButtons } = require('../../utils/paginate');

function register(bot) {
  const showRemoved = async (ctx, page) => {
    const list = removedMembersDb.list();
    if (list.length === 0) {
      return ctx.reply(
        '✅ No removed members right now.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_back')]])
      );
    }
    const pg = paginate(list, page, 15);
    const lines = pg.items.map(r => {
      const channel = channelsDb.getById(r.channelId);
      const channelTitle = channel ? channel.title : r.channelId;
      return `${r.userId} — ${escapeHtml(channelTitle)} (${escapeHtml(r.reason)}, ${new Date(r.removedAt).toLocaleDateString()})`;
    });
    const rows = [[btnSuccess('➖ Clear an Entry', 'admin_removed_clear')]];
    const pager = pagerButtons('admin_removed_p_', pg.page, pg.pages);
    if (pager.length) rows.push(pager);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply(
      `🗑 <b>Removed Members</b> (${pg.total}) — page ${pg.page + 1}/${pg.pages}\n\n` +
      `These users were removed (expired subscription, revoked access, etc.) and can't rejoin via a link until removed from this list. Paying again for the same channel clears this automatically.\n\n` +
      lines.join('\n'),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  };
  bot.action('admin_removed_members', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    await showRemoved(ctx, 0);
  });
  bot.action(/^admin_removed_p_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    await showRemoved(ctx, parseInt(ctx.match[1], 10));
  });

  bot.action('admin_removed_clear', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    setState(ctx.from.id, 'admin_removed_clear_user');
    await ctx.reply('Send the Telegram user ID to clear from the removed-members list:');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_removed_clear_user') return next();
    const targetId = ctx.message.text.trim();
    if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
    setState(ctx.from.id, 'admin_removed_clear_channel', { targetId });

    const entries = removedMembersDb.list().filter(r => String(r.userId) === targetId);
    if (entries.length === 0) {
      clearState(ctx.from.id);
      return ctx.reply('This user is not on the removed-members list for any channel.');
    }
    const rows = entries.map(r => {
      const channel = channelsDb.getById(r.channelId);
      const title = channel ? channel.title : r.channelId;
      return [Markup.button.callback(title, `removed_clear_${r.channelId}_${targetId}`)];
    });
    return ctx.reply('Which channel should they be cleared for?', Markup.inlineKeyboard(rows));
  });

  bot.action(/removed_clear_(\S+)_(\d+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    clearState(ctx.from.id);
    const [, channelId, userId] = ctx.match;
    const removed = removedMembersDb.remove(channelId, userId);
    if (removed) auditDb.add(ctx.from.id, 'removed_clear', `user ${userId} channel ${channelId}`);
    await ctx.reply(removed
      ? `✅ User ${userId} cleared. They can unlock and join again now.`
      : 'That entry was already cleared.');
  });
}

module.exports = { register };
