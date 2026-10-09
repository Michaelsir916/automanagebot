const { Markup } = require('telegraf');
const adminsDb = require('../../db/admins');
const settingsDb = require('../../db/settings');
const auditDb = require('../../db/audit');
const backup = require('../../services/backup');
const { setState, getState, clearState } = require('../../state');
const { btn, btnPrimary, btnSuccess, btnDanger, grid } = require('../../utils/keyboards');
const { escapeHtml, fmtDate } = require('../../utils/format');

const TOGGLES = {
  maintenance: '🛠 Maintenance',
  referralEnabled: '🎁 Referral',
  winbackEnabled: '🔁 Win-back',
  backupEnabled: '💾 Auto-backup',
  upiEnabled: '🇮🇳 UPI'
};

// Editable values: type int | num | str | list
const FIELDS = {
  referralRewardStars: { label: 'Referral reward (⭐)', type: 'int', min: 0, max: 100000 },
  renewDiscountPct: { label: 'Renewal discount (%)', type: 'int', min: 0, max: 90 },
  winbackDiscountPct: { label: 'Win-back discount (%)', type: 'int', min: 0, max: 90 },
  reminderDays: { label: 'Reminder days before expiry', type: 'list', hint: 'e.g. 3,1' },
  winbackAfterDays: { label: 'Win-back days after expiry', type: 'list', hint: 'e.g. 3,7' },
  backupEveryHours: { label: 'Backup every (hours)', type: 'int', min: 1, max: 168 },
  upiId: { label: 'UPI ID', type: 'str', max: 80 },
  upiName: { label: 'UPI display name', type: 'str', max: 60 },
  upiStarsPerRupee: { label: '⭐ per ₹1', type: 'num', min: 0.1, max: 100 },
  upiMinRupees: { label: 'Minimum UPI amount (₹)', type: 'int', min: 1, max: 100000 },
  maintenanceMessage: { label: 'Maintenance message', type: 'str', max: 300 }
};

function onOff(v) { return v ? '🟢 ON' : '⚪️ OFF'; }

function packagesText(pkgs) {
  return pkgs.map(p => `${p.stars}:${p.bonusPct || 0}${p.popular ? '*' : ''}`).join(', ');
}

function parsePackages(text) {
  const parts = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) throw new Error('Send 1 to 8 packages.');
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*:\s*(\d+)(\*)?$/);
    if (!m) throw new Error(`Bad entry "${p}". Use stars:bonus%, e.g. 100:5`);
    const stars = Number(m[1]);
    const pct = Number(m[2]);
    if (stars < 1 || stars > 100000 || pct > 100) throw new Error(`Out of range: "${p}"`);
    if (seen.has(stars)) throw new Error(`Duplicate package ${stars}`);
    seen.add(stars);
    out.push({ stars, bonusPct: pct, ...(m[3] ? { popular: true } : {}) });
  }
  return out.sort((a, b) => a.stars - b.stars);
}

function parseField(def, raw) {
  const text = raw.trim();
  if (def.type === 'int') {
    if (!/^\d+$/.test(text)) throw new Error('Send a whole number.');
    const n = Number(text);
    if (n < def.min || n > def.max) throw new Error(`Must be between ${def.min} and ${def.max}.`);
    return n;
  }
  if (def.type === 'num') {
    const n = Number(text);
    if (!Number.isFinite(n) || n < def.min || n > def.max) throw new Error(`Must be a number between ${def.min} and ${def.max}.`);
    return n;
  }
  if (def.type === 'list') {
    const arr = text.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!arr.length || arr.length > 5 || arr.some(n => !Number.isInteger(n) || n < 1 || n > 90)) {
      throw new Error('Send 1 to 5 whole numbers (1-90), e.g. 3,1');
    }
    return Array.from(new Set(arr)).sort((a, b) => b - a);
  }
  if (text.length > def.max) throw new Error(`Max ${def.max} characters.`);
  return text;
}

function displayValue(key, s) {
  const v = s[key];
  if (Array.isArray(v)) return v.join(', ');
  return v === '' || v === undefined ? '—' : String(v);
}

