const { Markup } = require('telegraf');
const { startRelay, endRelay, getRelayTarget, getRelayAdmin } = require('../state');
const adminsDb = require('../db/admins');
const { userTag } = require('../utils/format');
const { btnPrimary } = require('../utils/keyboards');

function contactUserButton(userId) {
  return Markup.inlineKeyboard([[btnPrimary('💬 Message this user', `contact_${userId}`)]]);
}

function register(bot) {
  // Admin taps "Message this user" on any alert -> starts a relay session
  bot.action(/contact_(\d+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    const targetUserId = ctx.match[1];
    startRelay(ctx.from.id, targetUserId);
    await ctx.reply(
      `💬 You're now chatting with user ${targetUserId}.\n` +
      `Everything you type will be sent to them directly. Send /endchat to stop.`
    );
  });

  bot.command('endchat', async ctx => {
    if (!adminsDb.isAdmin(ctx.from.id)) return;
    if (!getRelayTarget(ctx.from.id)) return ctx.reply('You have no active chat session.');
    endRelay(ctx.from.id);
    await ctx.reply('Chat session ended.');
  });

  // Highest-priority text router: relay messages in both directions.
  // Registered first in bot.js so an active support conversation always
  // takes priority over any wizard step that might otherwise match.
  bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next();
    const userId = ctx.from.id;

    // This user is an admin actively chatting with someone -> relay outgoing
    if (adminsDb.isAdmin(userId)) {
      const target = getRelayTarget(userId);
      if (target) {
        try {
          await ctx.telegram.sendMessage(target, `👤 <b>Support:</b> ${ctx.message.text}`, { parse_mode: 'HTML' });
          await ctx.reply('✅ Sent.');
        } catch (err) {
          await ctx.reply('⚠️ Failed to deliver message (user may have blocked the bot).');
        }
        return; // stop the chain - don't fall through to other handlers
      }
    }

    // This user is on the receiving end of an active relay session -> relay to admin
    const relayAdmin = getRelayAdmin(userId);
    if (relayAdmin) {
      try {
        await ctx.telegram.sendMessage(
          relayAdmin,
          `👤 <b>${userTag(ctx.from)}:</b> ${ctx.message.text}`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        console.error('[relay] forward to admin failed:', err.message);
      }
      return; // stop the chain
    }

    return next();
  });
}

module.exports = { register, contactUserButton };
