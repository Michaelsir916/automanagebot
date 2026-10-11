// All USER-facing text lives here (English). Keeping it in one file makes
// it easy to reword or translate later.
//
// Usage: t(userIdOrLang, 'key', { name: 'x' })  ->  string
// {placeholders} are replaced from the vars object. Values that go into
// HTML messages must already be escaped by the caller.

const S = {
  en: {
    back: '⬅️ Back',
    home: '🏠 Home',
    cancel: '❌ Cancel',
    confirm: '✅ Confirm',
    loading: '⏳ Loading…',
    processing: '⏳ Processing… please wait',
    err_generic: '⚠️ Something went wrong. Please try again in a moment.',
    err_slow: '⚠️ The network is slow. Please try again in a moment. Your ⭐ are safe.',
    banned: '🚫 You are banned from this service. Contact support if you think this is a mistake.',
    maintenance: '🛠 The bot is being updated. Please come back in a few minutes.',
    unavailable: 'This is not available right now.',

    welcome:
      '👋 Welcome, {name}!\n\n' +
      'Buy access to private channels using Telegram Stars ⭐\n\n' +
      '1️⃣ Browse Plans\n' +
      '2️⃣ Pay from your Wallet — you get your join link instantly\n' +
      '3️⃣ That link works for you only\n\n' +
      'Use the buttons below 👇',
    welcome_ref: '\n\n🎁 A friend invited you. They get a bonus when you make your first recharge.',
    menu_title: '🏠 <b>Main Menu</b>',
    menu_expiring: '⏳ {title}: <b>{left}</b> left',
    btn_plans: '🛒 Plans',
    btn_channels: '📢 Channels',
    btn_wallet: '💰 Wallet',
    btn_account: '👤 My Account',
    btn_help: '❓ Help / Support',
    btn_admin: '⚙️ Admin Panel',

    account_title:
      '👤 <b>My Account</b>\n\n' +
      '🆔 ID: <code>{id}</code>\n' +
      '💰 Balance: <b>{balance} ⭐</b>\n' +
      '📅 Joined: {joined}\n\n' +
      '{subs}',
    account_no_subs: '📭 No active subscriptions.',
    account_subs_head: '📜 <b>Active subscriptions</b>',
    account_sub_line: '• {title}\n   ⏳ {expires} ({left} left) · 🔁 {auto}',
    btn_referral: '🎁 Refer & Earn',
    btn_my_subs: '📜 My Subscriptions',
    on: 'ON ✅',
    off: 'OFF',

    wallet_title:
      '💰 <b>Your Wallet</b>\n\n' +
      'Balance: <b>{balance} ⭐</b>{extra}',
    wallet_recent: '\n\n🕒 Last activity: {line}',
    btn_recharge: '➕ Recharge',
    btn_history: '📜 History',
    btn_gift: '🎁 Gift',
    btn_upi: '🇮🇳 Recharge via UPI',
    recharge_title:
      '➕ <b>Recharge</b>\n\nPick an amount. Bigger packs give a bigger bonus 🎁\n\n' +
      'Balance: <b>{balance} ⭐</b>',
    btn_custom: '✏️ Custom amount',
    pkg_label: '{popular}{stars} ⭐{bonus}',
    pkg_bonus: ' +{pct}%',
    pkg_popular: '🔥 ',
    custom_prompt: 'Send the number of Stars ⭐ you want (e.g. 150):',
    invalid_amount: '❌ Invalid amount. Send a whole number.',
    invoice_title: 'Wallet Recharge',
    invoice_desc: 'Add {amount} Stars to your bot wallet',
    invoice_label: '{amount} Stars',
    invoice_failed: '⚠️ Could not create the invoice. Please try again shortly.',
    invoice_sent: '🧾 Tap "Pay" on the invoice below to finish.',
    receipt_recharge:
      '🧾 <b>Receipt</b>\n\n' +
      '✅ Recharge successful\n' +
      '🔖 ID: <code>{id}</code>\n' +
      '➕ Added: <b>{stars} ⭐</b>{bonus}\n' +
      '💰 New balance: <b>{balance} ⭐</b>\n' +
      '📅 {date}',
    receipt_bonus: '\n🎁 Bonus: <b>+{bonus} ⭐</b> ({pct}%)',
    referral_rewarded_notify: '🎉 {name}, whom you invited, made their first recharge! You earned <b>+{stars} ⭐</b>.',

    history_title: '📜 <b>Transactions</b> ({filter}) — page {page}/{pages}\n\n{lines}',
    history_empty: 'No transactions yet.',
    f_all: 'All',
    f_recharge: 'Recharge',
    f_spent: 'Spent',
    f_gift: 'Gift',
    btn_prev: '◀️ Prev',
    btn_next: 'Next ▶️',
    txn_recharge: 'Recharge',
    txn_bonus: 'Bonus',
    txn_plan_purchase: 'Plan purchase',
    txn_channel_unlock: 'Channel unlock',
    txn_plan_auto_renew: 'Auto-renew',
    txn_plan_renew: 'Renew',
    txn_gift_sent: 'Gift sent',
    txn_gift_received: 'Gift received',
    txn_refund: 'Refund',
    txn_plan_purchase_refund: 'Refund',
    txn_admin_adjust: 'Admin adjust',
    txn_referral_reward: 'Referral bonus',
    txn_upi_recharge: 'UPI recharge',

    gift_ask_user: 'Send the Telegram numeric ID of the person you want to gift:',
    gift_invalid_user: '❌ That is not a valid ID. Send numbers only.',
    gift_self: '❌ You cannot gift yourself.',
    gift_unknown_user: '❌ That ID has not used this bot. They need to /start it first.',
    gift_ask_amount: 'How many ⭐ do you want to gift?',
    gift_insufficient: '❌ Insufficient balance. You have {balance}⭐.',
    gift_confirm: '🎁 <b>Confirm gift</b>\n\nTo: <code>{to}</code>\nAmount: <b>{amount} ⭐</b>\nBalance after: {after} ⭐',
    gift_done: '🎁 You gifted {amount}⭐ to user {to}.',
    gift_received: '🎁 You received a gift of {amount}⭐! Check your wallet.',

    plans_title: '🎟 <b>Plans</b>\n\nPick a single-channel plan or save more with a bundle.',
    btn_single_plans: '🎟 Single Channel Plans',
    btn_bundles: '📦 Bundles',
    btn_trial: '🎁 Free/Trial Plans',
    no_single_plans: 'No single-channel plans right now.',
    no_bundles: 'No bundles right now.',
    no_channel_plans: 'No plans for this channel right now.',
    choose_channel: '📢 Choose a channel:',
    channel_plans_title: '📢 <b>{title}</b> — available plans:',
    bundles_title: '📦 Available bundles:',
    plan_card:
      '{icon} <b>{title}</b>{trial}\n\n' +
      '{desc}' +
      '📢 Includes: {channels}\n' +
      '⏱ Duration: <b>{duration}</b>\n\n' +
      '{priceBlock}\n' +
      '💰 Your balance: <b>{balance} ⭐</b>',
    price_plain: '💵 Price: <b>{price} ⭐</b>',
    price_discount:
      '💵 Price: <s>{base} ⭐</s>\n' +
      '{lines}' +
      '✅ You pay: <b>{final} ⭐</b>',
    disc_renew: '🔁 Renewal discount: −{off} ⭐\n',
    disc_coupon: '🎟 Coupon <code>{code}</code>: −{off} ⭐\n',
    trial_tag: ' 🎁 <i>Trial (once per person)</i>',
    btn_unlock: '🔓 Unlock ({price}⭐)',
    btn_renew_extend: '🔁 Renew ({price}⭐)',
    btn_coupon: '🎟 Have a coupon?',
    btn_remove_coupon: '🗑 Remove coupon',
    btn_recharge_now: '💰 Recharge Wallet',
    plan_unavailable: 'This plan is no longer available.',
    trial_used: '🎁 You have already used this trial.',
    insufficient: '❌ Insufficient balance.\n\nNeeded: <b>{price} ⭐</b> · You have: <b>{balance} ⭐</b>\nShort by: <b>{short} ⭐</b>',
    confirm_title:
      '🧾 <b>Confirm purchase</b>\n\n' +
      '{icon} {title}\n' +
      '⏱ {duration}\n' +
      '{lines}' +
      '💵 Amount: <b>{final} ⭐</b>\n' +
      '💰 Current balance: {balance} ⭐\n' +
      '➡️ After purchase: <b>{after} ⭐</b>\n\n' +
      '{note}',
    confirm_note_new: 'After confirming you get your join link(s) instantly.',
    confirm_note_extend: 'This extends your current subscription (no new link needed, remaining days are kept).',
    unlocked:
      '✅ <b>{title}</b> unlocked!\n\n{links}\n{expiry}\n' +
      '⚠️ These links work for <b>you only</b>. Open each, send the join request, and it is approved automatically.',
    expiry_line: '\n⏳ Access valid until <b>{date}</b>. You will be removed automatically after that unless you renew.\n',
    lifetime_line: '\n♾ Lifetime access — no expiry.\n',
    extended:
      '✅ <b>{title}</b> renewed!\n\n' +
      '⏳ New expiry: <b>{date}</b>\n' +
      'You are already in the channel, so no new link is needed.',
    receipt_purchase:
      '\n\n🧾 <b>Receipt</b>\n🔖 <code>{id}</code>\n💵 {amount} ⭐ · Balance: {balance} ⭐\n📅 {date}',
    purchase_failed: '⚠️ Could not generate your link. The amount was returned to your wallet — please try again.',
    no_channels_in_plan: '⚠️ The channels in this plan are unavailable. Contact support — you have not lost any ⭐.',
    btn_enable_auto: '🔁 Auto-Renew ON',
    btn_disable_auto: '🔁 Auto-Renew OFF',

    channels_title: '📢 Available Channels:',
    no_channels: 'No channels available right now. Please check back later.',
    channel_card:
      '📢 <b>{title}</b>\n\n{desc}' +
      '💵 Price: <b>{price} ⭐</b>\n{duration}' +
      '💰 Balance: <b>{balance} ⭐</b>\n\n' +
      'Unlocking gives you a personal join link that works only for you.',
    channel_duration: '⏱ Duration: <b>{days} day(s)</b>\n',
    channel_unavailable: 'This channel is no longer available.',
    btn_unlock_channel: '🔓 Unlock Access',
    channel_unlocked:
      '✅ Access unlocked for <b>{title}</b>!\n\n🔗 Your join link:\n{link}\n{expiry}\n' +
      '⚠️ This link works for <b>you only</b>. Open it, send the join request, and it is approved automatically.',
    channel_unlock_failed: '⚠️ Could not generate your link. You have not been charged. Please try again.',

    subs_none: '📭 No active subscriptions.',
    subs_title: '📜 <b>My Subscriptions</b>',
    sub_card: '📢 <b>{titles}</b>\n⏳ Expires: {expires}\n⌛ Left: <b>{left}</b>\n🔁 Auto-renew: {auto}',
    autorenew_on_msg: '🔁 Auto-renew is ON.\n\nJust before expiry the plan price is taken from your wallet automatically. Keep it funded!',
    autorenew_off_msg: '🔁 Auto-renew is OFF.',

    coupon_ask: '🎟 Send your coupon code:',
    coupon_applied: '✅ Coupon <code>{code}</code> applied!',
    coupon_removed: 'Coupon removed.',
    coupon_not_found: '❌ That code is not valid.',
    coupon_inactive: '❌ This coupon is not active.',
    coupon_expired: '❌ This coupon has expired.',
    coupon_used_up: '❌ This coupon has reached its usage limit.',
    coupon_not_yours: '❌ This coupon is not for you.',
    coupon_already_used: '❌ You have already used this coupon.',
    coupon_wrong_plan: '❌ This coupon does not apply to this plan.',

    remind_days:
      '⏰ <b>{title}</b> — your access ends in <b>{left}</b> ({date}).\n\nRenew now and you keep your remaining days.{discount}{warn}',
    remind_discount: '\n🔁 Renewal discount: <b>{pct}%</b>',
    remind_warn_balance: '\n\n⚠️ Auto-renew is ON but your balance ({balance}⭐) is below the price ({price}⭐). Please recharge.',
    btn_renew_now: '🔁 Renew now',
    expired_msg: '⌛ Your access to <b>{titles}</b> has expired and you were removed.\n\nTap below to renew and get fresh join link(s) instantly.',
    autorenew_failed:
      '⚠️ Auto-renew for <b>{title}</b> failed — balance ({balance}⭐) is below the price ({price}⭐).\n\n' +
      'Auto-renew was turned off. Recharge and tap 🔁 Renew.',
    autorenew_ok: '🔁 <b>{title}</b> auto-renewed ({price}⭐). Your access continues.\n⏳ New expiry: {date}',
    winback_3:
      '👋 We miss you!\n\n<b>{title}</b> ended a few days ago. Here is a special offer to come back:\n\n' +
      '🎟 Code: <code>{code}</code> — <b>{pct}% OFF</b>\n⏳ Valid until {date}, just for you.',
    winback_7: '⏳ Last reminder: your <b>{pct}% OFF</b> coupon <code>{code}</code> expires on {date}.',

    help_title: '❓ <b>Help</b>\n\nPick a common question, or talk to us directly.',
    faq_1_q: '💸 ⭐ deducted but no access',
    faq_1_a:
      '1) Check Plans → My Subscriptions for your plan.\n' +
      '2) If it is there, open the join link again and tap "Request to join".\n' +
      '3) If not, or the link fails, tap "Contact support" — we will fix it quickly.',
    faq_2_q: '🔗 My link expired / not working',
    faq_2_a:
      'Each link is personal and single-use. If you already joined, the link stops working. ' +
      'If it fails before you joined, tell Support.',
    faq_3_q: '🔁 How do I renew?',
    faq_3_a:
      'Plans → My Subscriptions → "Renew". You need balance in your wallet. ' +
      'Renewing before expiry keeps your remaining days and gives a discount. Turn on Auto-renew to do it automatically.',
    faq_4_q: '👥 Can someone else use my link?',
    faq_4_a: 'No. Only the buyer can. Anyone else is rejected automatically.',
    faq_5_q: '💰 How do I recharge Stars?',
    faq_5_a: 'Wallet → Recharge → pick an amount and pay with Telegram Stars. If UPI is enabled you can use that instead.',
    btn_contact_support: '💬 Contact support',
    support_ask: '🆘 Send your problem as a message here. We will reply right in this chat.',
    ticket_created: '✅ Ticket <b>#{no}</b> opened. Our team will reply shortly.',
    ticket_appended: '➕ Message added to ticket <b>#{no}</b>.',
    ticket_closed: '✅ Ticket <b>#{no}</b> was resolved and closed. Open a new ticket if the problem comes back.',
    support_reply_prefix: '👤 <b>Support:</b> ',

    ref_title:
      '🎁 <b>Refer & Earn</b>\n\n' +
      'Share your link. When a friend makes their first recharge you earn <b>{reward} ⭐</b>.\n\n' +
      '🔗 {link}\n' +
      '🏷 Code: <code>{code}</code>\n\n' +
      '👥 Invited: <b>{count}</b>\n' +
      '✅ Recharged: <b>{rewarded}</b>\n' +
      '💰 Total earned: <b>{earned} ⭐</b>',
    ref_disabled: 'The referral program is not available right now.',
    btn_leaderboard: '🏆 Leaderboard',
    ref_board_title: '🏆 <b>Referral Leaderboard</b>\n\n{lines}',
    ref_board_empty: 'Nobody yet. Be the first! 🚀',
    ref_board_line: '{medal} {name} — {n} people',

    upi_ask_amount: '🇮🇳 <b>UPI Recharge</b>\n\nHow many rupees will you send? (minimum ₹{min})\n₹1 = <b>{rate} ⭐</b>\n\nSend the amount as a number:',
    upi_invalid: '❌ Send a whole number of ₹{min} or more.',
    upi_instructions:
      '🇮🇳 <b>UPI Payment</b>\n\n' +
      '💵 Amount: <b>₹{rupees}</b>\n' +
      '⭐ You get: <b>{stars} ⭐</b>\n\n' +
      '👤 Name: {name}\n' +
      '🏦 UPI ID: <code>{upi}</code>\n\n' +
      '1️⃣ Send <b>exactly ₹{rupees}</b> to the UPI ID above\n' +
      '2️⃣ Send the payment <b>screenshot</b> in this chat\n' +
      '3️⃣ After an admin checks it, ⭐ are added to your wallet',
    upi_proof_received: '📨 Screenshot received (Ref <code>{id}</code>). We will notify you after verification.',
    upi_need_photo: '📸 Please send the payment screenshot as a photo.',
    upi_dup_proof: '❌ This screenshot was already used. Send a new one.',
    upi_approved: '✅ UPI payment approved! <b>+{stars} ⭐</b> added to your wallet.',
    upi_rejected: '❌ UPI payment (Ref <code>{id}</code>) was rejected. Contact support if this is a mistake.',
    upi_disabled: 'UPI recharge is not available right now.',
    upi_cancelled: 'UPI recharge cancelled.'
  }
};

// English only. The first argument (user id) is kept so existing calls
// like t(userId, 'key') keep working unchanged.
function langOf() {
  return 'en';
}

function t(userOrLang, key, vars = {}) {
  const lang = langOf(userOrLang);
  let str = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function hasKey(userOrLang, key) {
  const lang = langOf(userOrLang);
  return !!(S[lang] && S[lang][key]);
}

module.exports = { t, hasKey, langOf, S };
