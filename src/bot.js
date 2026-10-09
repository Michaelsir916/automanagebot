const { Telegraf } = require('telegraf');
const config = require('./config');
const settingsDb = require('./db/settings');
const adminsDb = require('./db/admins');
const { t } = require('./utils/i18n');
const { makeAgent, patchTelegramRetry, resilience, isTransient, errText, sleep } = require('./utils/resilience');

// Slow-network settings:
//  - keep-alive IPv4 agent (no slow IPv6 fallback)
//  - handlerTimeout 5 min (Telegraf's default 90 s kills slow-but-working handlers)
//  - every Telegram API call retries on timeouts / resets / flood-wait
const bot = new Telegraf(config.BOT_TOKEN, {
  handlerTimeout: 5 * 60 * 1000,
  telegram: { agent: makeAgent() }
});
patchTelegramRetry(bot.telegram);

// 1) Callback-query safety, edit-in-place replies, double-tap lock.
bot.use(resilience());

// 2) Maintenance mode (toggle in Admin -> Settings). Admins are never blocked.
//    Payments already in flight and join requests keep working.
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  let s;
  try { s = settingsDb.load(); } catch (e) { return next(); }
  if (!s.maintenance || adminsDb.isAdmin(ctx.from.id)) return next();
  if (ctx.message && ctx.message.successful_payment) return next();

  const custom = s.maintenanceMessage && s.maintenanceMessage !== settingsDb.DEFAULTS.maintenanceMessage;
  const msg = custom ? s.maintenanceMessage : t(ctx.from.id, 'maintenance');
  if (ctx.callbackQuery) {
    return ctx.telegram.answerCbQuery(ctx.callbackQuery.id, msg.slice(0, 190), { show_alert: true }).catch(() => {});
  }
  if (ctx.message && ctx.chat && ctx.chat.type === 'private') {
    return ctx.reply(msg).catch(() => {});
  }
  return next();
});

// Registration order matters: relay chat's catch-all text handler must run
// FIRST so an active admin<->user support conversation always takes
// priority over any wizard's text-input step.
require('./handlers/relayChat').register(bot);

require('./handlers/start').register(bot);
require('./handlers/account').register(bot);
require('./handlers/help').register(bot);
require('./handlers/channels').register(bot);
require('./handlers/subscribe').register(bot);
require('./handlers/wallet').register(bot);
require('./handlers/upi').register(bot);
require('./handlers/joinRequest').register(bot);
require('./handlers/memberGuard').register(bot);

require('./handlers/admin/panel').register(bot);
require('./handlers/admin/channelManage').register(bot);
require('./handlers/admin/planManage').register(bot);
require('./handlers/admin/manualLink').register(bot);
require('./handlers/admin/broadcast').register(bot);
require('./handlers/admin/walletAdmin').register(bot);
require('./handlers/admin/banList').register(bot);
require('./handlers/admin/removedMembers').register(bot);
require('./handlers/admin/paymentHistory').register(bot);
require('./handlers/admin/adminRoles').register(bot);
require('./handlers/admin/refundAction').register(bot);
require('./handlers/admin/users').register(bot);
require('./handlers/admin/tickets').register(bot);
require('./handlers/admin/revenue').register(bot);
require('./handlers/admin/audit').register(bot);
require('./handlers/admin/settings').register(bot);
require('./handlers/admin/coupons').register(bot);
require('./handlers/admin/upiPending').register(bot);

// Must be LAST: lets a user with an open support ticket keep typing.
require('./handlers/help').registerCatchAll(bot);

// Never leave the user staring at a dead button: tell them what happened.
bot.catch(async (err, ctx) => {
  console.error(`[bot] Error while handling ${ctx.updateType}:`, errText(err));
  try {
    if (ctx.from && (ctx.callbackQuery || (ctx.message && ctx.chat && ctx.chat.type === 'private'))) {
      const send = ctx.replyNew || ctx.reply.bind(ctx);
      await send(t(ctx.from.id, isTransient(err) ? 'err_slow' : 'err_generic'));
    }
  } catch (e) { /* nothing more we can do */ }
});

process.on('unhandledRejection', err => console.error('[process] unhandledRejection:', errText(err)));
process.on('uncaughtException', err => console.error('[process] uncaughtException:', errText(err)));

// Wait for Telegram to be reachable (slow / flaky link at boot) instead of
// crashing; a wrong token (401) still stops immediately with a clear message.
async function waitForTelegram() {
  for (let attempt = 1; ; attempt++) {
    try {
      const me = await bot.telegram.getMe();
      console.log(`✅ Connected as @${me.username}`);
      return;
    } catch (err) {
      const code = err && err.response && err.response.error_code;
      if (code === 401) {
        console.error('❌ BOT_TOKEN is invalid (401 Unauthorized). Check your .env file.');
        process.exit(1);
      }
      const wait = Math.min(30000, 2000 * attempt);
      console.warn(`[boot] Telegram not reachable (${errText(err).slice(0, 80)}). Retrying in ${wait / 1000}s…`);
      await sleep(wait);
    }
  }
}

(async () => {
  await waitForTelegram();

  // Jobs don't depend on how long launch() stays pending.
  require('./jobs/subscriptionExpiry').start(bot);
  require('./jobs/autoRenew').start(bot);
  require('./jobs/reminders').start(bot);

  bot.launch({
    allowedUpdates: ['message', 'callback_query', 'chat_join_request', 'chat_member', 'pre_checkout_query']
  }).catch(err => {
    console.error('[boot] launch failed:', errText(err));
    process.exit(1); // PM2 restarts it
  });
  console.log('✅ Bot started successfully.');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