function settingsText(s) {
  return (
    '⚙️ <b>Settings</b>\n\n' +
    `${onOff(s.maintenance)} Maintenance\n` +
    `${onOff(s.referralEnabled)} Referral (reward ${s.referralRewardStars}⭐)\n` +
    `${onOff(s.winbackEnabled)} Win-back (${s.winbackDiscountPct}% after ${displayValue('winbackAfterDays', s)} days)\n` +
    `${onOff(s.backupEnabled)} Auto-backup (every ${s.backupEveryHours}h` +
    `${s.lastBackupAt ? `, last ${fmtDate(s.lastBackupAt)}` : ''})\n` +
    `${onOff(s.upiEnabled)} UPI${s.upiId ? ` (${escapeHtml(s.upiId)})` : ' — no UPI ID set'}\n\n` +
    `🔁 Renewal discount: ${s.renewDiscountPct}%\n` +
    `⏰ Reminders: ${displayValue('reminderDays', s)} day(s) before expiry\n` +
    `⭐ Packages: <code>${escapeHtml(packagesText(s.rechargePackages))}</code>`
  );
}

function settingsKeyboard(s) {
  const toggles = Object.entries(TOGGLES).map(([key, label]) =>
    (s[key] ? btnSuccess : btn)(`${label}: ${s[key] ? 'ON' : 'OFF'}`, `set_tog_${key}`));
  const rows = [
    ...grid(toggles, 2),
    [btnPrimary('✏️ Edit Values', 'set_values'), btnPrimary('⭐ Packages', 'set_packages')],
    [btnPrimary('💾 Backup Now', 'set_backup_now'), btnDanger('♻️ Restore', 'set_restore')],
    [btnPrimary('📜 Audit Log', 'admin_audit_0')],
    [btn('⬅️ Back', 'admin_back')]
  ];
  return Markup.inlineKeyboard(rows);
}

async function showSettings(ctx) {
  const s = settingsDb.load();
  await ctx.reply(settingsText(s), { parse_mode: 'HTML', ...settingsKeyboard(s) });
}

