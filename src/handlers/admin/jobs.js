const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const jobsDb = require('../../db/jobs');
const refundsDb = require('../../db/refunds');
const paymentsDb = require('../../db/payments');
const { btnPrimary, btnSuccess } = require('../../utils/keyboards');
const { escapeHtml, fmtDate } = require('../../utils/format');

function statusText() {
  const c = jobsDb.counts();
  const dead = jobsDb.list('dead').slice(-5);
  const pendingRefunds = refundsDb.listPending().length;
  const uncredited = paymentsDb.listByStatus('received').length;
  const rejected = paymentsDb.listByStatus('rejected').length;
  let text =
    '🧰 <b>Background jobs</b>\n\n' +
    `Pending: <b>${c.pending}</b> · Running: ${c.running} · Done: ${c.done} · <b>Dead: ${c.dead}</b>\n` +
    `Pending refunds: ${pendingRefunds} · Payments awaiting credit: ${uncredited} · Rejected payments: ${rejected}`;
  if (dead.length) {
    text += '\n\n<b>Failed permanently</b>\n' + dead.map(j =>
      `• ${escapeHtml(j.type)} chat <code>${escapeHtml(j.payload.chatId || '-')}</code>` +
      `${j.payload.userId ? ` user <code>${escapeHtml(j.payload.userId)}</code>` : ''}\n  ${fmtDate(j.updatedAt)} · ${escapeHtml(j.lastError || '')}`
    ).join('\n');
  }
  return text;
}

function keyboard(admin) {
  const rows = [[btnPrimary('🔄 Refresh', 'admin_jobs')]];
  if (jobsDb.counts().dead > 0 && adminsDb.isSuperAdmin(admin)) rows.push([btnSuccess('♻️ Retry dead jobs', 'admin_jobs_retry')]);
  rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  const show = async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'manage_channels')) return;
    await ctx.reply(statusText(), { parse_mode: 'HTML', ...keyboard(ctx.from.id) });
  };
  bot.command('jobs', show);
  bot.action('admin_jobs', show);

  bot.action('admin_jobs_retry', async ctx => {
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    const n = jobsDb.requeueDead();
    auditDb.add(ctx.from.id, 'jobs_retry', `${n} job(s) requeued`);
    await ctx.reply(`♻️ ${n} job(s) queued again.\n\n${statusText()}`, { parse_mode: 'HTML', ...keyboard(ctx.from.id) });
  });
}

module.exports = { register, statusText };
