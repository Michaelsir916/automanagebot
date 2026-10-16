const paymentsDb = require('../db/payments');
const refundsDb = require('../db/refunds');
const walletsDb = require('../db/wallets');
const auditDb = require('../db/audit');
const { creditedWalletValue } = require('./payments');
const { isTransient, errText } = require('../utils/resilience');
const { notifyAdmins } = require('../utils/notify');

// ---------------------------------------------------------------------------
// Refund policy (documented in docs/FEATURES.md)
//
//  * A refund is its own record in data/refunds.json, never an edit of the
//    original payment. The payment keeps its history and only changes status.
//  * Refunding a Telegram Stars charge (refundStarPayment) returns the real
//    Stars to the payer, so the wallet credit that charge produced (recharge
//    + bonus) is taken back FIRST. If the wallet no longer holds that much
//    (the user already spent it) the refund is refused: the admin must revoke
//    the user's access / adjust the wallet deliberately, then retry.
//  * Already-delivered subscriptions are NOT revoked automatically by a Stars
//    refund. Use /revoke <userId> when access should end as well.
//  * Wallet-credit refunds (failed delivery, link misuse) never touch Telegram.
// ---------------------------------------------------------------------------

async function callStarRefund(telegram, userId, chargeId) {
  try {
    await telegram.callApi('refundStarPayment', { user_id: Number(userId), telegram_payment_charge_id: chargeId });
    return 'refunded';
  } catch (err) {
    // Telegram answers this when an earlier (timed-out) attempt actually went through.
    if (/CHARGE_ALREADY_REFUNDED/i.test(errText(err))) return 'already_refunded';
    throw err;
  }
}

function reverseWalletDebit(userId, amount, key) {
  if (!(amount > 0)) return;
  if (!walletsDb.hasMeta(userId, 'refundReversalKey', key)) {
    walletsDb.addTransaction(userId, amount, 'recharge_refund_reversal', { refundReversalKey: key });
  }
}

// Refund a Stars payment by its Telegram charge ID.
// Returns { ok, code, ... }. codes: refunded | not_found | already_refunded |
// not_refundable | insufficient_balance | pending | telegram_error
async function refundStarsPayment(telegram, chargeId, { adminId = 'system', reason = '' } = {}) {
  const payment = paymentsDb.getByCharge(chargeId);
  if (!payment) return { ok: false, code: 'not_found' };

  const status = paymentsDb.statusOf(payment);
  if (status === 'refunded') return { ok: false, code: 'already_refunded' };
  if (status === 'received') return { ok: false, code: 'not_refundable', detail: 'payment is not credited yet; wait for reconciliation' };

  const key = `stars:${chargeId}`;
  const { record: refund } = refundsDb.begin(key, {
    kind: 'stars', chargeId, userId: payment.userId, stars: payment.stars, reason: String(reason).slice(0, 200), adminId: String(adminId)
  });
  if (refund.status === 'completed') return { ok: false, code: 'already_refunded' };

  // Step 1: take the wallet value back (once). Rejected payments never credited anything.
  let debited = refund.walletDebited;
  if (debited === undefined) {
    const total = status === 'rejected' ? 0 : creditedWalletValue(payment);
    if (total > 0) {
      const ok = walletsDb.tryDebit(payment.userId, total, 'recharge_refund', { chargeId, refundKey: key });
      if (!ok) {
        refundsDb.update(key, { status: 'failed', error: 'insufficient_balance' });
        return { ok: false, code: 'insufficient_balance', needed: total, balance: walletsDb.getBalance(payment.userId) };
      }
    }
    debited = total;
    refundsDb.update(key, { walletDebited: total, status: 'pending', error: null });
    paymentsDb.setStatus(chargeId, 'refunding');
  }

  // Step 2: ask Telegram to return the Stars.
  try {
    await callStarRefund(telegram, payment.userId, chargeId);
  } catch (err) {
    if (isTransient(err)) {
      // Outcome unknown (timeout etc). Keep the debit, stay pending; the
      // reconciler retries and Telegram reports CHARGE_ALREADY_REFUNDED if it did go through.
      refundsDb.update(key, { status: 'pending', error: errText(err).slice(0, 200) });
      return { ok: false, code: 'pending', detail: errText(err) };
    }
    reverseWalletDebit(payment.userId, debited, key);
    refundsDb.update(key, { status: 'failed', error: errText(err).slice(0, 200), walletDebited: undefined });
    paymentsDb.setStatus(chargeId, 'credited');
    return { ok: false, code: 'telegram_error', detail: errText(err) };
  }

  // Step 3: record the outcome.
  paymentsDb.setStatus(chargeId, 'refunded');
  refundsDb.update(key, { status: 'completed', completedAt: new Date().toISOString() });
  auditDb.add(adminId, 'refund_stars', `charge ${chargeId} user ${payment.userId} ${payment.stars}⭐`);
  return { ok: true, code: 'refunded', stars: payment.stars, userId: payment.userId };
}

// Retry Stars refunds that were left pending after an unclear Telegram result.
async function reconcileRefunds(telegram) {
  let done = 0;
  for (const r of refundsDb.listPending()) {
    if (r.kind !== 'stars' || r.walletDebited === undefined) continue;
    const res = await refundStarsPayment(telegram, r.chargeId, { adminId: r.adminId || 'system', reason: r.reason });
    if (res.ok) {
      done += 1;
      await notifyAdmins(telegram, `✅ Pending Stars refund completed for charge <code>${r.chargeId}</code>.`);
    }
  }
  return done;
}

// Credit the wallet back once for a given reason key (e.g. "link:lnk_1" or
// "purchase:txn_9"). Pressing the button again, or a crash and retry, finds
// the same key and does nothing the second time.
function creditBackToWallet({ key, userId, amount, type = 'refund', reason = '', adminId = 'system', meta = {} }) {
  const { record } = refundsDb.begin(key, {
    kind: 'wallet_credit', userId: String(userId), amount, reason: String(reason).slice(0, 200), adminId: String(adminId)
  });
  if (record.status === 'completed') return { ok: false, code: 'already_refunded' };
  if (!walletsDb.hasMeta(userId, 'refundKey', key) && amount > 0) {
    walletsDb.addTransaction(userId, amount, type, { refundKey: key, reason, ...meta });
  }
  refundsDb.update(key, { status: 'completed', completedAt: new Date().toISOString() });
  return { ok: true, code: 'refunded', amount };
}

module.exports = { refundStarsPayment, reconcileRefunds, creditBackToWallet };
