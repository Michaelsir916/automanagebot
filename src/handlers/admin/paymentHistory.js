const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const paymentsDb = require('../../db/payments');
const channelsDb = require('../../db/channels');

function register(bot) {
  bot.action('admin_payments', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'view_payments')) return;
    const all = paymentsDb.listAll();
    if (all.length === 0) return ctx.reply('No payments recorded yet.');
    const recent = all.slice(-15).reverse();
    const totalStars = all.reduce((sum, p) => sum + p.stars, 0);
    const lines = recent.map(p => `User ${p.userId} — ${p.stars}⭐ (${new Date(p.date).toLocaleString()})`);
    await ctx.reply(
      `📊 <b>Recent Recharges</b> (last 15)\n\n${lines.join('\n')}\n\n💰 Total lifetime recharges: ${totalStars}⭐`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_back')]]) }
    );
  });

  bot.action('admin_channel_stats', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'manage_channels')) return;
    const channels = channelsDb.list();
    if (channels.length === 0) return ctx.reply('No channels configured yet.');
    const lines = [];
    for (const c of channels) {
      try {
        const count = await ctx.telegram.getChatMembersCount(c.chatId);
        lines.push(`${c.title}: ${count} members`);
      } catch (err) {
        lines.push(`${c.title}: unable to fetch (${err.message})`);
      }
    }
    await ctx.reply(`📈 <b>Channel Member Counts</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });
}

module.exports = { register };
