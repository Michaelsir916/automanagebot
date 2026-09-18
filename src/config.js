require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const AUTO_KICK_UNPAID = (process.env.AUTO_KICK_UNPAID || 'true') === 'true';

if (!BOT_TOKEN) {
  console.error('[config] BOT_TOKEN missing in .env');
  process.exit(1);
}
if (ADMIN_IDS.length === 0) {
  console.warn('[config] No ADMIN_IDS set - the admin panel will be inaccessible until you set one.');
}

module.exports = { BOT_TOKEN, ADMIN_IDS, AUTO_KICK_UNPAID };
