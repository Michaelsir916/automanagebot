const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const auditDb = require('../../db/audit');
const { setState, getState, clearState } = require('../../state');
const { btnSuccess, btnDanger, btnPrimary } = require('../../utils/keyboards');
const { escapeHtml } = require('../../utils/format');

const ROLE_LABEL = {
  superadmin: '👑 Super Admin',
  moderator: '🛡 Moderator',
  support: '🎧 Support',
  readonly: '👁 Read-only'
};
const ROLE_HELP =
  '👑 <b>Super Admin</b> - everything, incl. settings and roles\n' +
  '🛡 <b>Moderator</b> - manual links, payment history, tickets\n' +
  '🎧 <b>Support</b> - tickets, payments, stats, manual links\n' +
  '👁 <b>Read-only</b> - can view stats and payments, cannot change anything';

function register(bot) {
  bot.action('admin_roles', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    const list = adminsDb.listAdmins();
    const lines = list.map(a => `<code>${a.id}</code> — ${escapeHtml(ROLE_LABEL[a.role] || a.role)}`).join('\n');
    await ctx.reply(
      `👑 <b>Admins</b>\n\n${lines}\n\n${ROLE_HELP}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [btnSuccess('➕ Add Admin', 'admin_add_pick')],
          [btnDanger('➖ Remove Admin', 'admin_remove_mod')],
          [Markup.button.callback('⬅️ Back', 'admin_back')]
        ])
      }
    );
  });

  // Step 1: choose the role.
  bot.action('admin_add_pick', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    await ctx.reply(
      `Choose a role for the new admin:\n\n${ROLE_HELP}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          ...adminsDb.ROLES.map(r => [btnPrimary(ROLE_LABEL[r], `admin_add_role_${r}`)]),
          [Markup.button.callback('⬅️ Back', 'admin_roles')]
        ])
      }
    );
  });

  // Step 2: ask for the user ID.
  bot.action(/^admin_add_role_(superadmin|moderator|support|readonly)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    setState(ctx.from.id, 'admin_add_id', { role: ctx.match[1] });
    await ctx.reply(`Send the Telegram user ID to add as ${ROLE_LABEL[ctx.match[1]]}:`);
  });

  bot.action('admin_remove_mod', async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    setState(ctx.from.id, 'admin_remove_mod_id');
    await ctx.reply('Send the Telegram user ID to remove from admins:');
  });

  // Removal needs an explicit confirmation.
  bot.action(/^admin_remove_yes_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!adminsDb.isSuperAdmin(ctx.from.id)) return;
    const targetId = ctx.match[1];
    if (adminsDb.listAdmins().find(a => String(a.id) === targetId && String(a.role).includes('bootstrap'))) {
      return ctx.reply('That admin comes from ADMIN_IDS in .env and can only be removed there.');
    }
    adminsDb.removeAdmin(targetId);
    auditDb.add(ctx.from.id, 'admin_remove', `user ${targetId}`);
    await ctx.reply(`✅ ${targetId} removed from admins.`);
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_add_id') {
      if (!adminsDb.isSuperAdmin(ctx.from.id)) return next();
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d{1,15}$/.test(targetId)) return ctx.reply('Invalid user ID.');
      const role = state.data.role;
      if (!adminsDb.ROLES.includes(role)) return ctx.reply('Unknown role. Please start again.');
      adminsDb.addAdmin(targetId, role, adminsDb.ROLE_PRESETS[role], ctx.from.id);
      auditDb.add(ctx.from.id, 'admin_add', `user ${targetId} as ${role}`);
      return ctx.reply(
        `✅ ${targetId} added as ${ROLE_LABEL[role]}.\nThey must send /start to the bot once to receive admin alerts.`
      );
    }

    if (state.step === 'admin_remove_mod_id') {
      if (!adminsDb.isSuperAdmin(ctx.from.id)) return next();
      const targetId = ctx.message.text.trim();
      clearState(ctx.from.id);
      if (!/^\d{1,15}$/.test(targetId)) return ctx.reply('Invalid user ID.');
      return ctx.reply(
        `Remove admin <code>${targetId}</code>?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[btnDanger('Yes, remove', `admin_remove_yes_${targetId}`), btnPrimary('Cancel', 'admin_roles')]])
        }
      );
    }

    return next();
  });
}

module.exports = { register };
