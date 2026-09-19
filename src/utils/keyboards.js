const { Markup } = require('telegraf');

// Buttons attached to admin alerts about a misused/unauthorized join.
// linkId is optional - only paid links we can identify get a refund button.
function misuseActionButtons(userId, linkId) {
  const rows = [[Markup.button.callback('💬 Message this user', `contact_${userId}`)]];
  if (linkId) {
    rows.push([Markup.button.callback('🔄 Refund Owner & Revoke Link', `refund_${linkId}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

module.exports = { misuseActionButtons };
