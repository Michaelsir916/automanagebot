const { Markup } = require('telegraf');
const channelsDb = require('../../db/channels');
const adminsDb = require('../../db/admins');
const { genId } = require('../../utils/ids');
const { setState, getState, clearState } = require('../../state');

function requirePerm(ctx, perm) {
  return adminsDb.hasPermission(ctx.from.id, perm);
}

function register(bot) {
  bot.action('admin_channels', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const list = channelsDb.list();
    const rows = list.map(c => [
      Markup.button.callback(`${c.active ? '🟢' : '🔴'} ${c.title} — ${c.price}⭐`, `admin_ch_${c.id}`)
    ]);
    rows.push([Markup.button.callback('➕ Add Channel', 'admin_ch_add')]);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply('📢 <b>Channels</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action('admin_ch_add', async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_add_channel_id');
    await ctx.reply(
      "Send the channel's numeric chat ID (e.g. -1001234567890).\n\n" +
      '⚠️ The bot must already be an admin in that channel, with permission to invite users via link and ban/restrict members.'
    );
  });

  bot.action(/admin_ch_(?!add)(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return ctx.reply('Channel not found.');
    await ctx.reply(
      `📢 <b>${channel.title}</b>\n` +
      `Chat ID: ${channel.chatId}\n` +
      `Price: ${channel.price}⭐\n` +
      `Test price (admins): ${channel.testPrice}⭐\n` +
      `Status: ${channel.active ? 'Active 🟢' : 'Inactive 🔴'}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Edit Price', `admin_ch_price_${channel.id}`)],
          [Markup.button.callback('🧪 Edit Test Price', `admin_ch_testprice_${channel.id}`)],
          [Markup.button.callback(channel.active ? '⏸ Deactivate' : '▶️ Activate', `admin_ch_toggle_${channel.id}`)],
          [Markup.button.callback('🗑 Delete', `admin_ch_delete_${channel.id}`)],
          [Markup.button.callback('⬅️ Back', 'admin_channels')]
        ])
      }
    );
  });

  bot.action(/admin_ch_price_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_edit_price', { channelId: ctx.match[1] });
    await ctx.reply('Send the new price in Stars ⭐ (whole number):');
  });

  bot.action(/admin_ch_testprice_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    setState(ctx.from.id, 'admin_edit_testprice', { channelId: ctx.match[1] });
    await ctx.reply('Send the new TEST price in Stars ⭐ for admins (e.g. 1):');
  });

  bot.action(/admin_ch_toggle_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return;
    channelsDb.update(channel.id, { active: !channel.active });
    await ctx.reply(`Channel is now ${!channel.active ? 'Active 🟢' : 'Inactive 🔴'}.`);
  });

  bot.action(/admin_ch_delete_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!requirePerm(ctx, 'manage_channels')) return;
    channelsDb.remove(ctx.match[1]);
    await ctx.reply('Channel deleted.');
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_add_channel_id') {
      const chatId = ctx.message.text.trim();
      if (!/^-?\d+$/.test(chatId)) return ctx.reply('Invalid chat ID. Please send numbers only (can start with -).');
      setState(ctx.from.id, 'admin_add_channel_title', { chatId });
      return ctx.reply('Send a display title for this channel:');
    }

    if (state.step === 'admin_add_channel_title') {
      const title = ctx.message.text.trim();
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
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid test price. Please start over from Manage Channels.');
      const channel = channelsDb.add({
        id: genId('ch'),
        chatId: state.data.chatId,
        title: state.data.title,
        price: state.data.price,
        testPrice,
        welcomeMessage: '',
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: ctx.from.id
      });
      return ctx.reply(`✅ Channel added: ${channel.title} (${channel.price}⭐ / test ${channel.testPrice}⭐)`);
    }

    if (state.step === 'admin_edit_price') {
      const price = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(price) || price < 1) return ctx.reply('Invalid price.');
      channelsDb.update(state.data.channelId, { price });
      return ctx.reply(`✅ Price updated to ${price}⭐.`);
    }

    if (state.step === 'admin_edit_testprice') {
      const testPrice = parseInt(ctx.message.text.trim(), 10);
      clearState(ctx.from.id);
      if (!Number.isInteger(testPrice) || testPrice < 0) return ctx.reply('Invalid price.');
      channelsDb.update(state.data.channelId, { testPrice });
      return ctx.reply(`✅ Test price updated to ${testPrice}⭐.`);
    }

    return next();
  });
}

module.exports = { register };
