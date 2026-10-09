const walletsDb = require('../db/wallets');
const usersDb = require('../db/users');
const subscriptionsDb = require('../db/subscriptions');
const manualDb = require('../db/manualPayments');
const ticketsDb = require('../db/tickets');
const { dayKey } = require('../utils/format');

const IN_TYPES = new Set(['recharge', 'upi_recharge']);
const SPEND_TYPES = new Set(['plan_purchase', 'channel_unlock', 'plan_renew', 'plan_auto_renew']);

// The last N calendar days (shop timezone) as a Set of YYYY-MM-DD keys.
function lastDays(n, now = new Date()) {
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  return keys;
}

// days = number of days back (1 = today only). days = 0 / null -> all time.
function summary(days, now = new Date()) {
  const keys = days ? new Set(lastDays(days, now)) : null;
  const inRange = iso => !keys || keys.has(dayKey(iso));

  const out = {
    recharged: 0, rechargeCount: 0, upiStars: 0, bonusGiven: 0, referralPaid: 0,
    spent: 0, spentCount: 0, refunded: 0, newUsers: 0,
    byPlan: new Map(), byDay: new Map()
  };

  for (const w of walletsDb.listAll()) {
    for (const x of w.transactions) {
      if (!inRange(x.date)) continue;
      const day = dayKey(x.date);
      if (IN_TYPES.has(x.type)) {
        out.recharged += x.amount; out.rechargeCount += 1;
        if (x.type === 'upi_recharge') out.upiStars += x.amount;
        out.byDay.set(day, (out.byDay.get(day) || 0) + x.amount);
      } else if (x.type === 'bonus') {
        out.bonusGiven += x.amount;
      } else if (x.type === 'referral_reward') {
        out.referralPaid += x.amount;
      } else if (SPEND_TYPES.has(x.type)) {
        const amt = -x.amount;
        out.spent += amt; out.spentCount += 1;
        const name = x.planTitle || x.channelTitle || 'Unknown';
        const cur = out.byPlan.get(name) || { n: 0, stars: 0 };
        cur.n += 1; cur.stars += amt;
        out.byPlan.set(name, cur);
      } else if (x.type === 'refund' || x.type === 'plan_purchase_refund') {
        out.refunded += x.amount;
      }
    }
  }
  out.newUsers = usersDb.list().filter(u => inRange(u.joinedAt)).length;
  out.topPlans = Array.from(out.byPlan.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 5);
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
    todayRecharged: today.recharged,
    todaySpent: today.spent,
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

module.exports = { summary, dashboard, segmentUserIds, lastDays };
