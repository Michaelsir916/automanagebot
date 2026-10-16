const walletsDb = require('../db/wallets');
const usersDb = require('../db/users');
const subscriptionsDb = require('../db/subscriptions');
const manualDb = require('../db/manualPayments');
const paymentsDb = require('../db/payments');
const refundsDb = require('../db/refunds');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const ticketsDb = require('../db/tickets');
const { dayKey } = require('../utils/format');

const SPEND_TYPES = new Set(['plan_purchase', 'channel_unlock', 'plan_renew', 'plan_auto_renew']);
const RENEWAL_TYPES = new Set(['plan_renew', 'plan_auto_renew']);
const WALLET_REFUND_TYPES = new Set(['refund', 'plan_purchase_refund']);

// ---------------------------------------------------------------------------
// Metric definitions (also in docs/METRICS.md). Money sources are never mixed:
//
//  starsGross      Telegram Stars actually received: payments in status
//                  credited/refunded, by payment date.
//  starsRefunded   Stars returned to payers via Telegram (refund ledger,
//                  kind "stars", completed), by refund date.
//  starsNet        starsGross - starsRefunded (cash-flow view for the period).
//  upiCredited     Wallet credit from approved UPI payments. NOT Stars revenue.
//  bonusGiven /    Wallet credits the shop gave away. Not revenue.
//  referralPaid
//  planSales       Wallet value spent on plans (new purchases + renewals).
//  walletRefunds   Wallet value credited back (failed delivery, link misuse).
//  planSalesNet    planSales - walletRefunds.
//  byPlan          planSalesNet-style totals per plan title (one row per purchase).
//  byChannel       Each purchase's price is split EQUALLY across the channels
//                  the plan contained at purchase time, so a 3-channel bundle
//                  is counted once in total, never once per channel.
// ---------------------------------------------------------------------------

// The last N calendar days (shop timezone) as a Set of YYYY-MM-DD keys.
function lastDays(n, now = new Date()) {
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  return keys;
}

// Split an amount over channels in whole cents; any remainder goes to the
// first channels so the parts always add up exactly to the amount.
function allocateAcrossChannels(amount, channelIds) {
  if (!channelIds.length) return [];
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / channelIds.length);
  let rest = cents - base * channelIds.length;
  return channelIds.map(id => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return [id, (base + extra) / 100];
  });
}

function channelsOfTxn(x) {
  if (Array.isArray(x.channelIds) && x.channelIds.length) return x.channelIds;
  if (x.channelId) return [x.channelId];
  if (x.planId) {
    const plan = plansDb.getById(x.planId);
    if (plan && plan.channelIds && plan.channelIds.length) return plan.channelIds;
  }
  return [];
}

