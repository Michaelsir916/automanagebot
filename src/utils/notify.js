const admins = require('../db/admins');
const usersDb = require('../db/users');

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

// Send a message to a normal user. Never throws. If the user blocked the
// bot (403) we remember it so broadcasts can skip them next time.
async function sendToUser(telegram, userId, text, extra = {}) {
  try {
    await telegram.sendMessage(userId, text, { parse_mode: 'HTML', ...extra });
    return true;
  } catch (err) {
    const msg = String((err && (err.description || err.message)) || '');
    if (/blocked|deactivated|chat not found|user is deactivated/i.test(msg)) {
      try { usersDb.markBlocked(userId); } catch (e) { /* ignore */ }
    } else {
      console.error(`[notify] sendToUser ${userId} failed:`, msg.slice(0, 120));
    }
    return false;
  }
}

module.exports = { notifyAdmins, sendToUser };
