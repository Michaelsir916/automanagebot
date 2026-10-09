const { Markup } = require('telegraf');
const walletsDb = require('../db/wallets');
const subscriptionsDb = require('../db/subscriptions');
const plansDb = require('../db/plans');
const channelsDb = require('../db/channels');
const usersDb = require('../db/users');
const settingsDb = require('../db/settings');
const { btn, btnPrimary, btnSuccess, navRow } = require('../utils/keyboards');
const { t } = require('../utils/i18n');
const { escapeHtml, fmtDay, fmtDate, fmtNum, timeLeft } = require('../utils/format');

let botUsername = null;
async function getBotUsername(telegram) {
  if (botUsername) return botUsername;
  try {
    const me = await telegram.getMe();
    botUsername = me.username;
  } catch (e) { /* offline: caller falls back to code only */ }
  return botUsername;
}

function accountScreen(userId) {
  const now = new Date();
  const user = usersDb.get(userId);
  const groups = new Map();
  subscriptionsDb.listByUser(userId)
    .filter(s => s.status === 'active' && new Date(s.expiresAt) > now)
    .forEach(s => { if (!groups.has(s.groupId)) groups.set(s.groupId, s); });

  let subs = t(userId, 'account_no_subs');
  if (groups.size) {
    const lines = Array.from(groups.values()).slice(0, 6).map(s => {
      const plan = s.planId ? plansDb.getById(s.planId) : null;
      const ch = channelsDb.getById(s.channelId);
      return t(userId, 'account_sub_line', {
        title: escapeHtml(plan ? plan.title : (ch ? ch.title : '-')),
        expires: fmtDate(s.expiresAt), left: timeLeft(s.expiresAt, now),
        auto: t(userId, s.autoRenew ? 'on' : 'off')
      });
    });
    subs = t(userId, 'account_subs_head') + '\n' + lines.join('\n');
  }

  const text = t(userId, 'account_title', {
    id: userId,
    balance: fmtNum(walletsDb.getBalance(userId)),
    joined: user ? fmtDay(user.joinedAt) : '-',
    subs
  });
  const rows = [
    [btnPrimary(t(userId, 'btn_my_subs'), 'menu_subs'), btnSuccess(t(userId, 'btn_recharge'), 'wallet_recharge')]
  ];
  if (settingsDb.get('referralEnabled')) rows.push([btnPrimary(t(userId, 'btn_referral'), 'menu_referral')]);
  rows.push([btn(t(userId, 'home'), 'menu_main')]);
  return { text, kb: Markup.inlineKeyboard(rows) };
}

function referralStats(userId) {
  const refs = usersDb.listReferrals(userId);
  const rewarded = refs.filter(r => r.referralRewarded).length;
  const reward = Number(settingsDb.get('referralRewardStars')) || 0;
  return { count: refs.length, rewarded, earned: rewarded * reward, reward };
}

function leaderboard(limit = 10) {
  const counts = new Map();
  usersDb.list().forEach(u => {
    if (u.referredBy && u.referralRewarded) counts.set(u.referredBy, (counts.get(u.referredBy) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function register(bot) {
  bot.action('menu_account', async ctx => {
    const { text, kb } = accountScreen(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  });

  bot.action('menu_referral', async ctx => {
    const userId = ctx.from.id;
    const back = Markup.inlineKeyboard([navRow('menu_account', t(userId, 'back'), t(userId, 'home'))]);
    if (!settingsDb.get('referralEnabled')) return ctx.reply(t(userId, 'ref_disabled'), back);

    const user = usersDb.touch(ctx.from) || usersDb.get(userId);
    const username = await getBotUsername(ctx.telegram);
    const code = user.referralCode;
    const link = username ? `https://t.me/${username}?start=ref_${code}` : '(bot link unavailable)';
    const st = referralStats(userId);

    await ctx.reply(
      t(userId, 'ref_title', { reward: st.reward, link, code, count: st.count, rewarded: st.rewarded, earned: fmtNum(st.earned) }),
      {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([
          [btnPrimary(t(userId, 'btn_leaderboard'), 'ref_board')],
          navRow('menu_account', t(userId, 'back'), t(userId, 'home'))
        ])
      }
    );
  });

  bot.action('ref_board', async ctx => {
    const userId = ctx.from.id;
    const top = leaderboard(10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.length
      ? top.map(([id, n], i) => {
        const u = usersDb.get(id);
        const name = escapeHtml((u && (u.firstName || u.username)) || `User ${String(id).slice(-4)}`);
        return t(userId, 'ref_board_line', { medal: medals[i] || `${i + 1}.`, name, n });
      }).join('\n')
      : t(userId, 'ref_board_empty');
    await ctx.reply(
      t(userId, 'ref_board_title', { lines }),
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([navRow('menu_referral', t(userId, 'back'), t(userId, 'home'))]) }
    );
  });
}

module.exports = { register, accountScreen, referralStats, leaderboard };
