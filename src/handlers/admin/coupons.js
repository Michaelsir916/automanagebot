const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const couponsDb = require('../../db/coupons');
const auditDb = require('../../db/audit');
const { setState, getState, clearState } = require('../../state');
const { btn, btnPrimary, btnSuccess, btnDanger } = require('../../utils/keyboards');
const { escapeHtml, fmtDay } = require('../../utils/format');

const CODE_RE = /^[A-Z0-9_-]{3,24}$/;

function describe(c) {
  const off = c.type === 'percent' ? `${c.value}%` : `${c.value}⭐`;
  const state = !c.active ? '⏸ paused'
    : (c.expiresAt && new Date(c.expiresAt) <= new Date()) ? '⌛ expired'
    : (c.maxUses > 0 && c.used >= c.maxUses) ? '🈵 used up' : '🟢 active';
  return { off, state };
}

function register(bot) {
  const guard = ctx => adminsDb.hasPermission(ctx.from.id, 'manage_plans');
  const back = Markup.inlineKeyboard([[btn('⬅️ Coupons', 'admin_coupons')]]);

  bot.action('admin_coupons', async ctx => {
    if (!guard(ctx)) return;
    clearState(ctx.from.id);
    const all = couponsDb.list().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const manual = all.filter(c => c.source !== 'winback');
    const winback = all.filter(c => c.source === 'winback');
    const rows = [[btnSuccess('➕ New Coupon', 'cp_new')]];
    manual.slice(0, 10).forEach(c => {
      const { off, state } = describe(c);
      rows.push([btnPrimary(`${c.code} · ${off} · ${state}`, `admin_cp_${c.code}`)]);
    });
    rows.push([btn('⬅️ Back', 'admin_back')]);
    await ctx.reply(
      `🎟 <b>Coupons</b>\n\nManual: ${manual.length} · Auto win-back: ${winback.length} ` +
      `(${winback.filter(c => c.used > 0).length} redeemed)` +
      (manual.length > 10 ? `\nShowing the newest 10.` : ''),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  });

  bot.action(/^admin_cp_([A-Z0-9_-]+)$/, async ctx => {
    if (!guard(ctx)) return;
    const c = couponsDb.get(ctx.match[1]);
    if (!c) return ctx.reply('Coupon not found.', back);
    const { off, state } = describe(c);
    await ctx.reply(
      `🎟 <b>${escapeHtml(c.code)}</b> — ${off} off\nStatus: ${state}\n` +
      `Used: ${c.used}${c.maxUses ? `/${c.maxUses}` : ' (unlimited)'}\n` +
      `Expires: ${c.expiresAt ? fmtDay(c.expiresAt) : 'never'}\n` +
      `One user only: ${c.userId || 'no'}\nCreated: ${fmtDay(c.createdAt)}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [(c.active ? btn : btnSuccess)(c.active ? '⏸ Pause' : '▶️ Resume', `cp_tog_${c.code}`), btnDanger('🗑 Delete', `cp_del_${c.code}`)],
          [btn('⬅️ Coupons', 'admin_coupons')]
        ])
      }
    );
  });

  bot.action(/^cp_tog_([A-Z0-9_-]+)$/, async ctx => {
    if (!guard(ctx)) return;
    const c = couponsDb.get(ctx.match[1]);
    if (!c) return ctx.reply('Coupon not found.', back);
    couponsDb.setActive(c.code, !c.active);
    auditDb.add(ctx.from.id, 'coupon', `${c.code} ${c.active ? 'paused' : 'resumed'}`);
    await ctx.reply(`${c.active ? '⏸ Paused' : '▶️ Resumed'} ${c.code}.`, back);
  });

  bot.action(/^cp_del_([A-Z0-9_-]+)$/, async ctx => {
    if (!guard(ctx)) return;
    couponsDb.remove(ctx.match[1]);
    auditDb.add(ctx.from.id, 'coupon', `${ctx.match[1]} deleted`);
    await ctx.reply(`🗑 Deleted ${ctx.match[1]}.`, back);
  });

  // ---- create wizard: type -> value -> max uses -> valid days -> code ----
  bot.action('cp_new', async ctx => {
    if (!guard(ctx)) return;
    clearState(ctx.from.id);
    await ctx.reply('➕ <b>New coupon</b>\n\nDiscount type?', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [btnPrimary('％ Percent off', 'cp_type_percent'), btnPrimary('⭐ Flat ⭐ off', 'cp_type_flat')],
        [btn('❌ Cancel', 'admin_coupons')]
      ])
    });
  });

  bot.action(/^cp_type_(percent|flat)$/, async ctx => {
    if (!guard(ctx)) return;
    const type = ctx.match[1];
    setState(ctx.from.id, 'admin_cp_value', { type });
    await ctx.reply(type === 'percent' ? 'Percent off? (1-100)' : 'How many ⭐ off?',
      Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_coupons')]]));
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || !state.step.startsWith('admin_cp_') || !guard(ctx)) return next();
    const text = ctx.message.text.trim();
    const cancel = Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_coupons')]]);

    if (state.step === 'admin_cp_value') {
      const n = Number(text);
      const max = state.data.type === 'percent' ? 100 : 100000;
      if (!Number.isInteger(n) || n < 1 || n > max) return ctx.reply(`Send a whole number between 1 and ${max}.`);
      setState(ctx.from.id, 'admin_cp_uses', { ...state.data, value: n });
      return ctx.reply('How many people can use it in total? (0 = unlimited)', cancel);
    }
    if (state.step === 'admin_cp_uses') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return ctx.reply('Send a whole number (0 = unlimited).');
      setState(ctx.from.id, 'admin_cp_days', { ...state.data, maxUses: n });
      return ctx.reply('Valid for how many days? (0 = never expires)', cancel);
    }
    if (state.step === 'admin_cp_days') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0 || n > 3650) return ctx.reply('Send a whole number of days (0 = never).');
      setState(ctx.from.id, 'admin_cp_code', { ...state.data, days: n });
      return ctx.reply('Coupon code? Send your own (letters/numbers, 3-24) or "-" for a random one.', cancel);
    }
    if (state.step === 'admin_cp_code') {
      const code = text === '-' ? couponsDb.randomCode('OFF') : couponsDb.norm(text);
      if (!CODE_RE.test(code)) return ctx.reply('Use only A-Z, 0-9, - and _ (3 to 24 characters).');
      const d = state.data;
      try {
        const c = couponsDb.create({
          code, type: d.type, value: d.value, maxUses: d.maxUses,
          expiresAt: d.days ? new Date(Date.now() + d.days * 86400000).toISOString() : null,
          createdBy: String(ctx.from.id)
        });
        clearState(ctx.from.id);
        auditDb.add(ctx.from.id, 'coupon', `created ${c.code} ${d.type} ${d.value}`);
        return ctx.reply(`✅ Created <code>${escapeHtml(c.code)}</code>\n${describe(c).off} off · ${c.maxUses ? c.maxUses + ' uses' : 'unlimited'} · ${c.expiresAt ? 'until ' + fmtDay(c.expiresAt) : 'no expiry'}`,
          { parse_mode: 'HTML', ...back });
      } catch (e) {
        return ctx.reply(e.message === 'exists' ? '❌ That code already exists. Send another.' : `❌ ${e.message}`);
      }
    }
    return next();
  });
}

module.exports = { register };