// days = number of days back (1 = today only). days = 0 / null -> all time.
function summary(days, now = new Date()) {
  const keys = days ? new Set(lastDays(days, now)) : null;
  const inRange = iso => !keys || keys.has(dayKey(iso));

  const out = {
    starsGross: 0, starsCount: 0, starsRefunded: 0, starsRefundCount: 0, starsNet: 0,
    upiCredited: 0, upiCount: 0, bonusGiven: 0, referralPaid: 0,
    planSales: 0, newPurchases: 0, renewals: 0, walletRefunds: 0, planSalesNet: 0,
    newUsers: 0, byPlan: new Map(), byChannel: new Map(), byDay: new Map()
  };
  const addDay = (day, v) => out.byDay.set(day, Math.round(((out.byDay.get(day) || 0) + v) * 100) / 100);

  for (const p of paymentsDb.listAll()) {
    const st = paymentsDb.statusOf(p);
    if (st !== 'credited' && st !== 'refunded' && st !== 'refunding') continue;
    if (!inRange(p.date)) continue;
    out.starsGross += p.stars; out.starsCount += 1;
    addDay(dayKey(p.date), p.stars);
  }
  for (const r of refundsDb.listAll()) {
    if (r.kind !== 'stars' || r.status !== 'completed' || !r.completedAt || !inRange(r.completedAt)) continue;
    out.starsRefunded += r.stars; out.starsRefundCount += 1;
    addDay(dayKey(r.completedAt), -r.stars);
  }

  for (const w of walletsDb.listAll()) {
    for (const x of w.transactions) {
      if (!inRange(x.date)) continue;
      if (x.type === 'upi_recharge') {
        out.upiCredited += x.amount; out.upiCount += 1;
      } else if (x.type === 'bonus') {
        out.bonusGiven += x.amount;
      } else if (x.type === 'referral_reward') {
        out.referralPaid += x.amount;
      } else if (SPEND_TYPES.has(x.type)) {
        const amt = -x.amount;
        out.planSales += amt;
        if (RENEWAL_TYPES.has(x.type)) out.renewals += 1; else out.newPurchases += 1;
        const name = x.planTitle || x.channelTitle || 'Unknown';
        const cur = out.byPlan.get(name) || { n: 0, stars: 0 };
        cur.n += 1; cur.stars += amt;
        out.byPlan.set(name, cur);
        const chs = channelsOfTxn(x);
        const parts = chs.length ? allocateAcrossChannels(amt, chs) : [['unknown', amt]];
        for (const [id, v] of parts) out.byChannel.set(id, Math.round(((out.byChannel.get(id) || 0) + v) * 100) / 100);
      } else if (WALLET_REFUND_TYPES.has(x.type)) {
        out.walletRefunds += x.amount;
      }
    }
  }

  out.starsNet = out.starsGross - out.starsRefunded;
  out.planSalesNet = out.planSales - out.walletRefunds;
  out.newUsers = usersDb.list().filter(u => inRange(u.joinedAt)).length;
  out.topPlans = Array.from(out.byPlan.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 5);
  out.channelBreakdown = Array.from(out.byChannel.entries())
    .map(([id, stars]) => {
      const ch = channelsDb.getById(id);
      return { id, title: ch ? ch.title : (id === 'unknown' ? 'Unknown / deleted' : id), stars };
    })
    .sort((a, b) => b.stars - a.stars);
  return out;
}

// Snapshot for the admin panel header.
function dashboard(now = new Date()) {
  const today = summary(1, now);
  const subs = subscriptionsDb.listGroups();
  const active = subs.filter(g => g.status === 'active' && new Date(g.expiresAt) > now);
  const activeUsers = new Set(active.map(g => g.userId));
  const in24h = active.filter(g => new Date(g.expiresAt) - now <= 24 * 60 * 60 * 1000);
  return {
    todayStarsNet: today.starsNet,
    todaySales: today.planSalesNet,
    todayNewUsers: today.newUsers,
    totalUsers: usersDb.list().length,
    activeMembers: activeUsers.size,
    expiring24h: new Set(in24h.map(g => g.userId)).size,
    pendingUpi: manualDb.listPending().length,
    openTickets: ticketsDb.listOpen().length
  };
}

// ---- segments for broadcast / counts ----
function userSets(now = new Date()) {
  const users = usersDb.list().filter(u => !u.blocked);
  const ids = new Set(users.map(u => u.id));
  const groups = subscriptionsDb.listGroups();
  const activeUsers = new Set(groups.filter(g => g.status === 'active' && new Date(g.expiresAt) > now).map(g => g.userId));
  const everSub = new Set(groups.map(g => g.userId));
  const paid = new Set(walletsDb.listUsersWithRecharge());
  return { ids, activeUsers, everSub, paid, groups };
}

// segment: 'all' | 'paid' | 'active' | 'expired' | 'never' | 'plan:<planId>'
function segmentUserIds(segment, now = new Date()) {
  const { ids, activeUsers, everSub, paid, groups } = userSets(now);
  const all = Array.from(ids);
  if (segment === 'all') return all;
  if (segment === 'paid') return all.filter(id => paid.has(id));
  if (segment === 'active') return all.filter(id => activeUsers.has(id));
  if (segment === 'expired') return all.filter(id => everSub.has(id) && !activeUsers.has(id));
  if (segment === 'never') return all.filter(id => !paid.has(id) && !everSub.has(id));
  if (segment.startsWith('plan:')) {
    const planId = segment.slice(5);
    const holders = new Set(groups.filter(g => g.planId === planId && g.status === 'active' && new Date(g.expiresAt) > now).map(g => g.userId));
    return all.filter(id => holders.has(id));
  }
  return [];
}

module.exports = { summary, dashboard, segmentUserIds, lastDays, allocateAcrossChannels };
