const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const { btn, btnSuccess } = require('../../utils/keyboards');
const { summary, lastDays } = require('../../services/stats');
const { fmtNum, escapeHtml } = require('../../utils/format');

const RANGES = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [0, 'All']];

function bar(value, max, width = 10) {
  if (!max) return '';
  return '█'.repeat(Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width)));
}

function register(bot) {
  bot.action(/^admin_revenue_(\d+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'view_payments')) return;
    const days = parseInt(ctx.match[1], 10);
    const s = summary(days);
    const label = (RANGES.find(r => r[0] === days) || [0, `${days} days`])[1];

    let text =
      `📊 <b>Revenue — ${label}</b>\n\n` +
      `➕ Recharged: <b>${fmtNum(s.recharged)}⭐</b> (${s.rechargeCount} payments)\n` +
      `   └ via UPI: ${fmtNum(s.upiStars)}⭐\n` +
      `🛒 Spent on plans: <b>${fmtNum(s.spent)}⭐</b> (${s.spentCount} purchases)\n` +
      `🎁 Bonus given: ${fmtNum(s.bonusGiven)}⭐ · Referral paid: ${fmtNum(s.referralPaid)}⭐\n` +
      `↩️ Refunded: ${fmtNum(s.refunded)}⭐\n` +
      `🆕 New users: ${s.newUsers}\n`;

    if (s.topPlans.length) {
      text += '\n🏆 <b>Top sellers</b>\n' + s.topPlans.map((p, i) => `${i + 1}. ${escapeHtml(p.name)} — ${p.n}× · ${fmtNum(p.stars)}⭐`).join('\n');
    }
    if (days === 7 || days === 30) {
      const keys = lastDays(Math.min(days, 7)).reverse();
      const max = Math.max(...keys.map(k => s.byDay.get(k) || 0), 0);
      text += '\n\n📅 <b>Recharges by day</b>\n' + keys.map(k => `${k.slice(5)} ${bar(s.byDay.get(k) || 0, max)} ${fmtNum(s.byDay.get(k) || 0)}`).join('\n');
    }

    const filter = RANGES.map(([d, l]) => (d === days ? btnSuccess : btn)(l, `admin_revenue_${d}`));
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([filter, [btn('⬅️ Back', 'admin_money')]])
    });
  });
}

module.exports = { register };
