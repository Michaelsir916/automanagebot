const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const channelsDb = require('../../db/channels');
const membershipEvents = require('../../db/membershipEvents');
const { fmtDate, escapeHtml } = require('../../utils/format');
const { errText } = require('../../utils/resilience');

const KIND_ICON = { joined: '➕', left: '➖', removed: '🚪', banned: '⛔', restricted: '🔇', promoted: '⭐', other: '•' };

// Honest report of what the bot has OBSERVED. The Bot API can neither list
// existing members nor replay history from before tracking began, so the
// coverage date is always shown next to the numbers.
async function buildReport(telegram) {
  const since = membershipEvents.trackingSince();
  const channels = channelsDb.list();
  if (channels.length === 0) return 'No channels configured yet.';
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const lines = [];
  for (const c of channels) {
    let count = '?';
    try { count = await telegram.getChatMembersCount(c.chatId); } catch (err) { count = `n/a (${errText(err).slice(0, 40)})`; }
    const s = membershipEvents.summarize(c.chatId, week);
    lines.push(
      `<b>${escapeHtml(c.title)}</b>\nMembers now: ${count}\nLast 7 days (observed): ➕ ${s.joined} · ➖ ${s.left} · 🚪 ${s.removed} · ⛔ ${s.banned}`
    );
  }

  const recent = membershipEvents.list({ limit: 10 }).items.map(e => {
    const ch = channelsDb.getByChatId(e.chatId);
    return `${KIND_ICON[e.kind] || '•'} ${fmtDate(e.at)} · <code>${e.userId}</code> · ${escapeHtml(ch ? ch.title : e.chatId)} · ${e.kind}`;
  });

  return (
    '👣 <b>Member activity</b>\n\n' + lines.join('\n\n') +
    (recent.length ? '\n\n<b>Latest events</b>\n' + recent.join('\n') : '') +
    '\n\n<i>Coverage: ' + (since ? `events observed since ${fmtDate(since)}` : 'no events observed yet') +
    '. Telegram does not provide earlier history, and members who joined before tracking started are not listed. ' +
    'Events are only seen while the bot is an admin of the channel and running.</i>'
  );
}

function register(bot) {
  const show = async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'view_stats')) return;
    const text = await buildReport(ctx.telegram);
    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_back')]]) });
  };
  bot.command('memberlog', show);
  bot.action('admin_memberlog', show);
}

module.exports = { register, buildReport };
