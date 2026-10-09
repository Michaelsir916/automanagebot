// All USER-facing text lives here in two languages: 'ml' (Malayalam, default)
// and 'en'. Admin screens stay English on purpose.
//
// Usage: t(userIdOrLang, 'key', { name: 'x' })  ->  string
// {placeholders} are replaced from the vars object. Values that go into
// HTML messages must already be escaped by the caller.

const usersDb = require('../db/users');

const S = {
  ml: {
    // ---- common ----
    back: '⬅️ തിരികെ',
    home: '🏠 ഹോം',
    cancel: '❌ റദ്ദാക്കുക',
    confirm: '✅ സ്ഥിരീകരിക്കുക',
    loading: '⏳ ലോഡ് ചെയ്യുന്നു…',
    processing: '⏳ പ്രോസസ് ചെയ്യുന്നു… ദയവായി കാത്തിരിക്കൂ',
    err_generic: '⚠️ എന്തോ കുഴപ്പം പറ്റി. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.',
    err_slow: '⚠️ നെറ്റ്‌വർക്ക് സ്ലോ ആണ്. ഒരു നിമിഷം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ. നിങ്ങളുടെ ⭐ നഷ്ടപ്പെട്ടിട്ടില്ല.',
    banned: '🚫 നിങ്ങളെ ഈ സേവനത്തിൽ നിന്ന് ബാൻ ചെയ്തിരിക്കുന്നു. തെറ്റാണെന്ന് തോന്നിയാൽ Support-നെ ബന്ധപ്പെടുക.',
    maintenance: '🛠 ബോട്ട് അപ്ഡേറ്റ് ചെയ്യുകയാണ്. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും വരൂ.',
    unavailable: 'ഇത് ഇപ്പോൾ ലഭ്യമല്ല.',

    // ---- start / menu ----
    welcome:
      '👋 സ്വാഗതം, {name}!\n\n' +
      'Telegram Stars ⭐ ഉപയോഗിച്ച് പ്രൈവറ്റ് ചാനലുകളിലേക്ക് ആക്സസ് വാങ്ങാം.\n\n' +
      '1️⃣ Plans നോക്കി തിരഞ്ഞെടുക്കൂ\n' +
      '2️⃣ Wallet-ൽ നിന്ന് പേയ്മെന്റ് ചെയ്യൂ — join link ഉടൻ കിട്ടും\n' +
      '3️⃣ ആ link നിങ്ങൾക്ക് മാത്രം ഉപയോഗിക്കാം\n\n' +
      'താഴെയുള്ള ബട്ടണുകൾ ഉപയോഗിക്കൂ 👇',
    welcome_ref: '\n\n🎁 നിങ്ങളെ ഒരു സുഹൃത്ത് ക്ഷണിച്ചതാണ്. ആദ്യത്തെ recharge ചെയ്യുമ്പോൾ അദ്ദേഹത്തിന് ബോണസ് കിട്ടും.',
    menu_title: '🏠 <b>മെയിൻ മെനു</b>',
    menu_expiring: '⏳ {title}: <b>{left}</b> ബാക്കി',
    btn_plans: '🛒 Plans',
    btn_channels: '📢 Channels',
    btn_wallet: '💰 Wallet',
    btn_account: '👤 My Account',
    btn_help: '❓ Help / Support',
    btn_admin: '⚙️ Admin Panel',
    btn_lang: '🌐 English',

    // ---- account ----
    account_title:
      '👤 <b>My Account</b>\n\n' +
      '🆔 ID: <code>{id}</code>\n' +
      '💰 Balance: <b>{balance} ⭐</b>\n' +
      '📅 ചേർന്നത്: {joined}\n\n' +
      '{subs}',
    account_no_subs: '📭 ആക്റ്റീവ് subscription ഒന്നുമില്ല.',
    account_subs_head: '📜 <b>ആക്റ്റീവ് subscriptions</b>',
    account_sub_line: '• {title}\n   ⏳ {expires} ({left} ബാക്കി) · 🔁 {auto}',
    btn_referral: '🎁 Refer & Earn',
    btn_my_subs: '📜 My Subscriptions',
    on: 'ON ✅',
    off: 'OFF',

    // ---- wallet ----
    wallet_title:
      '💰 <b>നിങ്ങളുടെ Wallet</b>\n\n' +
      'Balance: <b>{balance} ⭐</b>{extra}',
    wallet_recent: '\n\n🕒 അവസാന ഇടപാട്: {line}',
    btn_recharge: '➕ Recharge',
    btn_history: '📜 History',
    btn_gift: '🎁 Gift',
    btn_upi: '🇮🇳 UPI വഴി Recharge',
    recharge_title:
      '➕ <b>Recharge</b>\n\nതുക തിരഞ്ഞെടുക്കൂ. വലിയ പാക്കേജിൽ കൂടുതൽ ബോണസ് 🎁\n\n' +
      'Balance: <b>{balance} ⭐</b>',
    btn_custom: '✏️ വേറെ തുക',
    pkg_label: '{popular}{stars} ⭐{bonus}',
    pkg_bonus: ' +{pct}%',
    pkg_popular: '🔥 ',
    custom_prompt: 'ആവശ്യമുള്ള Stars ⭐ എണ്ണം അയക്കൂ (ഉദാ: 150):',
    invalid_amount: '❌ തെറ്റായ തുക. ഒരു പൂർണ്ണസംഖ്യ അയക്കൂ.',
    invoice_title: 'Wallet Recharge',
    invoice_desc: 'നിങ്ങളുടെ ബോട്ട് wallet-ലേക്ക് {amount} Stars ചേർക്കുക',
    invoice_label: '{amount} Stars',
    invoice_failed: '⚠️ Invoice ഉണ്ടാക്കാൻ പറ്റിയില്ല. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.',
    invoice_sent: '🧾 താഴെ വന്ന invoice-ൽ "Pay" അമർത്തി പേയ്മെന്റ് പൂർത്തിയാക്കൂ.',
    receipt_recharge:
      '🧾 <b>Receipt</b>\n\n' +
      '✅ Recharge വിജയകരം\n' +
      '🔖 ID: <code>{id}</code>\n' +
      '➕ ചേർത്തത്: <b>{stars} ⭐</b>{bonus}\n' +
      '💰 പുതിയ Balance: <b>{balance} ⭐</b>\n' +
      '📅 {date}',
    receipt_bonus: '\n🎁 ബോണസ്: <b>+{bonus} ⭐</b> ({pct}%)',
    referral_rewarded_notify: '🎉 നിങ്ങൾ ക്ഷണിച്ച {name} ആദ്യ recharge ചെയ്തു! നിങ്ങൾക്ക് <b>+{stars} ⭐</b> ബോണസ് കിട്ടി.',

    // ---- history ----
    history_title: '📜 <b>ഇടപാടുകൾ</b> ({filter}) — പേജ് {page}/{pages}\n\n{lines}',
    history_empty: 'ഇടപാടുകൾ ഒന്നുമില്ല.',
    f_all: 'എല്ലാം',
    f_recharge: 'Recharge',
    f_spent: 'ചെലവ്',
    f_gift: 'Gift',
    btn_prev: '◀️ മുമ്പത്തേത്',
    btn_next: 'അടുത്തത് ▶️',
    txn_recharge: 'Recharge',
    txn_bonus: 'ബോണസ്',
    txn_plan_purchase: 'Plan വാങ്ങൽ',
    txn_channel_unlock: 'Channel unlock',
    txn_plan_auto_renew: 'Auto-renew',
    txn_plan_renew: 'Renew',
    txn_gift_sent: 'Gift അയച്ചത്',
    txn_gift_received: 'Gift കിട്ടിയത്',
    txn_refund: 'Refund',
    txn_plan_purchase_refund: 'Refund',
    txn_admin_adjust: 'Admin adjust',
    txn_referral_reward: 'Referral ബോണസ്',
    txn_upi_recharge: 'UPI recharge',

    // ---- gift ----
    gift_ask_user: 'Gift ലഭിക്കേണ്ട ആളുടെ Telegram numeric ID അയക്കൂ:',
    gift_invalid_user: '❌ ഇത് ശരിയായ ID അല്ല. അക്കങ്ങൾ മാത്രം അയക്കൂ.',
    gift_self: '❌ സ്വന്തം അക്കൗണ്ടിലേക്ക് gift അയക്കാൻ പറ്റില്ല.',
    gift_unknown_user: '❌ ഈ ID ബോട്ട് ഉപയോഗിച്ചിട്ടില്ല. അവർ ആദ്യം ബോട്ടിൽ /start അമർത്തണം.',
    gift_ask_amount: 'എത്ര ⭐ gift ചെയ്യണം?',
    gift_insufficient: '❌ Balance മതിയാകില്ല. നിങ്ങളുടെ കയ്യിൽ {balance}⭐ ഉണ്ട്.',
    gift_confirm: '🎁 <b>Gift സ്ഥിരീകരിക്കൂ</b>\n\nആർക്ക്: <code>{to}</code>\nതുക: <b>{amount} ⭐</b>\nBalance after: {after} ⭐',
    gift_done: '🎁 {amount}⭐ gift അയച്ചു (user {to}).',
    gift_received: '🎁 നിങ്ങൾക്ക് {amount}⭐ gift കിട്ടി! Wallet balance നോക്കൂ.',

    // ---- plans ----
    plans_title: '🎟 <b>Plans</b>\n\nSingle channel plan അല്ലെങ്കിൽ പണം ലാഭിക്കുന്ന bundle തിരഞ്ഞെടുക്കൂ.',
    btn_single_plans: '🎟 Single Channel Plans',
    btn_bundles: '📦 Bundles',
    btn_trial: '🎁 Free/Trial Plans',
    no_single_plans: 'ഇപ്പോൾ single-channel plans ഒന്നുമില്ല.',
    no_bundles: 'ഇപ്പോൾ bundles ഒന്നുമില്ല.',
    no_channel_plans: 'ഈ channel-ന് ഇപ്പോൾ plans ഇല്ല.',
    choose_channel: '📢 Channel തിരഞ്ഞെടുക്കൂ:',
    channel_plans_title: '📢 <b>{title}</b> — ലഭ്യമായ plans:',
    bundles_title: '📦 ലഭ്യമായ bundles:',
    plan_card:
      '{icon} <b>{title}</b>{trial}\n\n' +
      '{desc}' +
      '📢 ഉൾപ്പെടുന്നത്: {channels}\n' +
      '⏱ കാലാവധി: <b>{duration}</b>\n\n' +
      '{priceBlock}\n' +
      '💰 നിങ്ങളുടെ Balance: <b>{balance} ⭐</b>',
    price_plain: '💵 വില: <b>{price} ⭐</b>',
    price_discount:
      '💵 വില: <s>{base} ⭐</s>\n' +
      '{lines}' +
      '✅ നിങ്ങൾ നൽകേണ്ടത്: <b>{final} ⭐</b>',
    disc_renew: '🔁 Renewal discount: −{off} ⭐\n',
    disc_coupon: '🎟 Coupon <code>{code}</code>: −{off} ⭐\n',
    trial_tag: ' 🎁 <i>Trial (ഒരാൾക്ക് ഒരു തവണ)</i>',
    btn_unlock: '🔓 Unlock ({price}⭐)',
    btn_renew_extend: '🔁 Renew ({price}⭐)',
    btn_coupon: '🎟 Coupon ഉണ്ടോ?',
    btn_remove_coupon: '🗑 Coupon ഒഴിവാക്കുക',
    btn_recharge_now: '💰 Wallet Recharge',
    plan_unavailable: 'ഈ plan ഇപ്പോൾ ലഭ്യമല്ല.',
    trial_used: '🎁 ഈ trial നിങ്ങൾ ഇതിനകം ഉപയോഗിച്ചു കഴിഞ്ഞു.',
    insufficient: '❌ Balance മതിയാകില്ല.\n\nആവശ്യം: <b>{price} ⭐</b> · നിങ്ങളുടെ കയ്യിൽ: <b>{balance} ⭐</b>\nകുറവ്: <b>{short} ⭐</b>',
    confirm_title:
      '🧾 <b>വാങ്ങൽ സ്ഥിരീകരിക്കൂ</b>\n\n' +
      '{icon} {title}\n' +
      '⏱ {duration}\n' +
      '{lines}' +
      '💵 തുക: <b>{final} ⭐</b>\n' +
      '💰 ഇപ്പോഴത്തെ Balance: {balance} ⭐\n' +
      '➡️ വാങ്ങിയ ശേഷം: <b>{after} ⭐</b>\n\n' +
      '{note}',
    confirm_note_new: 'സ്ഥിരീകരിച്ചാൽ join link(s) ഉടൻ കിട്ടും.',
    confirm_note_extend: 'ഇത് നിലവിലുള്ള subscription-ന്റെ കാലാവധി നീട്ടും (പുതിയ link വേണ്ട, ബാക്കി ദിവസങ്ങൾ നഷ്ടമാകില്ല).',
    unlocked:
      '✅ <b>{title}</b> അൺലോക്ക് ആയി!\n\n{links}\n{expiry}\n' +
      '⚠️ ഈ link(s) <b>നിങ്ങൾക്ക് മാത്രം</b>. ഓരോന്നും തുറന്ന് join request അയക്കൂ — ഉടൻ approve ആകും.',
    expiry_line: '\n⏳ <b>{date}</b> വരെ ആക്സസ്. അതിനു ശേഷം renew ചെയ്തില്ലെങ്കിൽ ഓട്ടോമാറ്റിക്കായി നീക്കം ചെയ്യും.\n',
    lifetime_line: '\n♾ Lifetime ആക്സസ് — expiry ഇല്ല.\n',
    extended:
      '✅ <b>{title}</b> renew ആയി!\n\n' +
      '⏳ പുതിയ കാലാവധി: <b>{date}</b>\n' +
      'നിങ്ങൾ ഇതിനകം channel-ൽ ഉള്ളതിനാൽ പുതിയ link ആവശ്യമില്ല.',
    receipt_purchase:
      '\n\n🧾 <b>Receipt</b>\n🔖 <code>{id}</code>\n💵 {amount} ⭐ · Balance: {balance} ⭐\n📅 {date}',
    purchase_failed: '⚠️ Link ഉണ്ടാക്കുന്നതിൽ പ്രശ്നം. തുക നിങ്ങളുടെ wallet-ലേക്ക് തിരികെ ചേർത്തിട്ടുണ്ട് — വീണ്ടും ശ്രമിക്കൂ.',
    no_channels_in_plan: '⚠️ ഈ plan-ലെ channels ഇപ്പോൾ ലഭ്യമല്ല. Support-നെ ബന്ധപ്പെടൂ — നിങ്ങൾക്ക് ⭐ നഷ്ടമായിട്ടില്ല.',
    btn_enable_auto: '🔁 Auto-Renew ON',
    btn_disable_auto: '🔁 Auto-Renew OFF',

    // ---- channels ----
    channels_title: '📢 ലഭ്യമായ Channels:',
    no_channels: 'ഇപ്പോൾ channels ഒന്നുമില്ല. പിന്നീട് വരൂ.',
    channel_card:
      '📢 <b>{title}</b>\n\n{desc}' +
      '💵 വില: <b>{price} ⭐</b>\n{duration}' +
      '💰 Balance: <b>{balance} ⭐</b>\n\n' +
      'Unlock ചെയ്താൽ നിങ്ങൾക്ക് മാത്രമുള്ള ഒരു join link കിട്ടും.',
    channel_duration: '⏱ കാലാവധി: <b>{days} ദിവസം</b>\n',
    channel_unavailable: 'ഈ channel ഇപ്പോൾ ലഭ്യമല്ല.',
    btn_unlock_channel: '🔓 Unlock Access',
    channel_unlocked:
      '✅ <b>{title}</b> അൺലോക്ക് ആയി!\n\n🔗 നിങ്ങളുടെ join link:\n{link}\n{expiry}\n' +
      '⚠️ ഈ link <b>നിങ്ങൾക്ക് മാത്രം</b>. തുറന്ന് join request അയക്കൂ — ഉടൻ approve ആകും.',
    channel_unlock_failed: '⚠️ Link ഉണ്ടാക്കുന്നതിൽ പ്രശ്നം. നിങ്ങളിൽ നിന്ന് തുക എടുത്തിട്ടില്ല. വീണ്ടും ശ്രമിക്കൂ.',

    // ---- subscriptions ----
    subs_none: '📭 ആക്റ്റീവ് subscription ഒന്നുമില്ല.',
    subs_title: '📜 <b>My Subscriptions</b>',
    sub_card: '📢 <b>{titles}</b>\n⏳ കാലാവധി: {expires}\n⌛ ബാക്കി: <b>{left}</b>\n🔁 Auto-renew: {auto}',
    autorenew_on_msg: '🔁 Auto-renew ON.\n\nExpiry-ക്ക് തൊട്ടുമുമ്പ് നിങ്ങളുടെ wallet-ൽ നിന്ന് ഈ plan-ന്റെ വില ഓട്ടോമാറ്റിക്കായി എടുക്കും. Balance മതിയായി സൂക്ഷിക്കൂ!',
    autorenew_off_msg: '🔁 Auto-renew OFF.',

    // ---- coupons ----
    coupon_ask: '🎟 നിങ്ങളുടെ coupon code അയക്കൂ:',
    coupon_applied: '✅ Coupon <code>{code}</code> ചേർത്തു!',
    coupon_removed: 'Coupon ഒഴിവാക്കി.',
    coupon_not_found: '❌ ഈ code ശരിയല്ല.',
    coupon_inactive: '❌ ഈ coupon ഇപ്പോൾ ആക്റ്റീവ് അല്ല.',
    coupon_expired: '❌ ഈ coupon-ന്റെ കാലാവധി കഴിഞ്ഞു.',
    coupon_used_up: '❌ ഈ coupon പരമാവധി ഉപയോഗിച്ചു കഴിഞ്ഞു.',
    coupon_not_yours: '❌ ഈ coupon നിങ്ങൾക്കുള്ളതല്ല.',
    coupon_already_used: '❌ ഈ coupon നിങ്ങൾ ഇതിനകം ഉപയോഗിച്ചു.',
    coupon_wrong_plan: '❌ ഈ coupon ഈ plan-ന് ബാധകമല്ല.',

    // ---- reminders / expiry / winback ----
    remind_days:
      '⏰ <b>{title}</b> — ആക്സസ് <b>{left}</b> കഴിഞ്ഞാൽ തീരും ({date}).\n\nഇപ്പോൾ renew ചെയ്താൽ ബാക്കി ദിവസങ്ങൾ നഷ്ടമാകില്ല.{discount}{warn}',
    remind_discount: '\n🔁 Renewal discount: <b>{pct}%</b>',
    remind_warn_balance: '\n\n⚠️ Auto-renew ON ആണ്, പക്ഷേ Balance ({balance}⭐) വിലയേക്കാൾ ({price}⭐) കുറവാണ്. Recharge ചെയ്യൂ.',
    btn_renew_now: '🔁 ഇപ്പോൾ Renew',
    expired_msg: '⌛ <b>{titles}</b> ആക്സസ് കഴിഞ്ഞു, നിങ്ങളെ നീക്കം ചെയ്തു.\n\nതാഴെ അമർത്തി renew ചെയ്താൽ പുതിയ join link ഉടൻ കിട്ടും.',
    autorenew_failed:
      '⚠️ <b>{title}</b> auto-renew പരാജയപ്പെട്ടു — Balance ({balance}⭐) വിലയേക്കാൾ ({price}⭐) കുറവ്.\n\n' +
      'Auto-renew ഓഫ് ആക്കി. Recharge ചെയ്ത് 🔁 Renew അമർത്തൂ.',
    autorenew_ok: '🔁 <b>{title}</b> auto-renew ആയി ({price}⭐). ആക്സസ് തുടരുന്നു.\n⏳ പുതിയ കാലാവധി: {date}',
    winback_3:
      '👋 നിങ്ങളെ ഞങ്ങൾക്ക് മിസ്സ് ചെയ്യുന്നു!\n\n<b>{title}</b> കഴിഞ്ഞിട്ട് കുറച്ച് ദിവസമായി. തിരികെ വരാൻ ഒരു സ്പെഷ്യൽ ഓഫർ:\n\n' +
      '🎟 Code: <code>{code}</code> — <b>{pct}% OFF</b>\n⏳ {date} വരെ, നിങ്ങൾക്ക് മാത്രം.',
    winback_7: '⏳ അവസാന ഓർമ്മപ്പെടുത്തൽ: നിങ്ങളുടെ <b>{pct}% OFF</b> coupon <code>{code}</code> {date}-ന് തീരും.',

    // ---- help / faq / support ----
    help_title: '❓ <b>Help</b>\n\nസാധാരണ ചോദ്യങ്ങൾ തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ ഞങ്ങളോട് നേരിട്ട് സംസാരിക്കൂ.',
    faq_1_q: '💸 ⭐ പോയി, പക്ഷേ ആക്സസ് കിട്ടിയില്ല',
    faq_1_a:
      '1) Plans → My Subscriptions-ൽ നിങ്ങളുടെ plan ഉണ്ടോ എന്ന് നോക്കൂ.\n' +
      '2) ഉണ്ടെങ്കിൽ join link വീണ്ടും തുറന്ന് "Request to join" അമർത്തൂ.\n' +
      '3) ഇല്ലെങ്കിൽ / link പ്രവർത്തിക്കുന്നില്ലെങ്കിൽ "Support-നെ ബന്ധപ്പെടുക" അമർത്തൂ — ഉടൻ പരിഹരിക്കാം.',
    faq_2_q: '🔗 എന്റെ link expire ആയി / പ്രവർത്തിക്കുന്നില്ല',
    faq_2_a:
      'ഓരോ link-ഉം നിങ്ങൾക്ക് മാത്രമുള്ളതും ഒരു തവണ മാത്രം ഉപയോഗിക്കാവുന്നതുമാണ്. ഇതിനകം join ചെയ്തെങ്കിൽ link പിന്നെ പ്രവർത്തിക്കില്ല. ' +
      'Join ചെയ്യാതെ link പ്രവർത്തിക്കുന്നില്ലെങ്കിൽ Support-ൽ അറിയിക്കൂ.',
    faq_3_q: '🔁 എങ്ങനെ renew ചെയ്യാം?',
    faq_3_a:
      'Plans → My Subscriptions-ൽ "Renew" അമർത്തൂ. Wallet-ൽ balance വേണം. ' +
      'Expiry-ക്ക് മുമ്പ് renew ചെയ്താൽ ബാക്കി ദിവസങ്ങൾ നഷ്ടമാകില്ല, discount-ഉം കിട്ടും. Auto-renew ON ആക്കിയാൽ ഇതെല്ലാം ഓട്ടോമാറ്റിക്.',
    faq_4_q: '👥 വേറെ ആൾക്ക് എന്റെ link ഉപയോഗിക്കാമോ?',
    faq_4_a: 'ഇല്ല. Link വാങ്ങിയ ആൾക്ക് മാത്രം. മറ്റുള്ളവർ ശ്രമിച്ചാൽ ഓട്ടോമാറ്റിക്കായി reject ചെയ്യും.',
    faq_5_q: '💰 Stars എങ്ങനെ recharge ചെയ്യാം?',
    faq_5_a: 'Wallet → Recharge → തുക തിരഞ്ഞെടുത്ത് Telegram Stars വഴി pay ചെയ്യൂ. Stars ഇല്ലെങ്കിൽ UPI ഓപ്ഷൻ ഉണ്ടെങ്കിൽ അത് ഉപയോഗിക്കാം.',
    btn_contact_support: '💬 Support-നെ ബന്ധപ്പെടുക',
    support_ask: '🆘 നിങ്ങളുടെ പ്രശ്നം ഒരു സന്ദേശമായി ഇവിടെ അയക്കൂ. ഞങ്ങൾ ഇതിൽ തന്നെ മറുപടി തരും.',
    ticket_created: '✅ Ticket <b>#{no}</b> തുറന്നു. ഞങ്ങളുടെ ടീം ഉടൻ മറുപടി തരും.',
    ticket_appended: '➕ Ticket <b>#{no}</b>-ലേക്ക് സന്ദേശം ചേർത്തു.',
    ticket_closed: '✅ Ticket <b>#{no}</b> പരിഹരിച്ചു അടച്ചു. വീണ്ടും പ്രശ്നമുണ്ടെങ്കിൽ പുതിയ ticket തുറക്കൂ.',
    support_reply_prefix: '👤 <b>Support:</b> ',

    // ---- referral ----
    ref_title:
      '🎁 <b>Refer & Earn</b>\n\n' +
      'നിങ്ങളുടെ ലിങ്ക് സുഹൃത്തുക്കൾക്ക് അയക്കൂ. അവർ ആദ്യ recharge ചെയ്യുമ്പോൾ നിങ്ങൾക്ക് <b>{reward} ⭐</b> കിട്ടും.\n\n' +
      '🔗 {link}\n' +
      '🏷 Code: <code>{code}</code>\n\n' +
      '👥 ക്ഷണിച്ചവർ: <b>{count}</b>\n' +
      '✅ Recharge ചെയ്തവർ: <b>{rewarded}</b>\n' +
      '💰 ആകെ നേടിയത്: <b>{earned} ⭐</b>',
    ref_disabled: 'Referral പ്രോഗ്രാം ഇപ്പോൾ ലഭ്യമല്ല.',
    btn_leaderboard: '🏆 Leaderboard',
    ref_board_title: '🏆 <b>Referral Leaderboard</b>\n\n{lines}',
    ref_board_empty: 'ഇതുവരെ ആരും ഇല്ല. ആദ്യമാകൂ! 🚀',
    ref_board_line: '{medal} {name} — {n} ആൾക്കാർ',

    // ---- UPI ----
    upi_ask_amount: '🇮🇳 <b>UPI Recharge</b>\n\nഎത്ര രൂപ അയക്കും? (കുറഞ്ഞത് ₹{min})\n1 ₹ = <b>{rate} ⭐</b>\n\nതുക അക്കത്തിൽ അയക്കൂ:',
    upi_invalid: '❌ ₹{min} അല്ലെങ്കിൽ അതിൽ കൂടുതൽ ഒരു പൂർണ്ണസംഖ്യ അയക്കൂ.',
    upi_instructions:
      '🇮🇳 <b>UPI Payment</b>\n\n' +
      '💵 തുക: <b>₹{rupees}</b>\n' +
      '⭐ ലഭിക്കുന്നത്: <b>{stars} ⭐</b>\n\n' +
      '👤 പേര്: {name}\n' +
      '🏦 UPI ID: <code>{upi}</code>\n\n' +
      '1️⃣ മുകളിലെ UPI ID-ലേക്ക് <b>കൃത്യം ₹{rupees}</b> അയക്കൂ\n' +
      '2️⃣ പേയ്മെന്റ് <b>screenshot</b> ഈ ചാറ്റിൽ അയക്കൂ\n' +
      '3️⃣ Admin പരിശോധിച്ച ശേഷം ⭐ wallet-ൽ ചേരും',
    upi_proof_received: '📨 Screenshot കിട്ടി (Ref <code>{id}</code>). Admin പരിശോധിച്ച ശേഷം അറിയിക്കാം.',
    upi_need_photo: '📸 ദയവായി payment screenshot ഒരു ഫോട്ടോ ആയി അയക്കൂ.',
    upi_dup_proof: '❌ ഈ screenshot മുമ്പ് ഉപയോഗിച്ചതാണ്. പുതിയത് അയക്കൂ.',
    upi_approved: '✅ UPI payment അംഗീകരിച്ചു! <b>+{stars} ⭐</b> wallet-ൽ ചേർത്തു.',
    upi_rejected: '❌ UPI payment (Ref <code>{id}</code>) നിരസിച്ചു. തെറ്റാണെന്ന് തോന്നിയാൽ Support-നെ ബന്ധപ്പെടൂ.',
    upi_disabled: 'UPI recharge ഇപ്പോൾ ലഭ്യമല്ല.',
    upi_cancelled: 'UPI recharge റദ്ദാക്കി.',

    // ---- language ----
    lang_set: '✅ ഭാഷ മലയാളത്തിലേക്ക് മാറ്റി.'
  },

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
    btn_lang: '🌐 മലയാളം',

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
    upi_cancelled: 'UPI recharge cancelled.',

    lang_set: '✅ Language changed to English.'
  }
};

function langOf(userOrLang) {
  if (userOrLang === 'ml' || userOrLang === 'en') return userOrLang;
  return usersDb.getLang(userOrLang);
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
