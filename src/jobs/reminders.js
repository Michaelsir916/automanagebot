const { Markup } = require('telegraf');
const subscriptionsDb = require('../db/subscriptions');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const walletsDb = require('../db/wallets');
const couponsDb = require('../db/coupons');
const settingsDb = require('../db/settings');
const bansDb = require('../db/bans');
const { quote } = require('../services/pricing');
const { runBackup } = require('../services/backup');
const { t } = require('../utils/i18n');
const { btnSuccess } = require('../utils/keyboards');
const { sendToUser } = require('../utils/notify');
const { escapeHtml, fmtDay, timeLeft } = require('../utils/format');
const { sleep } = require('../utils/resilience');

const DAY = 24 * 60 * 60 * 1000;

function titleOf(group) {
  const plan = group.planId ? plansDb.getById(group.planId) : null;
  if (plan) return escapeHtml(plan.title);
  const ch = channelsDb.getById(group.channelIds[0]);
  return escapeHtml(ch ? ch.title : '-');
}

function dayList(value, fallback) {
  const arr = (Array.isArray(value) ? value : fallback).map(Number).filter(n => n > 0);
  return arr.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 1) Expiry reminders (e.g. 3 days and 1 day before). Each reminder is sent
//    once per subscription period. If the bot was offline and we are already
//    inside the 1-day window, only ONE reminder goes out (not both).
// ---------------------------------------------------------------------------
async function sweepReminders(telegram, now = new Date()) {
  const days = dayList(settingsDb.get('reminderDays'), [3, 1]);
  if (!days.length) return;

  for (const g of subscriptionsDb.listGroups()) {
    if (g.status !== 'active') continue;
    const left = new Date(g.expiresAt) - now;
    if (left <= 0) continue;

    const due = days.find(d => left <= d * DAY);
    if (!due || g.flags[`remind_${due}`]) continue;

    // Flag FIRST (also all larger windows), so a crash can never double-send.
    days.filter(d => d >= due).forEach(d => subscriptionsDb.setGroupFlag(g.groupId, `remind_${d}`, true));

    const plan = g.planId ? plansDb.getById(g.planId) : null;
    let discount = '';
    let warn = '';
    if (plan) {
      const q = quote(plan, g.userId);
      if (q.isRenewal && q.renewPct > 0) discount = t(g.userId, 'remind_discount', { pct: q.renewPct });
      const balance = walletsDb.getBalance(g.userId);
      if (g.autoRenew && balance < q.final) {
        warn = t(g.userId, 'remind_warn_balance', { balance, price: q.final });
      }
    }

    await sendToUser(
      telegram, g.userId,
      t(g.userId, 'remind_days', {
        title: titleOf(g), left: timeLeft(g.expiresAt, now), date: fmtDay(g.expiresAt), discount, warn
      }),
      { ...Markup.inlineKeyboard([[btnSuccess(t(g.userId, 'btn_renew_now'), 'menu_plans')]]) }
    );
    await sleep(60);
  }
}

