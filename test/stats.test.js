const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
h.setup();

const channelsDb = require('../src/db/channels');
const walletsDb = require('../src/db/wallets');
const paymentsDb = require('../src/db/payments');
const refundsDb = require('../src/db/refunds');
const stats = require('../src/services/stats');

test.beforeEach(() => {
  h.resetData();
  for (const n of [1, 2, 3]) channelsDb.add({ id: `ch_${n}`, chatId: `-100${n}`, title: `Chan ${n}`, price: 10, testPrice: 1, durationDays: 30, active: true });
});

test('allocation splits an amount into exact parts', () => {
  const parts = stats.allocateAcrossChannels(50, ['a', 'b', 'c']);
  assert.deepStrictEqual(parts.map(p => p[1]), [16.67, 16.67, 16.66]);
  assert.strictEqual(Math.round(parts.reduce((s, p) => s + p[1], 0) * 100) / 100, 50);
  assert.deepStrictEqual(stats.allocateAcrossChannels(10, ['a']), [['a', 10]]);
  assert.deepStrictEqual(stats.allocateAcrossChannels(10, []), []);
});

test('a multi-channel package is counted once in total and split between channels', () => {
  walletsDb.addTransaction('1', 200, 'recharge', {});
  walletsDb.tryDebit('1', 50, 'plan_purchase', { planId: 'p1', planTitle: 'Bundle', channelIds: ['ch_1', 'ch_2', 'ch_3'] });
  walletsDb.tryDebit('1', 30, 'channel_unlock', { channelTitle: 'Chan 1', channelIds: ['ch_1'] });
  const s = stats.summary(0);
  assert.strictEqual(s.planSales, 80);
  const channelSum = s.channelBreakdown.reduce((sum, c) => sum + c.stars, 0);
  assert.ok(Math.abs(channelSum - 80) < 0.001, `channel parts must add up to total, got ${channelSum}`);
  const c1 = s.channelBreakdown.find(c => c.id === 'ch_1').stars;
  assert.ok(Math.abs(c1 - (16.67 + 30)) < 0.001);
  assert.strictEqual(s.newPurchases, 2);
});

test('Stars received, refunded and net come from the payment and refund ledgers; UPI is separate', () => {
  paymentsDb.begin({ chargeId: 'c1', userId: 1, stars: 100 });
  paymentsDb.setStatus('c1', 'credited');
  paymentsDb.begin({ chargeId: 'c2', userId: 2, stars: 40 });
  paymentsDb.setStatus('c2', 'refunded');
  paymentsDb.begin({ chargeId: 'c3', userId: 3, stars: 999, status: 'rejected' }); // never counted
  refundsDb.begin('stars:c2', { kind: 'stars', stars: 40, chargeId: 'c2' });
  refundsDb.update('stars:c2', { status: 'completed', completedAt: new Date().toISOString() });
  walletsDb.addTransaction('9', 500, 'upi_recharge', {});
  walletsDb.addTransaction('9', 25, 'bonus', {});

  const s = stats.summary(0);
  assert.strictEqual(s.starsGross, 140);
  assert.strictEqual(s.starsRefunded, 40);
  assert.strictEqual(s.starsNet, 100);
  assert.strictEqual(s.upiCredited, 500);
  assert.strictEqual(s.bonusGiven, 25);
  assert.strictEqual(stats.summary(1).starsGross, 140);
});

test('wallet refunds reduce net plan sales; renewals are counted separately', () => {
  walletsDb.addTransaction('1', 500, 'recharge', {});
  walletsDb.tryDebit('1', 50, 'plan_purchase', { planTitle: 'A', channelIds: ['ch_1'] });
  walletsDb.tryDebit('1', 45, 'plan_renew', { planTitle: 'A', channelIds: ['ch_1'] });
  walletsDb.addTransaction('1', 50, 'plan_purchase_refund', {});
  const s = stats.summary(0);
  assert.strictEqual(s.planSales, 95);
  assert.strictEqual(s.walletRefunds, 50);
  assert.strictEqual(s.planSalesNet, 45);
  assert.strictEqual(s.renewals, 1);
  assert.strictEqual(s.newPurchases, 1);
});

test('payments written by older versions (no status) still count as received', () => {
  paymentsDb.add('5', 70, 'legacy_charge');
  const raw = require('../src/db/atomicWrite');
  const file = require('path').join(process.env.BOT_DATA_DIR, 'payments.json');
  const data = raw.readJSON(file, { payments: [] });
  delete data.payments[0].status;
  raw.writeJSON(file, data);
  assert.strictEqual(stats.summary(0).starsGross, 70);
});