function register(bot) {
  const guard = ctx => adminsDb.isSuperAdmin(ctx.from.id);

  bot.action('admin_settings', async ctx => { if (guard(ctx)) { clearState(ctx.from.id); await showSettings(ctx); } });

  bot.action(/^set_tog_(\w+)$/, async ctx => {
    if (!guard(ctx)) return;
    const key = ctx.match[1];
    if (!TOGGLES[key]) return;
    const s = settingsDb.load();
    const next = !s[key];
    if (key === 'upiEnabled' && next && !s.upiId) {
      return ctx.telegram.answerCbQuery(ctx.callbackQuery.id, 'Set the UPI ID first (Edit Values).', { show_alert: true }).catch(() => {});
    }
    settingsDb.set(key, next);
    auditDb.add(ctx.from.id, 'setting', `${key} = ${next}`);
    await showSettings(ctx);
  });

  // ---- numeric / text values ----
  bot.action('set_values', async ctx => {
    if (!guard(ctx)) return;
    const s = settingsDb.load();
    const buttons = Object.entries(FIELDS).map(([key, f]) =>
      btnPrimary(`${f.label}: ${displayValue(key, s).slice(0, 14)}`, `set_edit_${key}`));
    await ctx.reply('✏️ <b>Edit values</b>\nTap one to change it.',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([...buttons.map(b => [b]), [btn('⬅️ Back', 'admin_settings')]]) });
  });

  bot.action(/^set_edit_(\w+)$/, async ctx => {
    if (!guard(ctx)) return;
    const key = ctx.match[1];
    const def = FIELDS[key];
    if (!def) return;
    setState(ctx.from.id, 'admin_set_edit', { key });
    const s = settingsDb.load();
    await ctx.reply(
      `✏️ <b>${def.label}</b>\nCurrent: <code>${escapeHtml(displayValue(key, s))}</code>\n\n` +
      `Send the new value${def.hint ? ` (${def.hint})` : ''}${def.type === 'str' ? ' or "-" to clear' : ''}:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn('❌ Cancel', 'set_values')]]) }
    );
  });

  bot.action('set_packages', async ctx => {
    if (!guard(ctx)) return;
    setState(ctx.from.id, 'admin_set_packages');
    const s = settingsDb.load();
    await ctx.reply(
      '⭐ <b>Recharge packages</b>\n\nFormat: <code>stars:bonus%</code>, comma separated. Add <code>*</code> to mark one as popular.\n\n' +
      `Current:\n<code>${escapeHtml(packagesText(s.rechargePackages))}</code>\n\nExample: <code>50:0, 100:5, 250:10*, 500:15</code>`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_settings')]]) }
    );
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || !guard(ctx)) return next();
    const back = Markup.inlineKeyboard([[btn('⬅️ Settings', 'admin_settings')]]);

    if (state.step === 'admin_set_edit') {
      const def = FIELDS[state.data.key];
      if (!def) { clearState(ctx.from.id); return next(); }
      try {
        let value = ctx.message.text.trim() === '-' && def.type === 'str' ? '' : parseField(def, ctx.message.text);
        settingsDb.set(state.data.key, value);
        clearState(ctx.from.id);
        auditDb.add(ctx.from.id, 'setting', `${state.data.key} = ${Array.isArray(value) ? value.join(',') : value}`);
        return ctx.reply(`✅ ${def.label} updated.`, back);
      } catch (e) {
        return ctx.reply(`❌ ${e.message}\nTry again, or press Cancel.`);
      }
    }

    if (state.step === 'admin_set_packages') {
      try {
        const pkgs = parsePackages(ctx.message.text);
        settingsDb.set('rechargePackages', pkgs);
        clearState(ctx.from.id);
        auditDb.add(ctx.from.id, 'setting', `packages = ${packagesText(pkgs)}`);
        return ctx.reply(`✅ Packages updated:\n<code>${escapeHtml(packagesText(pkgs))}</code>`, { parse_mode: 'HTML', ...back });
      } catch (e) {
        return ctx.reply(`❌ ${e.message}\nTry again, or press Cancel.`);
      }
    }
    return next();
  });

  // ---- backup / restore ----
  bot.action('set_backup_now', async ctx => {
    if (!guard(ctx)) return;
    const status = await ctx.replyNew('⏳ Creating backup…');
    try {
      const res = await backup.runBackup(ctx.telegram, 'manual');
      settingsDb.set('lastBackupAt', new Date().toISOString());
      auditDb.add(ctx.from.id, 'backup', 'manual');
      await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
        `✅ Backup done: ${res.name} (${(res.size / 1024).toFixed(1)} KB)\nSent to ${res.sent} super admin(s).`,
        back1());
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
        `❌ Backup failed: ${err.message}`, back1()).catch(() => {});
    }
  });

  bot.action('set_restore', async ctx => {
    if (!guard(ctx)) return;
    setState(ctx.from.id, 'admin_restore_file');
    await ctx.reply(
      '♻️ <b>Restore</b>\n\nSend the backup file (<code>.json.gz</code>) that this bot created.\n\n' +
      '⚠️ This replaces the current data. A safety copy of the current data is saved first.',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btn('❌ Cancel', 'admin_settings')]]) }
    );
  });

  bot.on('document', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_restore_file' || !guard(ctx)) return next();
    const doc = ctx.message.document;
    if (doc.file_size && doc.file_size > 19 * 1024 * 1024) return ctx.reply('❌ File is too large for the bot to download (max ~20 MB).');
    const status = await ctx.reply('⏳ Reading backup…');
    try {
      const buf = await backup.downloadTelegramFile(ctx.telegram, doc.file_id);
      const obj = backup.parseBackup(buf);
      setState(ctx.from.id, 'admin_restore_confirm', { obj });
      await ctx.reply(
        `♻️ <b>Backup is valid</b>\n\nCreated: ${fmtDate(obj.createdAt)}\nFiles: ${Object.keys(obj.files).length}\n\n` +
        'Restore it now? Current data will be overwritten.',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[btnDanger('✅ Yes, restore', 'set_restore_go'), btn('❌ Cancel', 'admin_settings')]]) }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
    return status;
  });

  bot.action('set_restore_go', async ctx => {
    if (!guard(ctx)) return;
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_restore_confirm') return ctx.reply('Nothing to restore. Start again.', back1());
    clearState(ctx.from.id);
    try {
      const n = backup.applyBackup(state.data.obj);
      auditDb.add(ctx.from.id, 'restore', `${n} files`);
      await ctx.reply(`✅ Restored ${n} file(s). The bot is using the restored data now.`, back1());
    } catch (err) {
      await ctx.reply(`❌ Restore failed: ${err.message}`, back1());
    }
  });
}

function back1() { return Markup.inlineKeyboard([[btn('⬅️ Settings', 'admin_settings')]]); }

module.exports = { register, parsePackages };
