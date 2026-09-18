const admins = require('../db/admins');

// DM every configured admin. Admins must have sent /start to the bot at
// least once, otherwise Telegram blocks the bot from messaging them first.
async function notifyAdmins(telegram, message, extra = {}) {
  const ids = admins.allAdminIds();
  for (const id of ids) {
    try {
      await telegram.sendMessage(id, message, { parse_mode: 'HTML', ...extra });
    } catch (err) {
      console.error(`[notify] Failed to DM admin ${id}:`, err.message);
    }
  }
}

module.exports = { notifyAdmins };
