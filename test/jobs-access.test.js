const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
h.setup();

const jobsDb = require('../src/db/jobs');
const subsDb = require('../src/db/subscriptions');
const channelsDb = require('../src/db/channels');
const removedDb = require('../src/db/removedMembers');
const linksDb = require('../src/db/links');
const access = require('../src/services/access');
const runner = require('../src/jobs/jobRunner');
const expiry = require('../src/jobs/subscriptionExpiry');

const CHAT = '-1001';
const USER = '55';

test.beforeEach(() => h.resetData());

function addChannel(id = 'ch_1', chatId = CHAT) {
  return channelsDb.add({ id, chatId, title: `Title ${id}`, price: 50, testPrice: 1, durationDays: 30, active: true });
}

// ---------- job queue ----------
test('enqueue deduplicates pending jobs by key', () => {
  const a = jobsDb.enqueue('remove_member', { x: 1 }, { dedupeKey: 'k1' });
  const b = jobsDb.enqueue('remove_member', { x: 1 }, { dedupeKey: 'k1' });
  assert.strictEqual(a.created, true);
  assert.strictEqual(b.created, false);
  assert.strictEqual(jobsDb.list().length, 1);
});

test('failed jobs back off with jitter, then die after the retry limit', () => {
  const { job } = jobsDb.enqueue('remove_member', {}, { maxAttempts: 3 });
  const t0 = new Date('2026-01-01T00:00:00Z');
  jobsDb.claimDue(t0);
  let j = jobsDb.fail(job.id, 'boom', { now: t0, rand: () => 0 });
  assert.strictEqual(j.status, 'pending');
  assert.strictEqual(new Date(j.runAt) - t0, 15000); // 30s * 0.5 (lowest jitter)
  assert.strictEqual(jobsDb.claimDue(new Date(t0.getTime() + 1000)).length, 0); // not due yet
  assert.strictEqual(jobsDb.claimDue(new Date(t0.getTime() + 20000)).length, 1);
  jobsDb.fail(job.id, 'boom', { now: t0, rand: () => 1 });
  j = jobsDb.fail(job.id, 'boom', { now: t0 });
  assert.strictEqual(j.status, 'dead');
  assert.ok(jobsDb.backoffMs(30, () => 1) <= 6 * 60 * 60 * 1000);
});

test('jobs stuck in running after a crash are picked up again', () => {
  const { job } = jobsDb.enqueue('remove_member', {});
  const t0 = new Date(Date.now() + 1000);
  assert.strictEqual(jobsDb.claimDue(t0).length, 1);
  assert.strictEqual(jobsDb.recoverStuck(new Date(t0.getTime() + 2 * 60 * 1000)), 0);
  assert.strictEqual(jobsDb.recoverStuck(new Date(t0.getTime() + 10 * 60 * 1000)), 1);
  assert.strictEqual(jobsDb.list('pending')[0].id, job.id);
});

test('two runners cannot claim the same job', () => {
  jobsDb.enqueue('remove_member', {});
  const a = jobsDb.claimDue();
  const b = jobsDb.claimDue();
  assert.strictEqual(a.length + b.length, 1);
});

// ---------- member removal ----------
const payload = (extra = {}) => ({ channelId: 'ch_1', chatId: CHAT, userId: USER, reason: 'subscription_expired', ...extra });

test('a member is kicked (ban then unban) and can rejoin later', async () => {
  const tg = h.fakeTelegram({ getChatMember: () => ({ status: 'member' }) });
  assert.strictEqual(await access.handleRemoveMember(tg, payload()), 'removed');
  const names = tg.calls.map(c => c.name).filter(n => n.endsWith('ChatMember'));
  assert.deepStrictEqual(names, ['getChatMember', 'banChatMember', 'unbanChatMember']);
  assert.deepStrictEqual(tg.calls.find(c => c.name === 'unbanChatMember').args[2], { only_if_banned: true });
});

test('removal checks real state first: not a member, left, admin are never touched', async () => {
  for (const [status, expected] of [['left', 'already_gone'], ['administrator', 'skipped_admin'], ['creator', 'skipped_admin']]) {
    const tg = h.fakeTelegram({ getChatMember: () => ({ status }) });
    assert.strictEqual(await access.handleRemoveMember(tg, payload()), expected);
    assert.ok(!tg.calls.some(c => c.name === 'banChatMember'));
  }
  const tg = h.fakeTelegram({ getChatMember: () => { throw h.apiError(400, 'Bad Request: user not found'); } });
  assert.strictEqual(await access.handleRemoveMember(tg, payload()), 'not_a_member');
});

test('a ban placed by an admin is not lifted; our own half-finished ban is', async () => {
  const tg = h.fakeTelegram({ getChatMember: () => ({ status: 'kicked' }) });
  assert.strictEqual(await access.handleRemoveMember(tg, payload()), 'already_banned');
  assert.ok(!tg.calls.some(c => c.name === 'unbanChatMember'));
  assert.strictEqual(await access.handleRemoveMember(tg, payload({ bannedByBot: true })), 'unbanned');
});

test('removal is skipped when the subscription was renewed meanwhile', async () => {
  addChannel();
  subsDb.start('ch_1', USER, CHAT, 'lnk', 30);
  const tg = h.fakeTelegram();
  assert.strictEqual(await access.handleRemoveMember(tg, payload()), 'skipped_renewed');
  assert.strictEqual(tg.calls.length, 0);
});

