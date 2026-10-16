const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
h.setup();

const paymentsDb = require('../src/db/payments');
const walletsDb = require('../src/db/wallets');
const svc = require('../src/services/payments');

const USER = 4242;
const payload = (id = USER) => svc.buildPayload(id);
const pay = (over = {}) => ({
  telegram_payment_charge_id: 'charge_abc123', provider_payment_charge_id: '',
  invoice_payload: payload(), currency: 'XTR', total_amount: 100, ...over
});
const noop = async () => {};

test.beforeEach(() => h.resetData());

test('validateInvoice accepts a correct invoice', () => {
  assert.strictEqual(svc.validateInvoice({ payload: payload(), currency: 'XTR', amount: 50, fromId: USER }).ok, true);
});

test('validateInvoice rejects wrong currency, amount, payload and payer', () => {
  const base = { payload: payload(), currency: 'XTR', amount: 50, fromId: USER };
  assert.strictEqual(svc.validateInvoice({ ...base, currency: 'USD' }).reason, 'bad_currency');
  assert.strictEqual(svc.validateInvoice({ ...base, amount: 0 }).reason, 'bad_amount');
  assert.strictEqual(svc.validateInvoice({ ...base, amount: 10001 }).reason, 'bad_amount');
  assert.strictEqual(svc.validateInvoice({ ...base, amount: 1.5 }).reason, 'bad_amount');
  assert.strictEqual(svc.validateInvoice({ ...base, payload: 'hacked_1_2' }).reason, 'bad_payload');
  assert.strictEqual(svc.validateInvoice({ ...base, fromId: 999 }).reason, 'payer_mismatch');
  assert.strictEqual(svc.validateInvoice({ ...base, payload: `recharge_${USER}_${Date.now() + 3600000}` }).reason, 'bad_payload');
});

test('pre-checkout answers yes/no but never touches the wallet', () => {
  const q = { from: { id: USER }, currency: 'XTR', total_amount: 50, invoice_payload: payload() };
  assert.deepStrictEqual(svc.preCheckoutDecision(q), { ok: true });
  assert.strictEqual(svc.preCheckoutDecision({ ...q, total_amount: 0 }).ok, false);
  assert.strictEqual(svc.preCheckoutDecision(q, { isBanned: () => true }).reason, 'banned');
  assert.strictEqual(walletsDb.getBalance(USER), 0);
  assert.strictEqual(paymentsDb.listAll().length, 0);
});

test('a verified payment credits the wallet once (with bonus)', async () => {
  const tg = h.fakeTelegram();
  const r = await svc.processSuccessfulPayment(tg, USER, pay(), { notify: noop });
  assert.strictEqual(r.status, 'credited');
  assert.strictEqual(walletsDb.getBalance(USER), 105); // 100 + 5% package bonus
  const rec = paymentsDb.getByCharge('charge_abc123');
  assert.strictEqual(rec.status, 'credited');
  assert.strictEqual(rec.stars, 100);
});

test('the same update delivered again does not credit twice', async () => {
  const tg = h.fakeTelegram();
  await svc.processSuccessfulPayment(tg, USER, pay(), { notify: noop });
  const again = await svc.processSuccessfulPayment(tg, USER, pay(), { notify: noop });
  assert.strictEqual(again.status, 'duplicate');
  assert.strictEqual(walletsDb.getBalance(USER), 105);
  assert.strictEqual(paymentsDb.listAll().length, 1);
});

test('concurrent deliveries of one charge credit exactly once', async () => {
  const tg = h.fakeTelegram();
  const results = await Promise.all([1, 2, 3, 4].map(() => svc.processSuccessfulPayment(tg, USER, pay(), { notify: noop })));
  assert.strictEqual(results.filter(r => r.status === 'credited').length, 1);
  assert.strictEqual(walletsDb.getBalance(USER), 105);
  assert.strictEqual(paymentsDb.listAll().length, 1);
});

test('invalid payloads are recorded as rejected, never credited, and alert admins', async () => {
  const tg = h.fakeTelegram();
  const alerts = [];
  const notify = async (_t, msg) => alerts.push(msg);
  for (const [i, bad] of [
    { invoice_payload: 'forged' }, { currency: 'USD' }, { total_amount: 99999 }, { invoice_payload: payload(777) }
  ].entries()) {
    const r = await svc.processSuccessfulPayment(tg, USER, pay({ telegram_payment_charge_id: `bad_charge_${i}`, ...bad }), { notify });
    assert.strictEqual(r.status, 'rejected');
  }
  assert.strictEqual(walletsDb.getBalance(USER), 0);
  assert.strictEqual(paymentsDb.listByStatus('rejected').length, 4);
  assert.strictEqual(alerts.length, 4);
});

test('a database failure mid-credit is recovered by reconciliation without double credit', async () => {
  const tg = h.fakeTelegram();
  const failingCredit = async () => { throw new Error('disk full'); };
  await assert.rejects(svc.processSuccessfulPayment(tg, USER, pay(), { notify: noop, credit: failingCredit }), /disk full/);
  assert.strictEqual(paymentsDb.getByCharge('charge_abc123').status, 'received');
  assert.strictEqual(walletsDb.getBalance(USER), 0);

  const fixed = await svc.reconcilePayments(tg, { minAgeMs: 0 });
  assert.strictEqual(fixed, 1);
  assert.strictEqual(paymentsDb.getByCharge('charge_abc123').status, 'credited');
  assert.strictEqual(walletsDb.getBalance(USER), 105);

  assert.strictEqual(await svc.reconcilePayments(tg, { minAgeMs: 0 }), 0);
  assert.strictEqual(walletsDb.getBalance(USER), 105);
});

test('recovery after a crash between the recharge and its bonus adds the bonus once', async () => {
  const tg = h.fakeTelegram();
  walletsDb.addTransaction(USER, 100, 'recharge', { telegramPaymentChargeId: 'charge_abc123' }); // credited, bonus missing
  paymentsDb.begin({ chargeId: 'charge_abc123', userId: USER, stars: 100 });
  await svc.reconcilePayments(tg, { minAgeMs: 0 });
  await svc.reconcilePayments(tg, { minAgeMs: 0 });
  assert.strictEqual(walletsDb.getBalance(USER), 105);
  assert.strictEqual(walletsDb.getWallet(USER).transactions.filter(x => x.type === 'bonus').length, 1);
});
