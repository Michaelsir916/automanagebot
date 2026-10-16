const jobsDb = require('../db/jobs');
const access = require('../services/access');
const { reconcilePayments } = require('../services/payments');
const { reconcileRefunds } = require('../services/refunds');
const { purgeExpiredStates } = require('../state');
const config = require('../config');
const { notifyAdmins } = require('../utils/notify');
const { errText, sleep } = require('../utils/resilience');
const { escapeHtml } = require('../utils/format');

const HANDLERS = {
  remove_member: access.handleRemoveMember,
  revoke_link: access.handleRevokeLink
};

// Runs every job that is due, once. Each job is handled in isolation: a
// failure only reschedules that job (exponential backoff with jitter) and
// never stops the others.
async function runOnce(telegram, { now = new Date(), limit = 20, pauseMs = 60 } = {}) {
  jobsDb.recoverStuck(now);
  const due = jobsDb.claimDue(now, limit);
  const results = [];

  for (const job of due) {
    const handler = HANDLERS[job.type];
    if (!handler) {
      jobsDb.fail(job.id, `unknown job type: ${job.type}`, { fatal: true });
      results.push({ id: job.id, type: job.type, outcome: 'dead' });
      continue;
    }
    try {
      const res = await handler(telegram, job.payload, job);
      jobsDb.complete(job.id, res);
      results.push({ id: job.id, type: job.type, outcome: 'done', result: res });
    } catch (err) {
      const updated = jobsDb.fail(job.id, errText(err));
      console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${updated.attempts}/${updated.maxAttempts}): ${errText(err).slice(0, 120)}`);
      results.push({ id: job.id, type: job.type, outcome: updated.status });
    }
    if (pauseMs) await sleep(pauseMs); // stay well below Telegram's flood limits
  }
  return results;
}

// Alert admins once for every job that ran out of attempts.
async function alertDeadJobs(telegram) {
  for (const job of jobsDb.list('dead')) {
    if (job.deadNotified) continue;
    jobsDb.markDeadNotified(job.id);
    await notifyAdmins(telegram,
      `🚨 <b>Background job failed permanently</b>\n\n` +
      `Type: ${escapeHtml(job.type)}\nChat: <code>${escapeHtml(job.payload.chatId || '-')}</code>\n` +
      (job.payload.userId ? `User: <code>${escapeHtml(job.payload.userId)}</code>\n` : '') +
      `Error: ${escapeHtml(job.lastError || '-')}\n\n` +
      `Check the bot's admin rights in that chat, then use /jobs to retry.`);
  }
}

async function maintenance(telegram, now = new Date()) {
  access.sweepExpiredLinks(now);
  jobsDb.purgeDone(now);
  purgeExpiredStates(now.getTime());
  await reconcilePayments(telegram, { now });
  await reconcileRefunds(telegram);
  await alertDeadJobs(telegram);
}

function start(bot) {
  let busy = false;
  let tick = 0;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await runOnce(bot.telegram);
      // Housekeeping is heavier; do it about once a minute.
      tick += 1;
      if (tick % Math.max(1, Math.round(60 / config.JOB_POLL_SECONDS)) === 1) await maintenance(bot.telegram);
    } catch (err) {
      console.error('[jobs] run failed:', errText(err));
    } finally {
      busy = false;
    }
  };
  run();
  setInterval(run, config.JOB_POLL_SECONDS * 1000);
  console.log(`[jobs] Durable job runner started (every ${config.JOB_POLL_SECONDS}s).`);
}

module.exports = { start, runOnce, maintenance, alertDeadJobs };