// ---------- expiry end to end ----------
test('expiry queues removal for every channel of a bundle; failures retry and eventually succeed', async () => {
  addChannel('ch_1', '-1001'); addChannel('ch_2', '-1002'); addChannel('ch_3', '-1003');
  const subs = subsDb.startGroup([
    { channelId: 'ch_1', chatId: '-1001', linkId: 'a' }, { channelId: 'ch_2', chatId: '-1002', linkId: 'b' }, { channelId: 'ch_3', chatId: '-1003', linkId: 'c' }
  ], USER, 30, 'plan_x', { purchaseTxnId: 'txn_1', pricePaid: 50 });
  assert.ok(subs.every(s => s.purchaseTxnId === 'txn_1'));

  const later = new Date(Date.now() + 31 * 86400000);
  const tg = h.fakeTelegram({
    getChatMember: () => { throw h.timeoutError(); } // Telegram is down
  });
  assert.strictEqual(await expiry.sweepExpiredSubscriptions(tg, later), 1);
  assert.ok(subsDb.listByGroup(subs[0].groupId).every(s => s.status === 'expired'));
  assert.ok(removedDb.isRemoved('ch_1', USER));
  assert.strictEqual(jobsDb.list('pending').length, 3);

  // Run 1: Telegram down -> all three fail but stay queued (nothing lost).
  let res = await runner.runOnce(tg, { now: later, pauseMs: 0 });
  assert.ok(res.every(r => r.outcome === 'pending'));
  assert.strictEqual(jobsDb.list('pending').length, 3);

  // Telegram recovers; after the backoff the jobs run and remove the member from all 3 channels.
  const ok = h.fakeTelegram({ getChatMember: () => ({ status: 'member' }) });
  const afterBackoff = new Date(later.getTime() + 2 * 60 * 1000);
  res = await runner.runOnce(ok, { now: afterBackoff, pauseMs: 0 });
  assert.ok(res.every(r => r.outcome === 'done' && r.result === 'removed'));
  assert.strictEqual(ok.calls.filter(c => c.name === 'banChatMember').length, 3);

  // Sweeping again does nothing and queues nothing new.
  assert.strictEqual(await expiry.sweepExpiredSubscriptions(ok, afterBackoff), 0);
  assert.strictEqual(jobsDb.list().filter(j => j.status !== 'done').length, 0);
});

test('concurrent expiry sweeps create each removal job only once', async () => {
  addChannel();
  subsDb.start('ch_1', USER, CHAT, 'lnk', 30);
  const later = new Date(Date.now() + 31 * 86400000);
  const tg = h.fakeTelegram();
  await Promise.all([expiry.sweepExpiredSubscriptions(tg, later), expiry.sweepExpiredSubscriptions(tg, later)]);
  assert.strictEqual(jobsDb.list().length, 1);
});

test('a job that keeps failing is parked as dead and admins are alerted once', async () => {
  const { job } = access.enqueueRemoval({ channelId: 'ch_1', chatId: CHAT, userId: USER, reason: 'admin_revoke', subId: 's1' });
  const tg = h.fakeTelegram({ getChatMember: () => { throw h.apiError(403, 'Forbidden: bot was kicked'); } });
  let now = new Date();
  for (let i = 0; i < 10; i++) {
    now = new Date(now.getTime() + 8 * 3600 * 1000);
    await runner.runOnce(tg, { now, pauseMs: 0 });
  }
  assert.strictEqual(jobsDb.list('dead').length, 1);
  await runner.alertDeadJobs(tg);
  await runner.alertDeadJobs(tg);
  assert.strictEqual(tg.calls.filter(c => c.name === 'sendMessage').length, 1); // one admin (ADMIN_IDS=1), one alert
  assert.strictEqual(jobsDb.requeueDead(job.id), 1);
});

// ---------- links ----------
test('links carry an expiry; expired pending links are revoked through the queue', async () => {
  const ch = addChannel();
  const tg = h.fakeTelegram();
  const { record } = await access.issueLink(tg, ch, USER, { type: 'plan', price: 10 });
  const create = tg.calls.find(c => c.name === 'createChatInviteLink');
  assert.strictEqual(create.args[1].creates_join_request, true);
  assert.ok(create.args[1].expire_date > Math.floor(Date.now() / 1000));
  assert.ok(record.expiresAt);

  assert.strictEqual(access.sweepExpiredLinks(new Date(Date.now() + 80 * 3600 * 1000)), 1);
  assert.strictEqual(linksDb.getById(record.id).status, 'expired');
  await runner.runOnce(tg, { pauseMs: 0 });
  assert.ok(tg.calls.some(c => c.name === 'revokeChatInviteLink'));
});

test('an already-revoked link counts as success when revoking', async () => {
  const tg = h.fakeTelegram({ revokeChatInviteLink: () => { throw h.apiError(400, 'Bad Request: INVITE_HASH_EXPIRED'); } });
  assert.strictEqual(await access.handleRevokeLink(tg, { chatId: CHAT, inviteLink: 'x' }), 'revoked');
});

test('bot permission check reports exactly what is missing', async () => {
  const tg = h.fakeTelegram({ getChatMember: () => ({ status: 'administrator', can_invite_users: true, can_restrict_members: false }) });
  const r = await access.checkBotPermissions(tg, CHAT);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ['Ban users']);
  const none = h.fakeTelegram({ getChatMember: () => ({ status: 'member' }) });
  assert.deepStrictEqual((await access.checkBotPermissions(none, CHAT)).missing, ['Bot is not an administrator']);
  const full = h.fakeTelegram({ getChatMember: () => ({ status: 'administrator', can_invite_users: true, can_restrict_members: true }) });
  assert.strictEqual((await access.checkBotPermissions(full, CHAT)).ok, true);
});
