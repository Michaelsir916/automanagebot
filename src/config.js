require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const AUTO_KICK_UNPAID = (process.env.AUTO_KICK_UNPAID || 'true') === 'true';

// How often (in minutes) the background job checks for expired
// subscriptions and kicks members whose access has run out.
const SUBSCRIPTION_CHECK_INTERVAL_MINUTES = parseFloat(process.env.SUBSCRIPTION_CHECK_INTERVAL_MINUTES || '10');

// How often the auto-renew job checks for subscriptions due to renew soon,
// and how far ahead of the actual expiry it's allowed to attempt a charge.
// Keeping these equal means: "try once, on the last check before it expires".
const AUTO_RENEW_CHECK_INTERVAL_MINUTES = parseFloat(process.env.AUTO_RENEW_CHECK_INTERVAL_MINUTES || '10');

if (!BOT_TOKEN) {
  console.error('[config] BOT_TOKEN missing in .env');
  process.exit(1);
}
if (ADMIN_IDS.length === 0) {
  console.warn('[config] No ADMIN_IDS set - the admin panel will be inaccessible until you set one.');
}

module.exports = {
  BOT_TOKEN, ADMIN_IDS, AUTO_KICK_UNPAID,
  SUBSCRIPTION_CHECK_INTERVAL_MINUTES, AUTO_RENEW_CHECK_INTERVAL_MINUTES
};
