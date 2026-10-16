const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
h.setup();

test.beforeEach(() => h.resetData());

test('RBAC: roles grant exactly their permissions', () => {
  const admins = require('../src/db/admins');
  admins.addAdmin('10', 'readonly', admins.ROLE_PRESETS.readonly, '1');
  admins.addAdmin('11', 'support', admins.ROLE_PRESETS.support, '1');
  admins.addAdmin('12', 'moderator', admins.ROLE_PRESETS.moderator, '1');
  admins.addAdmin('13', 'superadmin', null, '1');

  assert.ok(admins.hasPermission('10', 'view_stats') && admins.hasPermission('10', 'view_payments'));
  for (const p of ['ban', 'refund', 'wallet_adjust', 'manage_channels', 'manage_plans', 'broadcast', 'support', 'generate_link']) {
    assert.strictEqual(admins.hasPermission('10', p), false, `readonly must not have ${p}`);
  }
  assert.ok(admins.hasPermission('11', 'support') && !admins.hasPermission('11', 'refund') && !admins.hasPermission('11', 'ban'));
  assert.ok(admins.hasPermission('12', 'support') && !admins.hasPermission('12', 'view_stats'));
  assert.ok(admins.isSuperAdmin('13') && admins.hasPermission('13', 'refund'));
  assert.ok(admins.isSuperAdmin('1')); // bootstrap admin from ADMIN_IDS
  assert.strictEqual(admins.hasPermission('999', 'view_stats'), false); // strangers get nothing
  assert.strictEqual(admins.roleOf('11'), 'support');
});

test('wizard state expires on its own', () => {
  const state = require('../src/state');
  state.setState(5, 'admin_add_channel_id');
  assert.strictEqual(state.getState(5).step, 'admin_add_channel_id');
  assert.strictEqual(state.getState(5, Date.now() + 16 * 60 * 1000), null);
  state.setState(6, 'x');
  assert.strictEqual(state.purgeExpiredStates(Date.now() + 16 * 60 * 1000), 1);
});

test('logs never contain bot tokens or invite links', () => {
  const { redact } = require('../src/utils/redact');
  const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.ok(!redact(`FetchError: https://api.telegram.org/bot${token}/getMe failed`).includes('AAAAAAAA'));
  assert.ok(!redact('link https://t.me/+AbCdEf123456 here').includes('AbCdEf123456'));
  assert.ok(!redact('joinchat https://t.me/joinchat/XyZ987').includes('XyZ987'));
  assert.strictEqual(redact('secret-value-123 leaked', ['secret-value-123']), '<redacted> leaked');
  assert.strictEqual(redact('nothing to hide'), 'nothing to hide');
});

test('membership events: classification, deduplication, coverage date and summary', () => {
  const ev = require('../src/db/membershipEvents');
  assert.strictEqual(ev.classify('left', 'member', 1, 2), 'joined');
  assert.strictEqual(ev.classify('member', 'left', 2, 2), 'left');
  assert.strictEqual(ev.classify('member', 'kicked', 1, 2), 'removed');
  assert.strictEqual(ev.classify('member', 'kicked', 2, 2), 'banned');
  assert.strictEqual(ev.trackingSince(), null);

  const base = { chatId: '-100', channelId: 'ch_1', userId: '5', kind: 'joined', updateId: 77, inviteLink: 'https://t.me/+secret' };
  assert.ok(ev.record(base));
  assert.strictEqual(ev.record(base), null); // same Telegram update twice
  ev.record({ ...base, kind: 'left', updateId: 78 });
  assert.ok(ev.trackingSince());
  const s = ev.summarize('-100', new Date(Date.now() - 86400000));
  assert.deepStrictEqual([s.joined, s.left], [1, 1]);
  assert.ok(!JSON.stringify(ev.list().items).includes('secret')); // invite link itself is never stored
});

test('update dedup records an update only after its handlers succeed', async () => {
  const { createUpdateDedup } = require('../src/utils/updateDedup');
  const file = path.join(process.env.BOT_DATA_DIR, 'dedup.json');
  const dedup = createUpdateDedup({ file, persistEveryMs: -1 });
  let handled = 0;
  const ctx = { update: { update_id: 1 } };

  await assert.rejects(dedup(ctx, async () => { throw new Error('crash mid-payment'); }));
  assert.strictEqual(dedup.has(1), false); // must be processed again when redelivered

  await dedup(ctx, async () => { handled += 1; });
  await dedup(ctx, async () => { handled += 1; });
  assert.strictEqual(handled, 1);

  // in-flight duplicate is skipped too
  let release;
  const slow = dedup({ update: { update_id: 2 } }, () => new Promise(r => { release = r; }));
  await dedup({ update: { update_id: 2 } }, async () => { handled += 100; });
  release(); await slow;
  assert.strictEqual(handled, 1);

  dedup.flush();
  const reloaded = createUpdateDedup({ file, persistEveryMs: -1 });
  assert.ok(reloaded.has(1) && reloaded.has(2)); // survives restarts
});

