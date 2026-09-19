const { Markup } = require('telegraf');
const plansDb = require('../../db/plans');
const channelsDb = require('../../db/channels');
const adminsDb = require('../../db/admins');
const { genId } = require('../../utils/ids');
const { setState, getState, clearState } = require('../../state');
const { btnPrimary, btnSuccess, btnDanger } = require('../../utils/keyboards');

function requirePerm(ctx) {
  return adminsDb.hasPermission(ctx.from.id, 'manage_plans');
}

function channelTitles(channelIds) {
  return channelIds
    .map(id => (channelsDb.getById(id) || { title: `(deleted: ${id})` }).title)
    .join(' + ');
}

function durationLabel(days) {
  return days > 0 ? `${days} day(s)` : 'lifetime';
}

function planSummaryLine(plan) {
  const icon = plan.type === 'bundle' ? '📦' : '🎟';
  const status = plan.active ? '🟢' : '🔴';
  return `${status} ${icon} ${plan.title} — ${plan.price}⭐ / ${durationLabel(plan.durationDays)}`;
}

async function renderPlanList(ctx) {
  const list = plansDb.list();
  const lines = list.length
    ? list.map(p => `${planSummaryLine(p)}\n   → ${channelTitles(p.channelIds)}`).join('\n\n')
    : 'No plans yet.';
  const rows = list.map(p => [btnPrimary(`${p.active ? '🟢' : '🔴'} ${p.title}`, `admin_plan_view_${p.id}`)]);
  rows.push([btnSuccess('➕ Add Single-Channel Plan', 'admin_plan_add_single')]);
  rows.push([btnSuccess('➕ Add Bundle Plan', 'admin_plan_add_bundle')]);
  rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
  await ctx.reply(`🎟 <b>Plans & Bundles</b>\n\n${lines}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
}

function bundleSelectKeyboard(selected) {
  const rows = channelsDb.listActive().map(c => {
    const checked = selected.includes(c.id) ? '☑️' : '⬜️';
    return [Markup.button.callback(`${checked} ${c.title}`, `admin_plan_bundle_toggle_${c.id}`)];
  });
  rows.push([btnSuccess(`✅ Done (${selected.length} selected)`, 'admin_plan_bundle_done')]);
  rows.push([Markup.button.callback('⬅️ Cancel', 'admin_plans')]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.action('admin_plans', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    await renderPlanList(ctx);
  });

  // ---------- Add: single-channel plan ----------
  bot.action('admin_plan_add_single', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const list = channelsDb.listActive();
    if (list.length === 0) return ctx.reply('No active channels yet. Add a channel first from Manage Channels.');
    const rows = list.map(c => [btnPrimary(c.title, `admin_plan_pick_ch_${c.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_plans')]);
    await ctx.reply('Which channel is this plan for?', Markup.inlineKeyboard(rows));
  });

  bot.action(/admin_plan_pick_ch_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    setState(ctx.from.id, 'admin_plan_single_title', { channelId: ctx.match[1] });
    await ctx.reply('Send a title for this plan (e.g. "7 Days Access"):');
  });

  // ---------- Add: bundle plan ----------
  bot.action('admin_plan_add_bundle', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const list = channelsDb.listActive();
    if (list.length < 2) return ctx.reply('You need at least 2 active channels to make a bundle.');
    setState(ctx.from.id, 'admin_plan_bundle_title');
    await ctx.reply('Send a title for this bundle (e.g. "All Access"):');
  });

  bot.action(/admin_plan_bundle_toggle_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_plan_bundle_select') return;
    const channelId = ctx.match[1];
    const selected = state.data.selected.includes(channelId)
      ? state.data.selected.filter(id => id !== channelId)
      : [...state.data.selected, channelId];
    setState(ctx.from.id, 'admin_plan_bundle_select', { ...state.data, selected });
    await ctx.editMessageReplyMarkup(bundleSelectKeyboard(selected).reply_markup).catch(() => {});
  });

  bot.action('admin_plan_bundle_done', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_plan_bundle_select') return;
    if (state.data.selected.length < 2) return ctx.reply('Select at least 2 channels first.');
    setState(ctx.from.id, 'admin_plan_bundle_duration', { title: state.data.title, channelIds: state.data.selected });
    await ctx.reply('Send the access length in days for this bundle (e.g. 7). All channels expire together on this date.');
  });

  // ---------- View / edit / delete ----------
  bot.action(/admin_plan_view_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan) return ctx.reply('Plan not found.');
    await ctx.reply(
      `${plan.type === 'bundle' ? '📦' : '🎟'} <b>${plan.title}</b>\n\n` +
      `Channels: ${channelTitles(plan.channelIds)}\n` +
      `Price: ${plan.price}⭐\n` +
      `Test price (admins): ${plan.testPrice}⭐\n` +
      `Duration: ${durationLabel(plan.durationDays)}\n` +
      `Status: ${plan.active ? 'Active 🟢' : 'Inactive 🔴'}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnPrimary('✏️ Edit Title', `admin_plan_edit_title_${plan.id}`)],
          [btnPrimary('📅 Edit Duration', `admin_plan_edit_duration_${plan.id}`)],
          [btnPrimary('💰 Edit Price', `admin_plan_edit_price_${plan.id}`)],
          [btnPrimary('🧪 Edit Test Price', `admin_plan_edit_testprice_${plan.id}`)],
          [plan.active ? btnDanger('⏸ Deactivate', `admin_plan_toggle_${plan.id}`) : btnSuccess('▶️ Activate', `admin_plan_toggle_${plan.id}`)],
          [btnDanger('🗑 Delete', `admin_plan_delete_${plan.id}`)],
          [Markup.button.callback('⬅️ Back', 'admin_plans')]
        ])
      }
    );
  });

  bot.action(/admin_plan_edit_title_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    setState(ctx.from.id, 'admin_plan_edit_title', { planId: ctx.match[1] });
    await ctx.reply('Send the new title:');
  });
  bot.action(/admin_plan_edit_duration_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    setState(ctx.from.id, 'admin_plan_edit_duration', { planId: ctx.match[1] });
    await ctx.reply('Send the new duration in days (0 = lifetime):');
  });
  bot.action(/admin_plan_edit_price_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    setState(ctx.from.id, 'admin_plan_edit_price', { planId: ctx.match[1] });
    await ctx.reply('Send the new price in Stars ⭐:');
  });
  bot.action(/admin_plan_edit_testprice_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    setState(ctx.from.id, 'admin_plan_edit_testprice', { planId: ctx.match[1] });
    await ctx.reply('Send the new TEST price in Stars ⭐ for admins:');
  });
  bot.action(/admin_plan_toggle_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    const plan = plansDb.getById(ctx.match[1]);
    if (!plan) return;
    plansDb.update(plan.id, { active: !plan.active });
    await ctx.reply(`Plan is now ${!plan.active ? 'Active 🟢' : 'Inactive 🔴'}.`);
  });
  bot.action(/admin_plan_delete_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx)) return;
    plansDb.remove(ctx.match[1]);
    await ctx.reply('🗑 Plan deleted. Existing subscribers keep access until their current expiry.');
  });

  // ---------- Free-text wizard steps ----------
  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_plan_single_title') {
      const title = ctx.message.text.trim();
      setState(ctx.from.id, 'admin_plan_single_duration', { ...state.data, title });
      return ctx.reply('Send the access length in days (e.g. 7). Send 0 for lifetime access.');
    }

    if (state.step === 'admin_plan_single_duration') {
      const durationDays = parseFloat(ctx.message.text.trim());
      if (Number.isNaN(durationDays) || durationDays < 0) return ctx.reply('Invalid duration. Try again.');
      setState(ctx.from.id, 'admin_plan_single_price', { ...state.data, durationDays });
      return ctx.reply('Send the price in Stars ⭐ (whole number):');
    }

    if (state.step === 'admin_plan_single_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price. Send a whole number ⭐.');
      setState(ctx.from.id, 'admin_plan_single_testprice', { ...state.data, price });
      return ctx.reply('Send the TEST price in Stars ⭐ for admins (e.g. 1):');
    }

    if (state.step === 'admin_plan_single_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid test price. Please start over.');
      const plan = plansDb.add({
        id: genId('plan'),
        type: 'single',
        title: state.data.title,
        channelIds: [state.data.channelId],
        durationDays: state.data.durationDays,
        price: state.data.price,
        testPrice,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: ctx.from.id
      });
      return ctx.reply(`✅ Plan created: ${planSummaryLine(plan)}`, { parse_mode: 'HTML' });
    }

    if (state.step === 'admin_plan_bundle_title') {
      const title = ctx.message.text.trim();
      setState(ctx.from.id, 'admin_plan_bundle_select', { title, selected: [] });
      return ctx.reply('Select the channels for this bundle, then tap Done:', bundleSelectKeyboard([]));
    }

    if (state.step === 'admin_plan_bundle_duration') {
      const durationDays = parseFloat(ctx.message.text.trim());
      if (Number.isNaN(durationDays) || durationDays < 0) return ctx.reply('Invalid duration. Try again.');
      setState(ctx.from.id, 'admin_plan_bundle_price', { ...state.data, durationDays });
      return ctx.reply('Send the bundle price in Stars ⭐ (whole number):');
    }

    if (state.step === 'admin_plan_bundle_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price. Send a whole number ⭐.');
      setState(ctx.from.id, 'admin_plan_bundle_testprice', { ...state.data, price });
      return ctx.reply('Send the TEST price in Stars ⭐ for admins (e.g. 1):');
    }

    if (state.step === 'admin_plan_bundle_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid test price. Please start over.');
      const plan = plansDb.add({
        id: genId('plan'),
        type: 'bundle',
        title: state.data.title,
        channelIds: state.data.channelIds,
        durationDays: state.data.durationDays,
        price: state.data.price,
        testPrice,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: ctx.from.id
      });
      return ctx.reply(`✅ Bundle created: ${planSummaryLine(plan)}\n   → ${channelTitles(plan.channelIds)}`, { parse_mode: 'HTML' });
    }

    if (state.step === 'admin_plan_edit_title') {
      const title = ctx.message.text.trim();
      clearState(ctx.from.id);
      plansDb.update(state.data.planId, { title });
      return ctx.reply(`✅ Title updated to "${title}".`);
    }

    if (state.step === 'admin_plan_edit_duration') {
      const durationDays = parseFloat(ctx.message.text.trim());
      clearState(ctx.from.id);
      if (Number.isNaN(durationDays) || durationDays < 0) return ctx.reply('Invalid duration.');
      plansDb.update(state.data.planId, { durationDays });
      return ctx.reply(`✅ Duration updated to ${durationLabel(durationDays)}.\n\nNote: only affects new purchases, not existing subscribers.`);
    }

    if (state.step === 'admin_plan_edit_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price.');
      plansDb.update(state.data.planId, { price });
      return ctx.reply(`✅ Price updated to ${price}⭐.`);
    }

    if (state.step === 'admin_plan_edit_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid price.');
      plansDb.update(state.data.planId, { testPrice });
      return ctx.reply(`✅ Test price updated to ${testPrice}⭐.`);
    }

    return next();
  });
}

module.exports = { register };
