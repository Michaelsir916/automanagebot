const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const removedMembersDb = require('../../db/removedMembers');
const channelsDb = require('../../db/channels');
const { setState, getState, clearState } = require('../../state');
const { btnSuccess } = require('../../utils/keyboards');

function register(bot) {
  bot.action('admin_removed_members', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'ban')) return;
    const list = removedMembersDb.list();
    if (list.length === 0) {
      return ctx.reply(
        '✅ No removed members right now.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_back')]])
      );
    }
    const lines = list.map(r => {
      const channel = channelsDb.getById(r.channelId);
      const channelTitle = channel ? channel.title : r.channelId;
      return `${r.userId} — ${channelTitle} (${r.reason}, ${new Date(r.removedAt).toLocaleDateString()})`;
    });
    await ctx.reply(
      `🗑 <b>Removed Members</b>\n\n` +
      `These users were auto-kicked (expired subscription, etc.) and can't rejoin via a link until removed from this list. Paying again for the same channel clears this automatically.\n\n` +
      lines.join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess('➖ Clear an Entry', 'admin_removed_clear')],
          [Markup.button.callback('⬅️ Back', 'admin_back')]
        ])
      }
    );
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
    await ctx.reply(removed
      ? `✅ User ${userId} cleared. They can unlock and join again now.`
      : 'That entry was already cleared.');
  });
}

module.exports = { register };
