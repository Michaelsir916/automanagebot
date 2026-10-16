const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
h.setup();

const channelsDb = require('../src/db/channels');
const plansDb = require('../src/db/plans');
const subsDb = require('../src/db/subscriptions');
const linksDb = require('../src/db/links');
const jobsDb = require('../src/db/jobs');
const removedDb = require('../src/db/removedMembers');
const walletsDb = require('../src/db/wallets');
const { fulfillPlanPurchase } = require('../src/handlers/subscribe');
const { creditBackToWallet } = require('../src/services/refunds');

const USER = '77';
const plan = { id: 'plan_1', title: '3 in 1', channelIds: ['ch_1', 'ch_2', 'ch_3'], durationDays: 30, price: 50 };

test.beforeEach(() => {
  h.resetData();
  for (const n of [1, 2, 3]) channelsDb.add({ id: `ch_${n}`, chatId: `-100${n}`, title: `C${n}`, price: 10, testPrice: 1, durationDays: 30, active: true });
});

test('one payment grants exactly one entitlement per configured channel, all linked to that payment', async () => {
  const tg = h.fakeTelegram();
  const { entries, subs } = await fulfillPlanPurchase(tg, plan, USER, 50, 'txn_purchase_1');
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(subs.length, 3);
  assert.strictEqual(new Set(subs.map(s => s.groupId)).size, 1);
  assert.ok(subs.every(s => s.purchaseTxnId === 'txn_purchase_1' && s.pricePaid === 50));
  assert.deepStrictEqual(subs.map(s => s.channelId).sort(), ['ch_1', 'ch_2', 'ch_3']);
  // the bundle price is split over the links, so per-link refunds can never exceed the price
  const linkTotal = linksDb.listAll().reduce((sum, l) => sum + l.price, 0);
  assert.ok(Math.abs(linkTotal - 50) < 0.05);
  assert.ok(linksDb.listAll().every(l => l.status === 'pending' && l.ownerUserId === USER && l.expiresAt));
});

test('partial failure across a multi-channel plan creates nothing and revokes the links already made', async () => {
  let n = 0;
  const tg = h.fakeTelegram({
    createChatInviteLink: () => {
      n += 1;
      if (n === 3) throw h.apiError(400, 'Bad Request: not enough rights to manage chat invite link');
      return { invite_link: `https://t.me/+link${n}` };
    }
  });
  removedDb.add('ch_1', USER, 'subscription_expired');
  await assert.rejects(fulfillPlanPurchase(tg, plan, USER, 50, 'txn_2'), /not enough rights/);
  assert.strictEqual(subsDb.listAll().length, 0);
  assert.ok(linksDb.listAll().every(l => l.status === 'revoked'));
  assert.strictEqual(jobsDb.list('pending').filter(j => j.type === 'revoke_link').length, 2);
  assert.ok(removedDb.isRemoved('ch_1', USER)); // the old block is only cleared after full success
});

test('repeating the refund for a failed purchase pays the user back exactly once', async () => {
  walletsDb.addTransaction(USER, 50, 'recharge', {});
  const debited = walletsDb.tryDebit(USER, 50, 'plan_purchase', { planId: plan.id });
  const txn = debited.transactions[debited.transactions.length - 1];
  const args = { key: `purchase:${txn.id}`, userId: USER, amount: 50, type: 'plan_purchase_refund', reason: 'fulfillment failed' };
  creditBackToWallet(args); creditBackToWallet(args); creditBackToWallet(args);
  assert.strictEqual(walletsDb.getBalance(USER), 50);
});

test('a database error while storing a link revokes the freshly created invite', async () => {
  const fs = require('fs');
  const path = require('path');
  const tg = h.fakeTelegram();
  const ch = channelsDb.getById('ch_1');
  // Make links.json unwritable by replacing it with a directory.
  fs.mkdirSync(path.join(process.env.BOT_DATA_DIR, 'links.json'), { recursive: true });
  await assert.rejects(require('../src/services/access').issueLink(tg, ch, USER, { type: 'plan' }));
  assert.strictEqual(jobsDb.list('pending').filter(j => j.type === 'revoke_link').length, 1);
  fs.rmSync(path.join(process.env.BOT_DATA_DIR, 'links.json'), { recursive: true, force: true });
});
