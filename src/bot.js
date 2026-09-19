const { Telegraf } = require('telegraf');
const config = require('./config');

const bot = new Telegraf(config.BOT_TOKEN);

// Registration order matters: relay chat's catch-all text handler must run
// FIRST so an active admin<->user support conversation always takes
// priority over any wizard's text-input step.
require('./handlers/relayChat').register(bot);

require('./handlers/start').register(bot);
require('./handlers/channels').register(bot);
require('./handlers/subscribe').register(bot);
require('./handlers/wallet').register(bot);
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

bot.catch((err, ctx) => {
  console.error(`[bot] Error while handling ${ctx.updateType}:`, err);
});

bot.launch({
  allowedUpdates: ['message', 'callback_query', 'chat_join_request', 'chat_member', 'pre_checkout_query']
}).then(() => {
  console.log('✅ Bot started successfully.');
  require('./jobs/subscriptionExpiry').start(bot);
  require('./jobs/autoRenew').start(bot);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
