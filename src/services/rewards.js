const walletsDb = require('../db/wallets');
const usersDb = require('../db/users');
const settingsDb = require('../db/settings');
const { t } = require('../utils/i18n');
const { sendToUser } = require('../utils/notify');
const { escapeHtml, fmtDate, fmtNum } = require('../utils/format');

// Bonus % for a recharge amount = the bonus of the largest package that is
// <= the amount (so custom amounts get a fair, consistent tier too).
function bonusPctFor(stars) {
  const pkgs = [...settingsDb.get('rechargePackages')].sort((a, b) => a.stars - b.stars);
  let pct = 0;
  for (const p of pkgs) if (stars >= p.stars) pct = p.bonusPct || 0;
  return pct;
}

// Reward the referrer once, on the referred user's FIRST successful recharge.
async function maybeRewardReferrer(telegram, userId) {
  const s = settingsDb.load();
  if (!s.referralEnabled || !(s.referralRewardStars > 0)) return null;
  const u = usersDb.get(userId);
  if (!u || !u.referredBy || u.referralRewarded) return null;
  // Flip the flag FIRST so a crash/double-call can never pay twice.
  usersDb.update(userId, { referralRewarded: true });
  walletsDb.addTransaction(u.referredBy, s.referralRewardStars, 'referral_reward', { referredUser: String(userId) });
  const refUser = usersDb.get(u.referredBy);
  const name = escapeHtml(u.firstName || u.username || String(userId));
  await sendToUser(telegram, u.referredBy, t(u.referredBy, 'referral_rewarded_notify', { name, stars: s.referralRewardStars }));
  return { referrerId: u.referredBy, stars: s.referralRewardStars, refUser };
}

// Single entry point for "money came in": Telegram Stars invoice AND
// approved UPI payments both go through here, so bonus, referral reward and
// the receipt behave identically.
async function creditRecharge(telegram, userId, stars, { type = 'recharge', meta = {} } = {}) {
  let wallet = walletsDb.addTransaction(userId, stars, type, meta);
  const txnId = wallet.transactions[wallet.transactions.length - 1].id;

  const pct = bonusPctFor(stars);
  const bonus = Math.floor(stars * pct / 100);
  if (bonus > 0) {
    wallet = walletsDb.addTransaction(userId, bonus, 'bonus', { for: txnId, pct });
  }

  const receipt = t(userId, 'receipt_recharge', {
    id: txnId, stars: fmtNum(stars),
    bonus: bonus > 0 ? t(userId, 'receipt_bonus', { bonus, pct }) : '',
    balance: fmtNum(wallet.balance), date: fmtDate(new Date())
  });
  await sendToUser(telegram, userId, receipt);

  try { await maybeRewardReferrer(telegram, userId); } catch (e) { console.error('[rewards] referral failed:', e.message); }

  return { wallet, txnId, bonus, pct };
}

module.exports = { creditRecharge, bonusPctFor, maybeRewardReferrer };
