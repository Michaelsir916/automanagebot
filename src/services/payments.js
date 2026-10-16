const paymentsDb = require('../db/payments');
const walletsDb = require('../db/wallets');
const { creditRecharge } = require('./rewards');
const { notifyAdmins } = require('../utils/notify');
const { escapeHtml } = require('../utils/format');

const MAX_STARS_PER_INVOICE = 10000;
const CURRENCY = 'XTR'; // Telegram Stars
const PAYLOAD_RE = /^recharge_(\d{1,15})_(\d{10,15})$/;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const REASON_TEXT = {
  bad_currency: 'Unexpected currency.',
  bad_amount: 'Unexpected amount.',
  bad_payload: 'This invoice is not valid.',
  payer_mismatch: 'This invoice belongs to a different account.',
  banned: 'This account cannot make payments.'
};

function buildPayload(userId, now = Date.now()) {
  return `recharge_${userId}_${now}`;
}

// Pure validation shared by pre-checkout and successful-payment handling:
// currency, amount range, payload shape, and that the payer is the user the
// invoice was created for. Nothing the client sends is trusted beyond this.
function validateInvoice({ payload, currency, amount, fromId, now = Date.now() }) {
  if (currency !== CURRENCY) return { ok: false, reason: 'bad_currency' };
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_STARS_PER_INVOICE) return { ok: false, reason: 'bad_amount' };
  const m = PAYLOAD_RE.exec(String(payload || ''));
  if (!m) return { ok: false, reason: 'bad_payload' };
  if (m[1] !== String(fromId)) return { ok: false, reason: 'payer_mismatch' };
  const issuedAt = Number(m[2]);
  if (issuedAt > now + FUTURE_SKEW_MS) return { ok: false, reason: 'bad_payload' };
  return { ok: true, userId: m[1], issuedAt };
}

// Decision for a pre_checkout_query. Access/credit is NEVER granted here;
// this only says yes/no to letting Telegram take the payment. Must stay
// synchronous and fast: Telegram requires an answer within 10 seconds.
function preCheckoutDecision(query, { isBanned = () => false } = {}) {
  const v = validateInvoice({
    payload: query.invoice_payload, currency: query.currency,
    amount: query.total_amount, fromId: query.from && query.from.id
  });
  if (!v.ok) return { ok: false, reason: v.reason, message: REASON_TEXT[v.reason] };
  if (isBanned(query.from.id)) return { ok: false, reason: 'banned', message: REASON_TEXT.banned };
  return { ok: true };
}

const inFlight = new Set();

async function finishCredit(telegram, record, credit) {
  const res = await credit(telegram, record.userId, record.stars, {
    type: 'recharge', meta: { telegramPaymentChargeId: record.telegramPaymentChargeId }
  });
  paymentsDb.setStatus(record.telegramPaymentChargeId, 'credited', { walletTxnId: res && res.txnId ? res.txnId : undefined });
  return res;
}

// Handles message.successful_payment. Safe to call any number of times for
// the same charge: the payment row is keyed by Telegram's charge ID, so a
// re-delivered update, a restart mid-way, or two concurrent deliveries can
// only ever credit the wallet once.
async function processSuccessfulPayment(telegram, fromId, payment, deps = {}) {
  const credit = deps.credit || creditRecharge;
  const notify = deps.notify || notifyAdmins;
  const chargeId = payment && payment.telegram_payment_charge_id;

  if (!chargeId) {
    await notify(telegram, `⚠️ <b>Payment without a charge ID</b> from user ${escapeHtml(fromId)} - nothing was credited. Check manually.`);
    return { status: 'invalid' };
  }

  const v = validateInvoice({
    payload: payment.invoice_payload, currency: payment.currency,
    amount: payment.total_amount, fromId, now: deps.now
  });

  if (!v.ok) {
    // Money was taken but the invoice does not match what we issued. Do not
    // credit; keep a permanent record and tell the admins so they can refund.
    const { created } = paymentsDb.begin({
      chargeId, providerChargeId: payment.provider_payment_charge_id, userId: fromId,
      stars: Number(payment.total_amount) || 0, currency: String(payment.currency || ''),
      payload: String(payment.invoice_payload || '').slice(0, 100), status: 'rejected', note: v.reason
    });
    if (created) {
      await notify(telegram,
        `🚨 <b>Payment REJECTED (not credited)</b>\n\nReason: ${escapeHtml(v.reason)}\nUser: <code>${escapeHtml(fromId)}</code>\n` +
        `Amount: ${escapeHtml(payment.total_amount)} ${escapeHtml(payment.currency)}\nCharge ID: <code>${escapeHtml(chargeId)}</code>\n\n` +
        `Refund with <code>/refund ${escapeHtml(chargeId)}</code> if appropriate.`);
    }
    return { status: 'rejected', reason: v.reason };
  }

  if (inFlight.has(chargeId)) return { status: 'duplicate' };
  inFlight.add(chargeId);
  try {
    const { record, created } = paymentsDb.begin({
      chargeId, providerChargeId: payment.provider_payment_charge_id, userId: fromId,
      stars: payment.total_amount, currency: payment.currency, payload: String(payment.invoice_payload).slice(0, 100)
    });
    if (!created && paymentsDb.statusOf(record) !== 'received') return { status: 'duplicate' };
    await finishCredit(telegram, record, credit);
    return { status: 'credited', resumed: !created };
  } finally {
    inFlight.delete(chargeId);
  }
}

// Finishes payments that were recorded as "received" but never got credited
// (crash / failed write between the two steps). Run at boot and on a timer.
async function reconcilePayments(telegram, { now = new Date(), minAgeMs = 60 * 1000, credit = creditRecharge } = {}) {
  let fixed = 0;
  for (const rec of paymentsDb.listByStatus('received')) {
    if (now - new Date(rec.date) < minAgeMs) continue;
    if (inFlight.has(rec.telegramPaymentChargeId)) continue;
    inFlight.add(rec.telegramPaymentChargeId);
    try {
      await finishCredit(telegram, rec, credit);
      fixed += 1;
      console.warn(`[payments] reconciled uncredited payment ${rec.id} (user ${rec.userId}, ${rec.stars} stars)`);
    } catch (err) {
      console.error(`[payments] reconcile failed for ${rec.id}:`, err.message);
    } finally {
      inFlight.delete(rec.telegramPaymentChargeId);
    }
  }
  return fixed;
}

// Total wallet value a given charge produced (the recharge plus its bonus).
function creditedWalletValue(record) {
  const txn = walletsDb.findByChargeId(record.userId, record.telegramPaymentChargeId);
  if (!txn) return record.stars;
  const bonus = walletsDb.findTxn(record.userId, x => x.type === 'bonus' && x.for === txn.id);
  return txn.amount + (bonus ? bonus.amount : 0);
}

module.exports = {
  MAX_STARS_PER_INVOICE, CURRENCY, buildPayload, validateInvoice, preCheckoutDecision,
  processSuccessfulPayment, reconcilePayments, creditedWalletValue
};
