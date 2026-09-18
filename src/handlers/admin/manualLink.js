const { Markup } = require('telegraf');
const channelsDb = require('../../db/channels');
const linksDb = require('../../db/links');
const adminsDb = require('../../db/admins');
const { genId } = require('../../utils/ids');
const { setState, getState, clearState } = require('../../state');

async function createManualLink(ctx, channelId, targetUserId) {
  const channel = channelsDb.getById(channelId);
  if (!channel) return ctx.reply('Channel not found.');
  try {
    const invite = await ctx.telegram.createChatInviteLink(channel.chatId, {
      creates_join_request: true,
      name: `manual-${targetUserId || 'open'}-${Date.now()}`
    });
    linksDb.add({
      id: genId('lnk'),
      channelId: channel.id,
      chatId: channel.chatId,
      inviteLink: invite.invite_link,
      ownerUserId: targetUserId, // null = open to whoever requests first
      type: 'manual',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: ctx.from.id,
      usedAt: null,
      usedBy: null,
      price: 0
    });
    await ctx.reply(
      `✅ Manual link created for <b>${channel.title}</b>:\n\n${invite.invite_link}\n\n` +
      (targetUserId ? `Reserved for user ID: ${targetUserId}` : 'Open to the first person who requests to join.'),
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[manualLink] failed:', err.message);
    await ctx.reply('⚠️ Failed to create the invite link. Make sure the bot is an admin in that channel.');
  }
}

function register(bot) {
  bot.action('admin_manual_link', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'generate_link')) return;
    const list = channelsDb.list();
    if (list.length === 0) return ctx.reply('No channels configured yet. Add one from Manage Channels first.');
    const rows = list.map(c => [Markup.button.callback(c.title, `manual_ch_${c.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'admin_back')]);
    await ctx.reply('Choose a channel to generate a manual link for:', Markup.inlineKeyboard(rows));
  });

  bot.action(/manual_ch_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'generate_link')) return;
    const channel = channelsDb.getById(ctx.match[1]);
    if (!channel) return;
    await ctx.reply(
      'Target a specific user, or let anyone use it once?',
      Markup.inlineKeyboard([
        [Markup.button.callback('🎯 Specific User', `manual_target_${channel.id}`)],
        [Markup.button.callback('👥 Anyone (first come)', `manual_open_${channel.id}`)],
        [Markup.button.callback('⬅️ Back', 'admin_manual_link')]
      ])
    );
  });

  bot.action(/manual_target_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'generate_link')) return;
    setState(ctx.from.id, 'admin_manual_link_target', { channelId: ctx.match[1] });
    await ctx.reply('Send the Telegram user ID this link should be reserved for:');
  });

  bot.action(/manual_open_(\S+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.hasPermission(ctx.from.id, 'generate_link')) return;
    await createManualLink(ctx, ctx.match[1], null);
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_manual_link_target') return next();
    const targetId = ctx.message.text.trim();
    clearState(ctx.from.id);
    if (!/^\d+$/.test(targetId)) return ctx.reply('Invalid user ID.');
    await createManualLink(ctx, state.data.channelId, targetId);
  });
}

module.exports = { register };
