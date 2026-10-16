const { Markup } = require('telegraf');
const channelsDb = require('../../db/channels');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const access = require('../../services/access');
const { genId } = require('../../utils/ids');
const { escapeHtml } = require('../../utils/format');
const { setState, getState, clearState } = require('../../state');
const { btnPrimary, btnSuccess, btnDanger } = require('../../utils/keyboards');

function requirePerm(ctx, perm) {
  return adminsDb.hasPermission(ctx.from.id, perm);
}

// Plain-language result of a permission check.
function describeCheck(check, title = '') {
  if (check.error) {
    return `⚠️ Could not check this chat: ${escapeHtml(check.error)}\n\nMake sure the chat ID is correct and the bot has been added to the chat.`;
  }
  if (check.ok) {
    return `✅ Bot permissions look good${check.type ? ` (${escapeHtml(check.type)})` : ''}: it can create invite links and remove members.`;
  }
  return `⚠️ The bot is missing permissions in <b>${escapeHtml(title || check.title || 'this chat')}</b>:\n` +
    check.missing.map(m => `• ${escapeHtml(m)}`).join('\n') +
    '\n\nOpen the channel → Administrators → the bot, enable them, then try again.';
}

// Callback data is matched with anchored patterns. Unanchored patterns let the
// generic "channel detail" handler swallow every other admin_ch_* button.
function register(bot) {
  bot.action('admin_channels', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const list = channelsDb.list();
    const rows = list.map(c => [
      btnPrimary(`${c.active ? '🟢' : '🔴'} ${c.title} — ${c.price}⭐`, `admin_ch_${c.id}`)
    ]);
    rows.push([btnSuccess('➕ Add Channel', 'admin_ch_add')]);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply('📢 <b>Channels</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action('admin_ch_add', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_add_channel_id');
    await ctx.reply(
      "Send the channel's numeric chat ID (e.g. -1001234567890).\n\n" +
      '⚠️ The bot must already be an admin in that channel, with permission to invite users via link and ban/restrict members. I will check this for you.'
    );
  });

  bot.action(/^admin_ch_(ch_\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel not found.');
    await ctx.reply(
      `📢 <b>${escapeHtml(channel.title)}</b>\n` +
      `Chat ID: ${channel.chatId}\n` +
      `Price: ${channel.price}⭐\n` +
      `Test price (admins): ${channel.testPrice}⭐\n` +
      `Subscription length: ${channel.durationDays ? `${channel.durationDays} day(s)` : 'Lifetime (no expiry)'}\n` +
      `Status: ${channel.active ? 'Active 🟢' : 'Inactive 🔴'}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnPrimary('🔍 Check bot permissions', `admin_ch_check_${channel.id}`)],
          [btnPrimary('✏️ Edit Price', `admin_ch_price_${channel.id}`)],
          [btnPrimary('🧪 Edit Test Price', `admin_ch_testprice_${channel.id}`)],
          [btnPrimary('📅 Edit Duration', `admin_ch_duration_${channel.id}`)],
          [channel.active ? btnDanger('⏸ Deactivate', `admin_ch_toggle_${channel.id}`) : btnSuccess('▶️ Activate', `admin_ch_toggle_${channel.id}`)],
          [btnDanger('🗑 Delete', `admin_ch_delete_${channel.id}`)],
          [Markup.button.callback('⬅️ Back', 'admin_channels')]
        ])
      }
    );
  });

  bot.action(/^admin_ch_check_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel not found.');
    const check = await access.checkBotPermissions(ctx.telegram, channel.chatId);
    await ctx.reply(describeCheck(check, channel.title), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `admin_ch_${channel.id}`)]])
    });
  });

  bot.action(/^admin_ch_price_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_edit_price', { channelId: ctx.match[1] });
    await ctx.reply('Send the new price in Stars ⭐ (whole number):');
  });

  bot.action(/^admin_ch_testprice_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_edit_testprice', { channelId: ctx.match[1] });
    await ctx.reply('Send the new TEST price in Stars ⭐ for admins (e.g. 1):');
  });

  bot.action(/^admin_ch_duration_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_edit_duration', { channelId: ctx.match[1] });
    await ctx.reply(
      'Send the subscription length in days (e.g. 30). Decimals are fine for testing (e.g. 0.01 ≈ 14 minutes).\n' +
      'Send 0 for lifetime access with no auto-kick.'
    );
  });

  bot.action(/^admin_ch_toggle_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return;
    channelsDb.update(channel.id, { active: !channel.active });
    auditDb.add(ctx.from.id, 'channel', `${channel.title} ${!channel.active ? 'activated' : 'deactivated'}`);
    await ctx.reply(`Channel is now ${!channel.active ? 'Active 🟢' : 'Inactive 🔴'}.`);
  });

  // Deleting asks for confirmation first.
  bot.action(/^admin_ch_delete_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel not found.');
    await ctx.reply(
      `🗑 Delete <b>${escapeHtml(channel.title)}</b>?\n\nExisting subscriptions keep their record, but plans that include this channel will lose it. This cannot be undone.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[btnDanger('Yes, delete', `admin_ch_delyes_${channel.id}`), btnPrimary('Cancel', `admin_ch_${channel.id}`)]])
      }
    );
  });

  bot.action(/^admin_ch_delyes_(\S+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel already deleted.');
    channelsDb.remove(channel.id);
    auditDb.add(ctx.from.id, 'channel', `deleted ${channel.title}`);
    await ctx.reply('Channel deleted.');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_add_channel_id') {
      if (!requirePerm(ctx, 'manage_channels')) return next();
      const chatId = ctx.message.text.trim();
      if (!/^-?\d+$/.test(chatId)) return ctx.reply('Invalid chat ID. Please send numbers only (can start with -).');
      if (channelsDb.getByChatId(chatId)) {
        clearState(ctx.from.id);
        return ctx.reply('This channel is already added.');
      }
      const check = await access.checkBotPermissions(ctx.telegram, chatId);
      if (!check.ok) {
        // Keep the wizard open so the admin can fix the permissions and resend the ID.
        return ctx.reply(describeCheck(check), { parse_mode: 'HTML' });
      }
      setState(ctx.from.id, 'admin_add_channel_title', { chatId, suggestedTitle: check.title });
      return ctx.reply(
        `${describeCheck(check)}\n\nSend a display title for this channel` +
        (check.title ? ` (or send . to use "${escapeHtml(check.title)}"):` : ':'),
        { parse_mode: 'HTML' }
      );
    }

    if (state.step === 'admin_add_channel_title') {
      let title = ctx.message.text.trim();
      if (title === '.' && state.data.suggestedTitle) title = state.data.suggestedTitle;
      title = title.replace(/[<>&]/g, '').slice(0, 64);
      if (!title) return ctx.reply('Please send a non-empty title.');
      setState(ctx.from.id, 'admin_add_channel_price', { ...state.data, title });
      return ctx.reply('Send the price in Stars ⭐ (whole number):');
    }

    if (state.step === 'admin_add_channel_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price. Send a whole number ⭐.');
      setState(ctx.from.id, 'admin_add_channel_testprice', { ...state.data, price });
      return ctx.reply('Send the TEST price in Stars ⭐ for admins (e.g. 1):');
    }

    if (state.step === 'admin_add_channel_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid test price. Please try again.');
      setState(ctx.from.id, 'admin_add_channel_duration', { ...state.data, testPrice });
      return ctx.reply(
        'Send the subscription length in days (e.g. 30).\n' +
        'Send 0 for lifetime access with no auto-kick.'
      );
    }

    if (state.step === 'admin_add_channel_duration') {
      const durationDays = parseFloat(ctx.message.text.trim());
      clearState(ctx.from.id);
      if (Number.isNaN(durationDays) || durationDays < 0) return ctx.reply('Invalid duration. Please start over from Manage Channels.');
      const channel = channelsDb.add({
        id: genId('ch'),
        chatId: state.data.chatId,
        title: state.data.title,
        price: state.data.price,
        testPrice: state.data.testPrice,
        durationDays,
        welcomeMessage: '',
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: ctx.from.id
      });
      auditDb.add(ctx.from.id, 'channel', `added ${channel.title} (${channel.chatId}) ${channel.price}⭐`);
      const durationLabel = durationDays > 0 ? `${durationDays} day(s)` : 'lifetime';
      return ctx.reply(`✅ Channel added: ${channel.title} (${channel.price}⭐ / test ${channel.testPrice}⭐ / ${durationLabel})`);
    }

    if (state.step === 'admin_edit_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price.');
      channelsDb.update(state.data.channelId, { price });
      auditDb.add(ctx.from.id, 'channel', `${state.data.channelId} price = ${price}`);
      return ctx.reply(`✅ Price updated to ${price}⭐.`);
    }

    if (state.step === 'admin_edit_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid price.');
      channelsDb.update(state.data.channelId, { testPrice });
      auditDb.add(ctx.from.id, 'channel', `${state.data.channelId} test price = ${testPrice}`);
      return ctx.reply(`✅ Test price updated to ${testPrice}⭐.`);
    }

    if (state.step === 'admin_edit_duration') {
      const durationDays = parseFloat(ctx.message.text.trim());
      clearState(ctx.from.id);
      if (Number.isNaN(durationDays) || durationDays < 0) return ctx.reply('Invalid duration.');
      channelsDb.update(state.data.channelId, { durationDays });
      auditDb.add(ctx.from.id, 'channel', `${state.data.channelId} duration = ${durationDays}`);
      const durationLabel = durationDays > 0 ? `${durationDays} day(s)` : 'lifetime (no expiry)';
      return ctx.reply(`✅ Subscription length updated to ${durationLabel}.\n\nNote: this only affects new unlocks - it does not change anyone's already-active subscription.`);
    }

    return next();
  });
}

module.exports = { register, describeCheck };
