const { Markup } = require('telegraf');
const settingsDb = require('../db/settings');
const manualDb = require('../db/manualPayments');
const bansDb = require('../db/bans');
const adminsDb = require('../db/admins');
const auditDb = require('../db/audit');
const { setState, getState, clearState } = require('../state');
const { btn, btnSuccess, btnDanger, navRow } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, userTag, fmtDate } = require('../utils/format');
const { notifyAdmins, sendToUser } = require('../utils/notify');
const { creditRecharge } = require('../services/rewards');

// Manual UPI recharge for users who cannot buy Telegram Stars.
//
//   user: enters rupee amount -> sees UPI ID -> pays -> sends screenshot
//   bot : forwards the screenshot to admins with Approve / Reject
//   admin approves -> wallet credited (same path as Stars: bonus + referral)
//
// Safety: a screenshot (by Telegram's file_unique_id) can only be used once,
// and each request can be decided exactly once (status check before credit).

function starsFor(rupees) {
  const rate = Number(settingsDb.get('upiStarsPerRupee')) || 1;
  return Math.floor(rupees * rate);
}

function enabled() {
  const s = settingsDb.load();
  return !!(s.upiEnabled && s.upiId);
}

function decisionButtons(id) {
  return Markup.inlineKeyboard([[
    btnSuccess('✅ Approve', `upi_ok_${id}`),
    btnDanger('❌ Reject', `upi_no_${id}`)
  ]]);
}