test('pagination clamps pages and builds navigation', () => {
  const { paginate, pagerButtons } = require('../src/utils/paginate');
  const list = Array.from({ length: 25 }, (_, i) => i);
  assert.deepStrictEqual(paginate(list, 0, 10).items, list.slice(0, 10));
  assert.strictEqual(paginate(list, 99, 10).page, 2);
  assert.strictEqual(paginate(list, -4, 10).page, 0);
  assert.strictEqual(paginate([], 0, 10).pages, 1);
  assert.strictEqual(pagerButtons('p_', 0, 1).length, 0);
  assert.strictEqual(pagerButtons('p_', 1, 3).length, 2);
});

test('Telegram flood control (retry_after) is honoured and never shortened; others get jitter', () => {
  const { backoffDelayMs } = require('../src/utils/resilience');
  const flood = { response: { error_code: 429, parameters: { retry_after: 7 } } };
  const w = backoffDelayMs(1, flood, 700, () => 0);
  assert.ok(w >= 7000 && w <= 8500, `got ${w}`); // retry_after plus the small safety margin
  const low = backoffDelayMs(3, new Error('x'), 700, () => 0);
  const high = backoffDelayMs(3, new Error('x'), 700, () => 1);
  assert.ok(low < high);
});

// ---- every handler loads, registers, and no button is swallowed by a broader pattern ----
test('handlers register and callback buttons route to the intended handler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot.js'), 'utf8');
  const modules = [...src.matchAll(/require\('(\.\/handlers\/[^']+)'\)\.register\(bot\)/g)].map(m => m[1]);
  assert.ok(modules.length > 15);

  const actions = [];
  const fakeBot = {
    action: (trigger, ...fns) => actions.push({ trigger, fns }),
    command: () => {}, on: () => {}, use: () => {}, start: () => {}, hears: () => {}, catch: () => {}
  };
  for (const m of modules) require(path.join('..', 'src', m)).register(fakeBot);

  const route = data => actions.find(a => (a.trigger instanceof RegExp ? a.trigger.test(data) : a.trigger === data));
  const expectRoute = (data, token) => {
    const hit = route(data);
    assert.ok(hit, `no handler for ${data}`);
    const t = hit.trigger instanceof RegExp ? hit.trigger.source : hit.trigger;
    assert.ok(t.includes(token), `${data} was routed to ${t}, expected something containing ${token}`);
  };

  expectRoute('admin_ch_ch_abc123', 'admin_ch_(ch_');
  expectRoute('admin_ch_price_ch_abc123', 'admin_ch_price_');
  expectRoute('admin_ch_testprice_ch_abc123', 'admin_ch_testprice_');
  expectRoute('admin_ch_duration_ch_abc123', 'admin_ch_duration_');
  expectRoute('admin_ch_toggle_ch_abc123', 'admin_ch_toggle_');
  expectRoute('admin_ch_delete_ch_abc123', 'admin_ch_delete_');
  expectRoute('admin_ch_delyes_ch_abc123', 'admin_ch_delyes_');
  expectRoute('admin_ch_check_ch_abc123', 'admin_ch_check_');
  expectRoute('refund_lnk_abc123', 'refund_(lnk_');
  expectRoute('refund_do_charge_abc123', 'refund_do_');
  expectRoute('refund_cancel', 'refund_cancel');
  expectRoute('revoke_do_12345', 'revoke_do_');
  expectRoute('admin_ubanyes_12345', 'admin_ubanyes_');
  expectRoute('admin_add_role_support', 'admin_add_role_');
  expectRoute('admin_remove_yes_12345', 'admin_remove_yes_');
  expectRoute('sub_links_subgrp_abc', 'sub_links_');
  expectRoute('admin_jobs', 'admin_jobs');
  expectRoute('admin_memberlog', 'admin_memberlog');
  expectRoute('admin_payments_p_2', 'admin_payments_p_');
});

test('restore-test script verifies a real backup and rejects a corrupt one', () => {
  const { execFileSync, spawnSync } = require('child_process');
  const zlib = require('zlib');
  const walletsDb = require('../src/db/wallets');
  const backup = require('../src/services/backup');
  walletsDb.addTransaction('1', 10, 'recharge', {});
  const dir = path.join(process.env.BOT_DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backup-test.json.gz'), backup.makeBuffer());

  const script = path.join(__dirname, '..', 'scripts', 'restore-test.js');
  const out = execFileSync('node', [script], { env: process.env }).toString();
  assert.match(out, /OK: \d+ file\(s\) restored/);
  assert.match(out, /wallets\.json/);

  const bad = path.join(dir, 'bad.json.gz');
  fs.writeFileSync(bad, zlib.gzipSync(Buffer.from(JSON.stringify({ app: 'automanagebot', files: { 'wallets.json': '{oops' } }))));
  const res = spawnSync('node', [script, bad], { env: process.env });
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr.toString(), /invalid JSON/);
});
