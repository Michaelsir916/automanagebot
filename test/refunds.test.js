const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
h.setup();

const paymentsDb = require('../src/db/payments');
const refundsDb = require('../src/db/refunds');
const walletsDb = require('../src/db/wallets');
const payments = require('../src/services/payments');
const refunds = require('../src/services/refunds');

const USER = 4242;
const CHARGE = 'charge_refund_1';
const noop = async () => {};

async function paid(stars = 100) {
  const tg = h.fakeTelegram();
  await payments.processSuccessfulPayment(tg, USER, {
    telegram_payment_charge_id: CHARGE, invoice_payload: payments.buildPayload(USER), currency: 'XTR', total_amount: stars
  }, { notify: noop });
}

test.beforeEach(() => h.resetData());

test('refund returns the Stars via Telegram and takes the wallet value back', async () => {
  await paid(100); // wallet: 105
  const tg = h.fakeTelegram();
  const r = await refunds.refundStarsPayment(tg, CHARGE, { adminId: 1 });
  assert.strictEqual(r.code, 'refunded');
  const call = tg.calls.find(c => c.name === 'callApi');
  assert.strictEqual(call.args[0], 'refundStarPayment');
  assert.strictEqual(call.args[1].telegram_payment_charge_id, CHARGE);
  assert.strictEqual(walletsDb.getBalance(USER), 0);
  assert.strictEqual(paymentsDb.getByCharge(CHARGE).status, 'refunded');
  assert.strictEqual(refundsDb.getByKey(`stars:${CHARGE}`).status, 'completed');
  // history is preserved: the original payment and its wallet credit still exist
  assert.strictEqual(paymentsDb.listAll().length, 1);
});

test('a second refund of the same charge is refused and Telegram is not called again', async () => {
  await paid(100);
  const tg = h.fakeTelegram();
  await refunds.refundStarsPayment(tg, CHARGE, { adminId: 1 });
  const again = await refunds.refundStarsPayment(tg, CHARGE, { adminId: 1 });
  assert.strictEqual(again.code, 'already_refunded');
  assert.strictEqual(tg.calls.filter(c => c.name === 'callApi').length, 1);
});

test('refund is refused while the user has already spent the Stars', async () => {
  await paid(100);
  walletsDb.tryDebit(USER, 90, 'plan_purchase', {});
  const tg = h.fakeTelegram();
  const r = await refunds.refundStarsPayment(tg, CHARGE, { adminId: 1 });
  assert.strictEqual(r.code, 'insufficient_balance');
  assert.strictEqual(r.needed, 105);
  assert.strictEqual(tg.calls.filter(c => c.name === 'callApi').length, 0);
  assert.strictEqual(paymentsDb.getByCharge(CHARGE).status, 'credited');
  assert.strictEqual(walletsDb.getBalance(USER), 15);
});

test('a permanent Telegram error restores the wallet and the payment status', async () => {
  await paid(100);
  const tg = h.fakeTelegram({ callApi: () => { throw h.apiError(400, 'Bad Request: CHARGE_NOT_FOUND'); } });
  const r = await refunds.refundStarsPayment(tg, CHARGE, { adminId: 1 });
  assert.strictEqual(r.code, 'telegram_error');
  assert.strictEqual(walletsDb.getBalance(USER), 105);
  assert.strictEqual(paymentsDb.getByCharge(CHARGE).status, 'credited');
  // a later retry works from a clean state
  const ok = await refunds.refundStarsPayment(h.fakeTelegram(), CHARGE, { adminId: 1 });
  assert.strictEqual(ok.code, 'refunded');
  assert.strictEqual(walletsDb.getBalance(USER), 0);
});

test('an unclear Telegram timeout stays pending and the reconciler finishes it safely', async () => {
  await paid(100);
  const timeoutTg = h.fakeTelegram({ callApi: () => { throw h.timeoutError(); } });
  const r = await refunds.refundStarsPayment(timeoutTg, CHARGE, { adminId: 1 });
  assert.strictEqual(r.code, 'pending');
  assert.strictEqual(paymentsDb.getByCharge(CHARGE).status, 'refunding');
  assert.strictEqual(walletsDb.getBalance(USER), 0); // wallet already debited, user cannot spend it meanwhile

  // The first attempt had actually gone through: Telegram says so on retry.
  const tg = h.fakeTelegram({ callApi: () => { throw h.apiError(400, 'Bad Request: CHARGE_ALREADY_REFUNDED'); } });
  const done = await refunds.reconcileRefunds(Object.assign(tg, { sendMessage: async () => {} }));
  assert.strictEqual(done, 1);
  assert.strictEqual(paymentsDb.getByCharge(CHARGE).status, 'refunded');
  assert.strictEqual(walletsDb.getBalance(USER), 0);
});

test('a rejected (never credited) payment can be refunded without touching the wallet', async () => {
  const tg = h.fakeTelegram();
  await payments.processSuccessfulPayment(tg, USER, {
    telegram_payment_charge_id: 'charge_bad', invoice_payload: 'forged', currency: 'XTR', total_amount: 30
  }, { notify: noop });
  walletsDb.addTransaction(USER, 7, 'admin_adjust', {});
  const r = await refunds.refundStarsPayment(tg, 'charge_bad', { adminId: 1 });
  assert.strictEqual(r.code, 'refunded');
  assert.strictEqual(walletsDb.getBalance(USER), 7);
});

test('wallet-credit refunds are paid back only once per key', () => {
  const args = { key: 'purchase:txn_1', userId: USER, amount: 50, type: 'plan_purchase_refund', reason: 'fulfillment failed' };
  assert.strictEqual(refunds.creditBackToWallet(args).ok, true);
  assert.strictEqual(refunds.creditBackToWallet(args).code, 'already_refunded');
  assert.strictEqual(walletsDb.getBalance(USER), 50);
});

test('a crash after the credit but before the ledger update does not pay twice', () => {
  const args = { key: 'link:lnk_9', userId: USER, amount: 20, type: 'refund', reason: 'misuse' };
  refundsDb.begin(args.key, { kind: 'wallet_credit' });
  walletsDb.addTransaction(USER, 20, 'refund', { refundKey: args.key }); // credit happened, ledger still "pending"
  const r = refunds.creditBackToWallet(args);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(walletsDb.getBalance(USER), 20);
});
