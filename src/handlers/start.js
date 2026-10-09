const { Markup } = require('telegraf');
const wallets = require('../db/wallets');
const admins = require('../db/admins');
const usersDb = require('../db/users');
const subscriptionsDb = require('../db/subscriptions');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const { btnPrimary } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, timeLeft } = require('../utils/format');

function mainMenuKeyboard(userId) {
  const rows = [
    [btnPrimary(t(userId, 'btn_plans'), 'menu_plans'), btnPrimary(t(userId, 'btn_channels'), 'menu_channels')],
    [btnPrimary(t(userId, 'btn_wallet'), 'menu_wallet'), btnPrimary(t(userId, 'btn_account'), 'menu_account')],
    [btnPrimary(t(userId, 'btn_help'), 'menu_help'), { text: t(userId, 'btn_lang'), callback_data: 'menu_lang' }]
  ];
  if (admins.isAdmin(userId)) {
    rows.push([btnPrimary(t(userId, 'btn_admin'), 'menu_admin')]);
  }
  return Markup.inlineKeyboard(rows);
}

// Short "⏳ 7 Days: 2d 4h left" lines for the soonest-expiring plan(s), so
// a user sees it the moment they open the menu.
function expiringLines(userId) {
  const now = new Date();
  const seen = new Set();
  const lines = [];
  subscriptionsDb.listByUser(userId)
    .filter(s => s.status === 'active' && new Date(s.expiresAt) > now)
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))
    .forEach(s => {
      if (seen.has(s.groupId) || lines.length >= 2) return;
      seen.add(s.groupId);
      const plan = s.planId ? plansDb.getById(s.planId) : null;
      const ch = channelsDb.getById(s.channelId);
      const title = escapeHtml(plan ? plan.title : (ch ? ch.title : '-'));
      lines.push(t(userId, 'menu_expiring', { title, left: timeLeft(s.expiresAt, now) }));
    });
  return lines;
}

function menuText(userId) {
  const lines = expiringLines(userId);
  return t(userId, 'menu_title') + (lines.length ? '\n\n' + lines.join('\n') : '');
}

function register(bot) {
  bot.start(async ctx => {
    const userId = ctx.from.id;
    usersDb.touch(ctx.from);
    const wallet = wallets.getWallet(userId); // also makes sure a wallet record exists
    // "Fresh" = never paid or bought anything yet. Only fresh users can be
    // attached to a referrer (stops people claiming a referral after the fact).
    const isFresh = wallet.transactions.length === 0 && subscriptionsDb.listByUser(userId).length === 0;

    // Referral deep link: t.me/<bot>?start=ref_<CODE>
    let refNote = '';
    const payload = (ctx.startPayload || '').trim();
    if (isFresh && payload.startsWith('ref_')) {
      const referrer = usersDb.findByReferralCode(payload.slice(4));
      if (referrer && usersDb.setReferrer(userId, referrer.id)) refNote = t(userId, 'welcome_ref');
    }

    await ctx.reply(
      t(userId, 'welcome', { name: escapeHtml(ctx.from.first_name || '') }) + refNote,
      { parse_mode: 'HTML' }
    );
    await ctx.reply(menuText(userId), { parse_mode: 'HTML', ...mainMenuKeyboard(userId) });
  });

  bot.command('menu', async ctx => {
    await ctx.reply(menuText(ctx.from.id), { parse_mode: 'HTML', ...mainMenuKeyboard(ctx.from.id) });
  });

  bot.action('menu_main', async ctx => {
    await ctx.reply(menuText(ctx.from.id), { parse_mode: 'HTML', ...mainMenuKeyboard(ctx.from.id) });
  });

  bot.action('menu_lang', async ctx => {
    const current = usersDb.getLang(ctx.from.id);
    usersDb.setLang(ctx.from.id, current === 'ml' ? 'en' : 'ml');
    await ctx.answerCbQuery();
    await ctx.reply(menuText(ctx.from.id), { parse_mode: 'HTML', ...mainMenuKeyboard(ctx.from.id) });
  });
}

module.exports = { register, mainMenuKeyboard, menuText };
