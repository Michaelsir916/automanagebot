const { Markup } = require('telegraf');

// Telegram added colored inline-button styles (Bot API, Feb 2026):
// 'primary' (blue), 'success' (green), 'danger' (red). Omit style for the
// normal/default look. Older Telegram apps that don't support this yet
// just show a plain button - nothing breaks.
//
// These helpers build a plain {text, callback_data, style} object rather
// than using Markup.button.callback(), since Telegraf's own helper doesn't
// know about `style` yet - it's still a valid button object either way.
function styledButton(text, callback_data, style) {
  const button = { text, callback_data };
  if (style) button.style = style;
  return button;
}

const btn = (text, data) => styledButton(text, data);                    // default/grey
const btnPrimary = (text, data) => styledButton(text, data, 'primary');  // blue - navigation / main actions
const btnSuccess = (text, data) => styledButton(text, data, 'success');  // green - buy / confirm / activate
const btnDanger = (text, data) => styledButton(text, data, 'danger');    // red - delete / revoke / kick / deactivate

// Buttons attached to admin alerts about a misused/unauthorized join.
// linkId is optional - only paid links we can identify get a refund button.
function misuseActionButtons(userId, linkId) {
  const rows = [[btnPrimary('💬 Message this user', `contact_${userId}`)]];
  if (linkId) {
    rows.push([btnDanger('🔄 Refund Owner & Revoke Link', `refund_${linkId}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

module.exports = { styledButton, btn, btnPrimary, btnSuccess, btnDanger, misuseActionButtons };
