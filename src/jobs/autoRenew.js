const subscriptionsDb = require('../db/subscriptions');
const plansDb = require('../db/plans');
const walletsDb = require('../db/wallets');
const adminsDb = require('../db/admins');
const config = require('../config');
const { notifyAdmins } = require('../utils/notify');

// NOTE on design: real Telegram Stars "subscription" invoices auto-charge
// on Telegram's own billing cycle - a bot can't reach in and trigger one on
// demand. Since this bot already tracks a Stars-denominated balance per
// user (db/wallets.js), auto-renew here means: debit that same wallet for
// the plan's price when a subscription is about to expire. This is
// consistent with how every other purchase in this bot works, and it's the
// only way a *bot-initiated* recurring charge is actually possible.
function priceForRenewal(plan, userId) {
  if (adminsDb.isAdmin(userId) && plan.testPrice !== undefined && plan.testPrice !== null) {
    return plan.testPrice;
  }
  return plan.price;
}

async function processDueRenewals(telegram) {
  const intervalMs = Math.max(1, config.AUTO_RENEW_CHECK_INTERVAL_MINUTES) * 60 * 1000;
  const due = subscriptionsDb.listGroupsDueForRenewal(intervalMs, new Date());
  if (due.length === 0) return;

  for (const { groupId, planId, userId } of due) {
    const plan = planId ? plansDb.getById(planId) : null;

    // Auto-renew was on but we don't know what plan/price to re-charge
    // (e.g. the plan was deleted, or this predates the plans system) -
    // safest is to just turn it off and let it expire+kick normally.
    if (!plan) {
      subscriptionsDb.setGroupAutoRenew(groupId, false);
      continue;
    }

    const price = priceForRenewal(plan, userId);
    const balance = walletsDb.getBalance(userId);

    if (balance < price) {
      subscriptionsDb.setGroupAutoRenew(groupId, false);
      try {
        await telegram.sendMessage(
          userId,
          `⚠️ Auto-renew for <b>${plan.title}</b> failed - your wallet balance (${balance}⭐) is below the price (${price}⭐).\n\n` +
          `Auto-renew has been turned off. Recharge your wallet and use the 🔁 Renew button when it expires to unlock access again.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        console.error(`[autoRenew] notify (insufficient balance) failed for ${userId}:`, err.message);
      }
      continue;
    }

    walletsDb.addTransaction(userId, -price, 'plan_auto_renew', { planId: plan.id, planTitle: plan.title });
    subscriptionsDb.renewGroup(groupId, plan.durationDays);

    try {
      await telegram.sendMessage(
        userId,
        `🔁 Auto-renewed <b>${plan.title}</b> for ${price}⭐. Your access continues without interruption.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error(`[autoRenew] notify (success) failed for ${userId}:`, err.message);
    }

    await notifyAdmins(telegram,
      `🔁 <b>Auto-renewed</b>\n\nPlan: ${plan.title}\nUser: ${userId}\nCharged: ${price}⭐`);
  }
}

function start(bot) {
  const intervalMs = Math.max(1, config.AUTO_RENEW_CHECK_INTERVAL_MINUTES) * 60 * 1000;

  const run = () => {
    processDueRenewals(bot.telegram).catch(err => {
      console.error('[autoRenew] run failed:', err.message);
    });
  };

  run();
  setInterval(run, intervalMs);

  console.log(`[autoRenew] Checking for renewals due every ${config.AUTO_RENEW_CHECK_INTERVAL_MINUTES} minute(s).`);
}

module.exports = { start, processDueRenewals };
