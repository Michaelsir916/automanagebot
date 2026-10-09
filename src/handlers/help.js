const { Markup } = require('telegraf');
const ticketsDb = require('../db/tickets');
const adminsDb = require('../db/admins');
const bansDb = require('../db/bans');
const { setState, getState, clearState } = require('../state');
const { btn, btnPrimary, btnSuccess, navRow } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, userTag } = require('../utils/format');
const { notifyAdmins } = require('../utils/notify');

const FAQ_COUNT = 5;

function ticketAdminButtons(ticket) {
  return Markup.inlineKeyboard([[
    btnPrimary('💬 Reply', `contact_${ticket.userId}`),
    btnSuccess(`✅ Close #${ticket.no}`, `ticket_close_${ticket.no}`)
  ]]);
}

// Tell every admin about a new ticket / a new message on an open one.
async function notifyTicket(telegram, from, ticket, text, isNew) {
  await notifyAdmins(
    telegram,
    `${isNew ? '🎫 <b>New ticket' : '💬 <b>New message on ticket'} #${ticket.no}</b>\n` +
    `From: ${userTag(from)} (id: <code>${from.id}</code>)\n\n${escapeHtml(text).slice(0, 1500)}`,
    ticketAdminButtons(ticket)
  );
}

async function submitToTicket(ctx, text) {
  const userId = ctx.from.id;
  const existing = ticketsDb.getOpenByUser(userId);
  let ticket;
  let isNew = false;
  if (existing) {
    ticket = ticketsDb.addMessage(existing.no, 'user', text);
  } else {
    ticket = ticketsDb.open(userId, text);
    isNew = true;
  }
  await notifyTicket(ctx.telegram, ctx.from, ticket, text, isNew);
  return { ticket, isNew };
}

function register(bot) {
  bot.action('menu_help', async ctx => {
    const userId = ctx.from.id;
    const rows = [];
    for (let i = 1; i <= FAQ_COUNT; i++) rows.push([btn(t(userId, `faq_${i}_q`), `faq_${i}`)]);
    rows.push([btnPrimary(t(userId, 'btn_contact_support'), 'support_start')]);
    rows.push([btn(t(userId, 'home'), 'menu_main')]);
    await ctx.reply(t(userId, 'help_title'), { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.action(/^faq_([1-9])$/, async ctx => {
    const userId = ctx.from.id;
    const n = ctx.match[1];
    await ctx.reply(
      `<b>${t(userId, `faq_${n}_q`)}</b>\n\n${t(userId, `faq_${n}_a`)}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnPrimary(t(userId, 'btn_contact_support'), 'support_start')],
          navRow('menu_help', t(userId, 'back'), t(userId, 'home'))
        ])
      }
    );
  });

  const startSupport = async ctx => {
    const userId = ctx.from.id;
    if (bansDb.isBanned(userId)) {
      return ctx.reply(t(userId, 'banned'), Markup.inlineKeyboard([navRow(null, '', t(userId, 'home'))]));
    }
    setState(userId, 'awaiting_support');
    await ctx.reply(t(userId, 'support_ask'), Markup.inlineKeyboard([[btn(t(userId, 'cancel'), 'support_cancel')]]));
  };
  bot.action('support_start', startSupport);
  bot.action('menu_support', startSupport); // legacy button

  bot.action('support_cancel', async ctx => {
    clearState(ctx.from.id);
    const rows = [[btn(t(ctx.from.id, 'back'), 'menu_help'), btn(t(ctx.from.id, 'home'), 'menu_main')]];
    await ctx.reply(t(ctx.from.id, 'help_title'), { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'awaiting_support') return next();
    const userId = ctx.from.id;
    clearState(userId);
    const { ticket, isNew } = await submitToTicket(ctx, ctx.message.text);
    return ctx.reply(
      t(userId, isNew ? 'ticket_created' : 'ticket_appended', { no: ticket.no }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn(t(userId, 'home'), 'menu_main')]]) }
    );
  });
}

// Registered LAST in bot.js: a user with an open ticket can simply keep
// typing and the messages are added to it (no need to press buttons again).
function registerCatchAll(bot) {
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    if (ctx.message.text.startsWith('/') || adminsDb.isAdmin(userId) || getState(userId)) return next();
    const open = ticketsDb.getOpenByUser(userId);
    if (!open) return next();
    const ticket = ticketsDb.addMessage(open.no, 'user', ctx.message.text);
    await notifyTicket(ctx.telegram, ctx.from, ticket, ctx.message.text, false);
    return ctx.reply(t(userId, 'ticket_appended', { no: ticket.no }), { parse_mode: 'HTML' });
  });
}

module.exports = { register, registerCatchAll, ticketAdminButtons };
