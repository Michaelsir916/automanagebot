const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const plansDb = require('../../db/plans');
const usersDb = require('../../db/users');
const auditDb = require('../../db/audit');
const { segmentUserIds } = require('../../services/stats');
const { setState, getState, clearState } = require('../../state');
const { btn, btnPrimary, btnSuccess, btnDanger, grid } = require('../../utils/keyboards');
const { escapeHtml } = require('../../utils/format');
const { sleep, errText } = require('../../utils/resilience');

const SEGMENTS = [
  ['all', '👥 Everyone'],
  ['paid', '💰 Paid before'],
  ['active', '✅ Active members'],
  ['expired', '⌛ Expired'],
  ['never', '🆕 Never bought']
];

let running = false; // one broadcast at a time

function segmentLabel(seg) {
  const hit = SEGMENTS.find(([k]) => k === seg);
  if (hit) return hit[1];
  if (seg.startsWith('plan:')) {
    const p = plansDb.getById(seg.slice(5));
    return `🎟 Plan: ${p ? p.title : seg.slice(5)}`;
  }
  return seg;
}

function register(bot) {
  const guard = ctx => adminsDb.hasPermission(ctx.from.id, 'broadcast');

  bot.action('admin_broadcast', async ctx => {
    if (!guard(ctx)) return;
    clearState(ctx.from.id);
    const buttons = SEGMENTS.map(([key, label]) => btnPrimary(`${label} (${segmentUserIds(key).length})`, `bc_seg_${key}`));
    const planButtons = plansDb.listActive().slice(0, 6).map(p =>
      btn(`🎟 ${p.title.slice(0, 18)} (${segmentUserIds('plan:' + p.id).length})`, `bc_seg_plan:${p.id}`));
    const rows = [...grid(buttons, 2), ...grid(planButtons, 2), [btn('⬅️ Back', 'admin_back')]];
    await ctx.reply('📣 <b>Broadcast</b>\n\nWho should receive it? (blocked users are skipped automatically)',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action(/^bc_seg_(.+)$/, async ctx => {
    if (!guard(ctx)) return;
    const segment = ctx.match[1];
    const count = segmentUserIds(segment).length;
    if (!count) return ctx.reply('No users in this group.', Markup.inlineKeyboard([[btn('⬅️ Back', 'admin_broadcast')]]));
    setState(ctx.from.id, 'admin_broadcast_text', { segment });
    await ctx.reply(
      `📣 To: <b>${escapeHtml(segmentLabel(segment))}</b> — ${count} user(s)\n\nSend the message text now:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_broadcast')]]) }
    );
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_broadcast_text' || !guard(ctx)) return next();
    const text = ctx.message.text;
    if (text.length > 3500) return ctx.reply('Too long (max 3500 characters). Send a shorter message.');
    const count = segmentUserIds(state.data.segment).length;
    setState(ctx.from.id, 'admin_broadcast_confirm', { segment: state.data.segment, text });
    await ctx.reply(
      `👀 <b>Preview</b>\n\n📣 ${escapeHtml(text)}\n\n— — —\nTo: <b>${escapeHtml(segmentLabel(state.data.segment))}</b> (${count})`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[btnSuccess(`✅ Send to ${count}`, 'bc_go'), btnDanger('❌ Cancel', 'admin_broadcast')]])
      }
    );
  });

  bot.action('bc_go', async ctx => {
    if (!guard(ctx)) return;
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_broadcast_confirm') {
      return ctx.reply('Nothing to send. Start again.', Markup.inlineKeyboard([[btn('📣 Broadcast', 'admin_broadcast')]]));
    }
    if (running) return ctx.reply('⏳ Another broadcast is still running. Wait for it to finish.');
    running = true;
    clearState(ctx.from.id);

    const { segment, text } = state.data;
    const ids = segmentUserIds(segment);
    const chatId = ctx.chat.id;
    const status = await ctx.replyNew(`📣 Sending to ${ids.length} users…`);
    auditDb.add(ctx.from.id, 'broadcast', `${segment} → ${ids.length} users`);

    // Runs in the background so the admin's button press returns at once
    // (important on a slow connection) and the bot stays responsive.
    (async () => {
      let sent = 0, failed = 0, blocked = 0;
      const update = async final => {
        const body = `${final ? '✅ Broadcast complete' : '📣 Sending…'}\n\nSent: ${sent}\nBlocked/left: ${blocked}\nFailed: ${failed}\nTotal: ${ids.length}`;
        try { await ctx.telegram.editMessageText(chatId, status.message_id, undefined, body); } catch (e) { /* not critical */ }
      };
      try {
        for (let i = 0; i < ids.length; i++) {
          try {
            await ctx.telegram.sendMessage(ids[i], `📣 ${text}`);
            sent++;
          } catch (err) {
            if (/blocked|deactivated|chat not found/i.test(errText(err))) {
              blocked++;
              try { usersDb.markBlocked(ids[i]); } catch (e) { /* ignore */ }
            } else {
              failed++;
            }
          }
          await sleep(55); // stay under Telegram's ~30 msgs/sec limit
          if ((i + 1) % 40 === 0) await update(false);
        }
      } finally {
        running = false;
        await update(true);
      }
    })();
  });
}

module.exports = { register };