function register(bot) {
  bot.action('wallet_upi', async ctx => {
    const userId = ctx.from.id;
    const back = Markup.inlineKeyboard([navRow('wallet_recharge', t(userId, 'back'), t(userId, 'home'))]);
    if (bansDb.isBanned(userId)) return ctx.reply(t(userId, 'banned'), back);
    if (!enabled()) return ctx.reply(t(userId, 'upi_disabled'), back);
    const s = settingsDb.load();
    setState(userId, 'awaiting_upi_amount');
    await ctx.reply(
      t(userId, 'upi_ask_amount', { min: s.upiMinRupees, rate: s.upiStarsPerRupee }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn(t(userId, 'cancel'), 'upi_cancel')]]) }
    );
  });

  bot.action('upi_cancel', async ctx => {
    const userId = ctx.from.id;
    clearState(userId);
    const pending = manualDb.getAwaitingProof(userId);
    if (pending) manualDb.update(pending.id, { status: 'cancelled' });
    await ctx.reply(t(userId, 'upi_cancelled'), Markup.inlineKeyboard([navRow('wallet_recharge', t(userId, 'back'), t(userId, 'home'))]));
  });

  // Amount typed in
  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'awaiting_upi_amount') return next();
    const userId = ctx.from.id;
    const s = settingsDb.load();
    const rupees = parseInt(ctx.message.text.trim(), 10);
    if (!Number.isInteger(rupees) || rupees < s.upiMinRupees || rupees > 100000) {
      return ctx.reply(t(userId, 'upi_invalid', { min: s.upiMinRupees }));
    }
    if (!enabled()) { clearState(userId); return ctx.reply(t(userId, 'upi_disabled')); }

    // Only one open request per user: cancel an older one that never got proof.
    const old = manualDb.getAwaitingProof(userId);
    if (old) manualDb.update(old.id, { status: 'cancelled' });

    const stars = starsFor(rupees);
    manualDb.create(userId, rupees, stars);
    setState(userId, 'awaiting_upi_proof');
    return ctx.reply(
      t(userId, 'upi_instructions', {
        rupees, stars, name: escapeHtml(s.upiName || '-'), upi: escapeHtml(s.upiId)
      }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn(t(userId, 'cancel'), 'upi_cancel')]]) }
    );
  });

  // Screenshot (photo, or an image sent as a file)
  bot.on(['photo', 'document'], async (ctx, next) => {
    const userId = ctx.from.id;
    const state = getState(userId);
    if (!state || state.step !== 'awaiting_upi_proof') return next();

    const msg = ctx.message;
    let fileId = null;
    let uniqueId = null;
    if (msg.photo && msg.photo.length) {
      const p = msg.photo[msg.photo.length - 1];
      fileId = p.file_id; uniqueId = p.file_unique_id;
    } else if (msg.document && /^image\//.test(msg.document.mime_type || '')) {
      fileId = msg.document.file_id; uniqueId = msg.document.file_unique_id;
    }
    if (!fileId) return ctx.reply(t(userId, 'upi_need_photo'));

    const req = manualDb.getAwaitingProof(userId);
    if (!req) { clearState(userId); return ctx.reply(t(userId, 'upi_cancelled')); }
    if (manualDb.proofAlreadyUsed(uniqueId)) return ctx.reply(t(userId, 'upi_dup_proof'));

    manualDb.update(req.id, { status: 'pending', fileId, fileUniqueId: uniqueId });
    clearState(userId);

    await ctx.reply(
      t(userId, 'upi_proof_received', { id: req.id }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([navRow('menu_wallet', t(userId, 'btn_wallet'), t(userId, 'home'))]) }
    );

    const caption =
      `🇮🇳 <b>UPI payment to verify</b>\n\n` +
      `User: ${userTag(ctx.from)} (id: <code>${userId}</code>)\n` +
      `Amount: <b>₹${req.rupees}</b> → <b>${req.stars} ⭐</b>\n` +
      `Ref: <code>${req.id}</code>\n` +
      `Time: ${fmtDate(new Date())}\n\n` +
      `⚠️ Check the amount, the UPI reference and the date in your bank/UPI app BEFORE approving.`;
    for (const adminId of adminsDb.allAdminIds()) {
      try {
        await ctx.telegram.sendPhoto(adminId, fileId, { caption, parse_mode: 'HTML', ...decisionButtons(req.id) });
      } catch (e) {
        // If it was sent as a document, sendPhoto fails - fall back to text + document
        try {
          await ctx.telegram.sendDocument(adminId, fileId, { caption, parse_mode: 'HTML', ...decisionButtons(req.id) });
        } catch (e2) {
          console.error('[upi] could not notify admin', adminId, e2.message);
        }
      }
    }
  });

  // ---------- Admin decisions ----------
  const stripButtons = async ctx => {
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) { /* already gone */ }
  };

  bot.action(/^upi_ok_(\S+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;
    const req = manualDb.get(ctx.match[1]);
    if (!req) return ctx.replyNew('Request not found.');
    if (req.status !== 'pending') {
      await stripButtons(ctx);
      return ctx.replyNew(`Already ${req.status}.`);
    }
    // Flip the status BEFORE crediting: a double tap (or two admins) can
    // never credit the same payment twice.
    manualDb.update(req.id, { status: 'approved', decidedAt: new Date().toISOString(), decidedBy: String(ctx.from.id) });
    await stripButtons(ctx);

    await creditRecharge(ctx.telegram, req.userId, req.stars, {
      type: 'upi_recharge', meta: { upiRef: req.id, rupees: req.rupees, approvedBy: String(ctx.from.id) }
    });
    await sendToUser(ctx.telegram, req.userId, t(req.userId, 'upi_approved', { stars: req.stars }));
    auditDb.add(ctx.from.id, 'upi_approve', `${req.id} user ${req.userId} ₹${req.rupees} → ${req.stars}⭐`);
    await ctx.replyNew(`✅ Approved ${req.id}: +${req.stars}⭐ to ${req.userId}.`);
  });

  bot.action(/^upi_no_(\S+)$/, async ctx => {
    if (!adminsDb.hasPermission(ctx.from.id, 'wallet_adjust')) return;
    const req = manualDb.get(ctx.match[1]);
    if (!req) return ctx.replyNew('Request not found.');
    if (req.status !== 'pending') {
      await stripButtons(ctx);
      return ctx.replyNew(`Already ${req.status}.`);
    }
    manualDb.update(req.id, { status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: String(ctx.from.id) });
    await stripButtons(ctx);
    await sendToUser(ctx.telegram, req.userId, t(req.userId, 'upi_rejected', { id: req.id }));
    auditDb.add(ctx.from.id, 'upi_reject', `${req.id} user ${req.userId}`);
    await ctx.replyNew(`❌ Rejected ${req.id}.`);
  });
}

module.exports = { register, starsFor, enabled };