// ---------------------------------------------------------------------------
// 2) Win-back: N days after expiry send a personal one-time coupon, and a
//    last reminder before it lapses. Only for people who did NOT come back,
//    and only within a short window (so switching the feature on never
//    spams users who expired months ago).
// ---------------------------------------------------------------------------
async function sweepWinback(telegram, now = new Date()) {
  const s = settingsDb.load();
  if (!s.winbackEnabled || !(Number(s.winbackDiscountPct) > 0)) return;
  const days = dayList(s.winbackAfterDays, [3, 7]);
  if (!days.length) return;

  const first = days[0];
  const last = days.length > 1 ? days[days.length - 1] : null;
  const pct = Math.min(90, Number(s.winbackDiscountPct));
  const groups = subscriptionsDb.listGroups();
  const activeUsers = new Set(
    groups.filter(g => g.status === 'active' && new Date(g.expiresAt) > now).map(g => String(g.userId))
  );

  for (const g of groups) {
    if (g.status !== 'expired') continue;
    if (activeUsers.has(String(g.userId))) continue;
    if (bansDb.isBanned(g.userId)) continue;

    const age = now - new Date(g.expiresAt);
    const title = titleOf(g);

    // --- first message + coupon ---
    if (!g.flags[`winback_${first}`] && age >= first * DAY && age < (first + 2) * DAY) {
      // Skip if this user already got a win-back coupon from another group recently.
      const already = groups.some(o =>
        String(o.userId) === String(g.userId) && o.groupId !== g.groupId && o.flags[`winback_${first}`]
        && now - new Date(o.expiresAt) < 30 * DAY);
      if (already) { subscriptionsDb.setGroupFlag(g.groupId, `winback_${first}`, 'skipped'); continue; }

      const validDays = (last ? last - first : 4) + 3;
      let coupon;
      try {
        coupon = couponsDb.create({
          code: couponsDb.randomCode('BACK'), type: 'percent', value: pct, maxUses: 1,
          expiresAt: new Date(now.getTime() + validDays * DAY).toISOString(),
          userId: g.userId, planIds: g.planId && plansDb.getById(g.planId) ? [g.planId] : [],
          createdBy: 'system', source: 'winback'
        });
      } catch (e) { continue; }
      subscriptionsDb.setGroupFlag(g.groupId, `winback_${first}`, coupon.code);
      await sendToUser(
        telegram, g.userId,
        t(g.userId, 'winback_3', { title, code: coupon.code, pct, date: fmtDay(coupon.expiresAt) }),
        { ...Markup.inlineKeyboard([[btnSuccess(t(g.userId, 'btn_renew_now'), 'menu_plans')]]) }
      );
      await sleep(60);
      continue;
    }

    // --- last reminder (only if the coupon is still unused) ---
    const code = g.flags[`winback_${first}`];
    if (last && typeof code === 'string' && code !== 'skipped' && !g.flags[`winback_${last}`]
        && age >= last * DAY && age < (last + 2) * DAY) {
      subscriptionsDb.setGroupFlag(g.groupId, `winback_${last}`, true);
      const c = couponsDb.get(code);
      if (!c || !c.active || c.used > 0 || (c.expiresAt && new Date(c.expiresAt) <= now)) continue;
      await sendToUser(
        telegram, g.userId,
        t(g.userId, 'winback_7', { pct, code: c.code, date: fmtDay(c.expiresAt) }),
        { ...Markup.inlineKeyboard([[btnSuccess(t(g.userId, 'btn_renew_now'), 'menu_plans')]]) }
      );
      await sleep(60);
    }
  }
}

// ---------------------------------------------------------------------------
// 3) Automatic backup to every super admin's DM.
// ---------------------------------------------------------------------------
async function maybeBackup(telegram, now = new Date()) {
  const s = settingsDb.load();
  if (!s.backupEnabled) return;
  const every = Math.max(1, Number(s.backupEveryHours) || 12) * 60 * 60 * 1000;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt).getTime() : 0;
  if (now.getTime() - last < every) return;
  settingsDb.set('lastBackupAt', now.toISOString()); // set first: never loops on failure
  const res = await runBackup(telegram, 'scheduled');
  console.log(`[backup] ${res.name} (${(res.size / 1024).toFixed(1)} KB) sent to ${res.sent} admin(s).`);
}

function safe(label, fn) {
  return async () => {
    try { await fn(); } catch (err) { console.error(`[reminders] ${label} failed:`, err.message); }
  };
}

function start(bot) {
  const tick = safe('tick', async () => {
    await safe('reminders', () => sweepReminders(bot.telegram))();
    await safe('winback', () => sweepWinback(bot.telegram))();
    await safe('backup', () => maybeBackup(bot.telegram))();
  });
  setTimeout(tick, 20 * 1000);          // shortly after startup
  setInterval(tick, 15 * 60 * 1000);    // then every 15 minutes
  console.log('[reminders] Expiry reminders, win-back and auto-backup scheduled.');
}

module.exports = { start, sweepReminders, sweepWinback, maybeBackup };
