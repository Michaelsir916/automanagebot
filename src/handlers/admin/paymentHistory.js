const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const paymentsDb = require('../../db/payments');
const channelsDb = require('../../db/channels');
const { btnPrimary } = require('../../utils/keyboards');
const { paginate, pagerButtons } = require('../../utils/paginate');

function register(bot) {
  const showPayments = async (ctx, page) => {
    const all = paymentsDb.listAll();
    if (all.length === 0) return ctx.reply('No payments recorded yet.');
    const pg = paginate(all.slice().reverse(), page, 12);
    const credited = all.filter(p => ['credited', 'refunded', 'refunding'].includes(paymentsDb.statusOf(p)));
    const total = credited.reduce((sum, p) => sum + p.stars, 0);
    const lines = pg.items.map(p => `User ${p.userId} — ${p.stars}⭐ · ${paymentsDb.statusOf(p)} (${new Date(p.date).toLocaleString()})`);
    const rows = [];
    const pager = pagerButtons('admin_payments_p_', pg.page, pg.pages);
    if (pager.length) rows.push(pager);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply(
      `📊 <b>Stars Payments</b> (${pg.total}) — page ${pg.page + 1}/${pg.pages}\n\n${lines.join('\n')}\n\n💰 Total Stars received (incl. refunded): ${total}⭐`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  };
  bot.action('admin_payments', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'view_payments')) return;
    await showPayments(ctx, 0);
  });
  bot.action(/^admin_payments_p_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'view_payments')) return;
    await showPayments(ctx, parseInt(ctx.match[1], 10));
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
