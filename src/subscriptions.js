// ===================================================================
// subscriptions.js — Paid channel access via Telegram Stars (XTR)
// ===================================================================
// Self-contained feature module. Everything it needs (data storage,
// admin UI, user purchase flow, payment handling, expiry sweep,
// auto-renew) lives in this one file. bot.js only needs two lines:
//
//   const subscriptions = require('./subscriptions');
//   subscriptions.register(bot, { isAdmin, getKnownChats, logError, chatTypeIcon });
//
// placed right after `const bot = new Telegraf(...)`. See the bottom
// of this file for exactly what register() wires up and why the
// order (very early, via bot.use()) matters.
//
// WHAT THIS DOES
// - Admin sets up one or more "plans" (duration + Stars price) per
//   channel, and optionally "bundles" (several channels sold together
//   for one duration + one price).
// - A user runs /subscribe, picks a channel/bundle + plan, pays with
//   Telegram Stars (no external payment gateway needed — Stars are
//   built into Telegram itself).
// - On successful payment the bot creates a single-use invite link
//   and DMs it to the user, and records an expiry timestamp.
// - A sweep every minute kicks (ban+unban) anyone whose access has
//   expired — no grace period, per your instructions.
// - If the user turned "Auto-Renew" on at purchase time, the bot
//   proactively sends a fresh Stars invoice ~1 hour before expiry so
//   renewing is a single tap. IMPORTANT LIMITATION: Telegram's Bot
//   API has no way for a bot to silently charge Stars again on its
//   own — every payment, renewal included, needs the user to tap
//   "Pay" on an invoice. "Auto-renew" here means "auto-send the
//   renewal invoice before it lapses", not "auto-charge silently".
// ===================================================================

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'subscriptions_data.json');

const DEFAULT_DATA = {
    // channelId (string) -> { title, plans: [{ id, days, stars, label }] }
    channels: {},
    // bundleId (string) -> { id, title, channelIds: [string...], days, stars }
    bundles: {},
    // `${channelId}:${userId}` -> membership record (see createOrExtendMembership)
    memberships: {},
    // flat purchase log, newest last
    purchases: []
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_RENEW_WINDOW_MS = 60 * 60 * 1000; // send renewal invoice ~1h before expiry

function atomicWrite(filePath, data) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e.message);
        return fallback;
    }
}

function loadData() {
    const raw = safeReadJson(DATA_PATH, {});
    return {
        channels: raw.channels || {},
        bundles: raw.bundles || {},
        memberships: raw.memberships || {},
        purchases: raw.purchases || []
    };
}

function saveData(data) {
    atomicWrite(DATA_PATH, data);
}

function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function memberKey(channelId, userId) {
    return `${channelId}:${userId}`;
}

// ===== Channels & Plans =====

function addChannel(channelId, title) {
    const data = loadData();
    const key = String(channelId);
    if (!data.channels[key]) {
        data.channels[key] = { title: title || 'Untitled', plans: [] };
        saveData(data);
    }
    return data.channels[key];
}

function removeChannel(channelId) {
    const data = loadData();
    const key = String(channelId);
    delete data.channels[key];
    // Also drop any bundle that references it, and its memberships.
    for (const bId of Object.keys(data.bundles)) {
        const b = data.bundles[bId];
        if (b.channelIds.includes(key)) {
            b.channelIds = b.channelIds.filter(id => id !== key);
            if (b.channelIds.length === 0) delete data.bundles[bId];
        }
    }
    for (const mKey of Object.keys(data.memberships)) {
        if (mKey.startsWith(`${key}:`)) delete data.memberships[mKey];
    }
    saveData(data);
}

function listChannels() {
    const data = loadData();
    return Object.entries(data.channels).map(([id, c]) => ({ id, ...c }));
}

function getChannel(channelId) {
    const data = loadData();
    return data.channels[String(channelId)] || null;
}

function addPlan(channelId, days, stars, label) {
    const data = loadData();
    const key = String(channelId);
    if (!data.channels[key]) return null;
    const plan = { id: newId(), days: Number(days), stars: Number(stars), label: label || null };
    data.channels[key].plans.push(plan);
    saveData(data);
    return plan;
}

function removePlan(channelId, planId) {
    const data = loadData();
    const key = String(channelId);
    if (!data.channels[key]) return;
    data.channels[key].plans = data.channels[key].plans.filter(p => p.id !== planId);
    saveData(data);
}

function getPlan(channelId, planId) {
    const ch = getChannel(channelId);
    if (!ch) return null;
    return ch.plans.find(p => p.id === planId) || null;
}

// ===== Bundles =====

function addBundle(title, channelIds, days, stars) {
    const data = loadData();
    const id = newId();
    data.bundles[id] = {
        id,
        title: title || 'Bundle',
        channelIds: channelIds.map(String),
        days: Number(days),
        stars: Number(stars)
    };
    saveData(data);
    return data.bundles[id];
}

function removeBundle(bundleId) {
    const data = loadData();
    delete data.bundles[bundleId];
    saveData(data);
}

function listBundles() {
    const data = loadData();
    return Object.values(data.bundles);
}

function getBundle(bundleId) {
    const data = loadData();
    return data.bundles[bundleId] || null;
}

// ===== Memberships =====

// Creates or extends a membership. If the user already has active
// (non-expired) access to this channel, the new duration stacks on
// top of their current expiry instead of overwriting it.
function createOrExtendMembership(channelId, userId, days, meta) {
    const data = loadData();
    const key = memberKey(channelId, userId);
    const now = Date.now();
    const existing = data.memberships[key];
    const base = (existing && existing.status === 'active' && existing.expiresAt > now) ? existing.expiresAt : now;
    data.memberships[key] = {
        channelId: String(channelId),
        userId: String(userId),
        expiresAt: base + days * DAY_MS,
        status: 'active',
        autoRenew: !!(meta && meta.autoRenew),
        planId: (meta && meta.planId) || null,
        bundleId: (meta && meta.bundleId) || null,
        renewInvoiceSentFor: null // expiresAt value we last sent an auto-renew invoice for, to avoid spamming
    };
    saveData(data);
    return data.memberships[key];
}

function getMembership(channelId, userId) {
    const data = loadData();
    return data.memberships[memberKey(channelId, userId)] || null;
}

function setMembershipStatus(channelId, userId, status) {
    const data = loadData();
    const key = memberKey(channelId, userId);
    if (data.memberships[key]) {
        data.memberships[key].status = status;
        saveData(data);
    }
}

function setAutoRenew(channelId, userId, value) {
    const data = loadData();
    const key = memberKey(channelId, userId);
    if (data.memberships[key]) {
        data.memberships[key].autoRenew = !!value;
        saveData(data);
    }
}

function markRenewInvoiceSent(channelId, userId, forExpiresAt) {
    const data = loadData();
    const key = memberKey(channelId, userId);
    if (data.memberships[key]) {
        data.memberships[key].renewInvoiceSentFor = forExpiresAt;
        saveData(data);
    }
}

function getAllMemberships() {
    const data = loadData();
    return Object.values(data.memberships);
}

function getUserMemberships(userId) {
    return getAllMemberships().filter(m => m.userId === String(userId));
}

function logPurchase(entry) {
    const data = loadData();
    data.purchases.push({ id: newId(), ts: Date.now(), ...entry });
    if (data.purchases.length > 2000) data.purchases = data.purchases.slice(-2000); // keep the file bounded
    saveData(data);
}

// ===================================================================
// Bot wiring
// ===================================================================

function register(bot, deps) {
    const { isAdmin, getKnownChats, logError } = deps;
    const chatTypeIcon = deps.chatTypeIcon || (() => '💬');
    const log = logError || ((label, err) => console.error(label, err));

    // ---- in-memory, per-admin wizard state (separate from bot.js's own
    // pendingAction map on purpose — no risk of colliding with it) ----
    const pendingAdmin = {};   // adminId -> { type, channelId? }
    const bundleWizard = {};  // adminId -> { step, selected: Set<string>, title, days, stars }

    async function sendOrEdit(ctx, text, extra) {
        if (ctx.callbackQuery) {
            try { await ctx.editMessageText(text, extra); return; } catch (e) { /* fall through */ }
        }
        await ctx.reply(text, extra);
    }

    function planLabel(plan) {
        return plan.label || `${plan.days} day${plan.days === 1 ? '' : 's'}`;
    }

    // ===== Admin: main menu =====

    async function renderSubMenu(ctx) {
        await sendOrEdit(ctx, '💳 *Subscriptions*\n\nManage paid channel access (Telegram Stars).', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📡 Channels & Plans', callback_data: 'sub_channels' }],
                    [{ text: '🎁 Bundles', callback_data: 'sub_bundles' }],
                    [{ text: '👥 Active Members', callback_data: 'sub_members' }],
                    [{ text: '🔙 Back', callback_data: 'menu_back' }]
                ]
            }
        });
    }

    bot.action('sub_menu', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery('Admins only.'); return; }
        await ctx.answerCbQuery();
        await renderSubMenu(ctx);
    });

    bot.command('subscriptions', async (ctx) => {
        if (ctx.chat.type !== 'private' || !isAdmin(ctx.from.id)) return;
        await renderSubMenu(ctx);
    });

    // ===== Admin: Channels & Plans =====

    async function renderChannelList(ctx) {
        const channels = listChannels();
        const rows = channels.map(c => [{
            text: `📡 ${c.title} (${c.plans.length} plan${c.plans.length === 1 ? '' : 's'})`,
            callback_data: `sub_ch:${c.id}`
        }]);
        rows.push([{ text: '➕ Add Channel', callback_data: 'sub_addch' }]);
        rows.push([{ text: '🔙 Back', callback_data: 'sub_menu' }]);
        await sendOrEdit(ctx, channels.length
            ? '📡 *Channels*\n\nTap a channel to manage its plans.'
            : '📡 *Channels*\n\nNo channels added yet.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows }
        });
    }

    bot.action('sub_channels', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        await renderChannelList(ctx);
    });

    bot.action('sub_addch', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        const data = loadData();
        const existing = new Set(Object.keys(data.channels));
        const known = (getKnownChats ? getKnownChats(ctx.from.id) : []).filter(c => !existing.has(String(c.id)));
        if (known.length === 0) {
            await sendOrEdit(ctx, '⚠️ No eligible channels/groups found (the bot must be added as admin there first, and it must not already be added here).', {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'sub_channels' }]] }
            });
            return;
        }
        const rows = known.slice(0, 30).map(c => [{ text: `${chatTypeIcon(c.type)} ${c.title}`, callback_data: `sub_addch1:${c.id}` }]);
        rows.push([{ text: '🔙 Back', callback_data: 'sub_channels' }]);
        await sendOrEdit(ctx, '➕ *Add Channel*\n\nPick which one to enable paid access for:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows }
        });
    });

    bot.action(/^sub_addch1:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        const channelId = ctx.match[1];
        let title = channelId;
        try { title = (await ctx.telegram.getChat(channelId)).title || channelId; } catch (e) { /* keep id as title */ }
        addChannel(channelId, title);
        await ctx.answerCbQuery('✅ Added');
        await renderChannelDetail(ctx, channelId);
    });

    async function renderChannelDetail(ctx, channelId) {
        const ch = getChannel(channelId);
        if (!ch) { await renderChannelList(ctx); return; }
        const rows = ch.plans.map(p => [{ text: `${planLabel(p)} — ${p.stars}⭐`, callback_data: `sub_plan:${channelId}:${p.id}` }]);
        rows.push([{ text: '➕ Add Plan', callback_data: `sub_addplan:${channelId}` }]);
        rows.push([{ text: '🗑 Remove Channel', callback_data: `sub_rmch:${channelId}` }]);
        rows.push([{ text: '🔙 Back', callback_data: 'sub_channels' }]);
        await sendOrEdit(ctx, `📡 *${ch.title}*\n\n${ch.plans.length ? 'Plans:' : 'No plans yet — add one below.'}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows }
        });
    }

    bot.action(/^sub_ch:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        await renderChannelDetail(ctx, ctx.match[1]);
    });

    bot.action(/^sub_addplan:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        pendingAdmin[ctx.from.id] = { type: 'add_plan', channelId: ctx.match[1] };
        await sendOrEdit(ctx, '✏️ Send the plan as:\n`DAYS STARS [label]`\n\nExamples:\n`1 30`\n`7 150 Weekly Pass`\n\nOr /cancel.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: `sub_ch:${ctx.match[1]}` }]] }
        });
    });

    bot.action(/^sub_plan:(-?\d+):(\w+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        const [, channelId, planId] = ctx.match;
        const plan = getPlan(channelId, planId);
        if (!plan) { await renderChannelDetail(ctx, channelId); return; }
        await sendOrEdit(ctx, `📋 *${planLabel(plan)}*\n\nPrice: ${plan.stars}⭐\nDuration: ${plan.days} day(s)`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🗑 Delete Plan', callback_data: `sub_rmplan:${channelId}:${planId}` }],
                    [{ text: '🔙 Back', callback_data: `sub_ch:${channelId}` }]
                ]
            }
        });
    });

    bot.action(/^sub_rmplan:(-?\d+):(\w+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        removePlan(ctx.match[1], ctx.match[2]);
        await ctx.answerCbQuery('🗑 Deleted');
        await renderChannelDetail(ctx, ctx.match[1]);
    });

    bot.action(/^sub_rmch:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        removeChannel(ctx.match[1]);
        await ctx.answerCbQuery('🗑 Removed');
        await renderChannelList(ctx);
    });

    // ===== Admin: Bundles =====

    async function renderBundleList(ctx) {
        const bundles = listBundles();
        const rows = bundles.map(b => [{
            text: `🎁 ${b.title} — ${b.days}d — ${b.stars}⭐ (${b.channelIds.length} ch)`,
            callback_data: `sub_bd:${b.id}`
        }]);
        rows.push([{ text: '➕ Add Bundle', callback_data: 'sub_addbundle' }]);
        rows.push([{ text: '🔙 Back', callback_data: 'sub_menu' }]);
        await sendOrEdit(ctx, bundles.length ? '🎁 *Bundles*' : '🎁 *Bundles*\n\nNo bundles yet.', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows }
        });
    }

    bot.action('sub_bundles', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        await renderBundleList(ctx);
    });

    async function renderBundleWizardPick(ctx) {
        const wiz = bundleWizard[ctx.from.id];
        const channels = listChannels();
        const rows = channels.map(c => [{
            text: `${wiz.selected.has(c.id) ? '✅' : '⬜'} ${c.title}`,
            callback_data: `sub_bdsel:${c.id}`
        }]);
        rows.push([{ text: `▶️ Done (${wiz.selected.size} selected)`, callback_data: 'sub_bddone' }]);
        rows.push([{ text: '🔙 Cancel', callback_data: 'sub_bundles' }]);
        await sendOrEdit(ctx, '🎁 *Add Bundle*\n\nTap channels to include, then Done:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: rows }
        });
    }

    bot.action('sub_addbundle', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        if (listChannels().length < 2) {
            await ctx.answerCbQuery('Add at least 2 channels first.', { show_alert: true });
            return;
        }
        await ctx.answerCbQuery();
        bundleWizard[ctx.from.id] = { step: 'pick', selected: new Set() };
        await renderBundleWizardPick(ctx);
    });

    bot.action(/^sub_bdsel:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        const wiz = bundleWizard[ctx.from.id];
        if (!wiz) { await ctx.answerCbQuery('⚠️ Session expired.'); return; }
        const id = ctx.match[1];
        if (wiz.selected.has(id)) wiz.selected.delete(id); else wiz.selected.add(id);
        await ctx.answerCbQuery();
        await renderBundleWizardPick(ctx);
    });

    bot.action('sub_bddone', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        const wiz = bundleWizard[ctx.from.id];
        if (!wiz) { await ctx.answerCbQuery('⚠️ Session expired.'); return; }
        if (wiz.selected.size < 2) { await ctx.answerCbQuery('Pick at least 2 channels.', { show_alert: true }); return; }
        wiz.step = 'meta';
        await ctx.answerCbQuery();
        pendingAdmin[ctx.from.id] = { type: 'add_bundle' };
        await sendOrEdit(ctx, '✏️ Send the bundle as:\n`TITLE | DAYS STARS`\n\nExample:\n`All Access | 7 300`\n\nOr /cancel.', { parse_mode: 'Markdown' });
    });

    async function renderBundleDetail(ctx, bundleId) {
        const b = getBundle(bundleId);
        if (!b) { await renderBundleList(ctx); return; }
        const titles = b.channelIds.map(id => (getChannel(id) || {}).title || id).join(', ');
        await sendOrEdit(ctx, `🎁 *${b.title}*\n\nChannels: ${titles}\nDuration: ${b.days} day(s)\nPrice: ${b.stars}⭐`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🗑 Delete Bundle', callback_data: `sub_rmbd:${bundleId}` }],
                    [{ text: '🔙 Back', callback_data: 'sub_bundles' }]
                ]
            }
        });
    }

    bot.action(/^sub_bd:(\w+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        await renderBundleDetail(ctx, ctx.match[1]);
    });

    bot.action(/^sub_rmbd:(\w+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        removeBundle(ctx.match[1]);
        await ctx.answerCbQuery('🗑 Removed');
        await renderBundleList(ctx);
    });

    // ===== Admin: Active Members =====

    async function renderMembersOverview(ctx) {
        const now = Date.now();
        const channels = listChannels();
        const rows = channels.map(c => {
            const count = getAllMemberships().filter(m => m.channelId === c.id && m.status === 'active' && m.expiresAt > now).length;
            return [{ text: `📡 ${c.title} — ${count} active`, callback_data: `sub_memch:${c.id}` }];
        });
        rows.push([{ text: '🔙 Back', callback_data: 'sub_menu' }]);
        await sendOrEdit(ctx, '👥 *Active Members*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    }

    bot.action('sub_members', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        await renderMembersOverview(ctx);
    });

    bot.action(/^sub_memch:(-?\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        await ctx.answerCbQuery();
        const channelId = ctx.match[1];
        const now = Date.now();
        const active = getAllMemberships()
            .filter(m => m.channelId === channelId && m.status === 'active' && m.expiresAt > now)
            .sort((a, b) => a.expiresAt - b.expiresAt)
            .slice(0, 25);
        if (active.length === 0) {
            await sendOrEdit(ctx, 'No active members here right now.', {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'sub_members' }]] }
            });
            return;
        }
        const lines = active.map(m => `• \`${m.userId}\` — expires ${new Date(m.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${m.autoRenew ? ' 🔁' : ''}`);
        const rows = active.map(m => [{ text: `🗑 Revoke ${m.userId}`, callback_data: `sub_revoke:${channelId}:${m.userId}` }]);
        rows.push([{ text: '🔙 Back', callback_data: 'sub_members' }]);
        await sendOrEdit(ctx, `👥 *Active in this channel*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    });

    bot.action(/^sub_revoke:(-?\d+):(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { await ctx.answerCbQuery(); return; }
        const [, channelId, userId] = ctx.match;
        try {
            await ctx.telegram.banChatMember(channelId, userId);
            await ctx.telegram.unbanChatMember(channelId, userId, { only_if_banned: true });
        } catch (e) { log('sub_revoke kick', e); }
        setMembershipStatus(channelId, userId, 'revoked');
        await ctx.answerCbQuery('✅ Revoked');
        try { await ctx.telegram.sendMessage(userId, `🚫 Your access to a channel was revoked by the admin.`); } catch (e) { /* user may have blocked the bot */ }
        await renderMembersOverview(ctx);
    });

    // ===== Admin: text-input dispatch (add_plan / add_bundle) =====
    // Uses its own pendingAdmin map so it never touches bot.js's pendingAction.

    async function handleAdminText(ctx, text) {
        const pending = pendingAdmin[ctx.from.id];
        if (!pending) return false;

        if (text.trim() === '/cancel') {
            delete pendingAdmin[ctx.from.id];
            await ctx.reply('❌ Cancelled.');
            return true;
        }

        if (pending.type === 'add_plan') {
            const parts = text.trim().split(/\s+/);
            const days = parseInt(parts[0], 10);
            const stars = parseInt(parts[1], 10);
            const label = parts.slice(2).join(' ') || null;
            if (!days || days <= 0 || !stars || stars <= 0) {
                await ctx.reply('⚠️ Send: `DAYS STARS [label]`, e.g. `7 150 Weekly`. Or /cancel.', { parse_mode: 'Markdown' });
                return true;
            }
            addPlan(pending.channelId, days, stars, label);
            delete pendingAdmin[ctx.from.id];
            const ch = getChannel(pending.channelId);
            await ctx.reply(`✅ Plan added to ${ch ? ch.title : pending.channelId}: ${days} day(s) — ${stars}⭐${label ? ` (${label})` : ''}`, {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Channel', callback_data: `sub_ch:${pending.channelId}` }]] }
            });
            return true;
        }

        if (pending.type === 'add_bundle') {
            const wiz = bundleWizard[ctx.from.id];
            if (!wiz) { delete pendingAdmin[ctx.from.id]; await ctx.reply('⚠️ Session expired. Start again from Bundles.'); return true; }
            const m = text.match(/^(.+?)\|\s*(\d+)\s+(\d+)\s*$/);
            if (!m) {
                await ctx.reply('⚠️ Send: `TITLE | DAYS STARS`, e.g. `All Access | 7 300`. Or /cancel.', { parse_mode: 'Markdown' });
                return true;
            }
            const title = m[1].trim();
            const days = parseInt(m[2], 10);
            const stars = parseInt(m[3], 10);
            const bundle = addBundle(title, Array.from(wiz.selected), days, stars);
            delete pendingAdmin[ctx.from.id];
            delete bundleWizard[ctx.from.id];
            await ctx.reply(`✅ Bundle created: ${bundle.title} — ${days}d — ${stars}⭐`, {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Bundles', callback_data: 'sub_bundles' }]] }
            });
            return true;
        }

        return false;
    }

    // ===== User: /subscribe purchase flow =====

    async function renderUserCatalog(ctx) {
        const channels = listChannels().filter(c => c.plans.length > 0);
        const bundles = listBundles();
        if (channels.length === 0 && bundles.length === 0) {
            await sendOrEdit(ctx, '📭 No subscriptions are available right now.');
            return;
        }
        const rows = [
            ...channels.map(c => [{ text: `📡 ${c.title}`, callback_data: `subu_ch:${c.id}` }]),
            ...bundles.map(b => [{ text: `🎁 ${b.title} — ${b.days}d — ${b.stars}⭐`, callback_data: `subu_bd:${b.id}` }])
        ];
        await sendOrEdit(ctx, '💳 *Choose a subscription:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    }

    bot.command('subscribe', async (ctx) => {
        if (ctx.chat.type !== 'private') return;
        await renderUserCatalog(ctx);
    });

    bot.action('subu_menu', async (ctx) => { await ctx.answerCbQuery(); await renderUserCatalog(ctx); });

    bot.action(/^subu_ch:(-?\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const ch = getChannel(ctx.match[1]);
        if (!ch) { await renderUserCatalog(ctx); return; }
        const rows = ch.plans.map(p => [{ text: `${planLabel(p)} — ${p.stars}⭐`, callback_data: `subu_plan:${ch.id || ctx.match[1]}:${p.id}` }]);
        rows.push([{ text: '🔙 Back', callback_data: 'subu_menu' }]);
        await sendOrEdit(ctx, `📡 *${ch.title}*\n\nPick a plan:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    });

    bot.action(/^subu_plan:(-?\d+):(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const [, channelId, planId] = ctx.match;
        const plan = getPlan(channelId, planId);
        if (!plan) return;
        await sendOrEdit(ctx, `💳 *${planLabel(plan)}* — ${plan.stars}⭐\n\nAuto-renew? The bot will send you a renewal invoice shortly before it expires so you don't lose access — you still tap Pay each time.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔁 Pay with Auto-Renew ON', callback_data: `subu_go:${channelId}:${planId}:1` }],
                    [{ text: '➡️ Pay (Auto-Renew OFF)', callback_data: `subu_go:${channelId}:${planId}:0` }],
                    [{ text: '🔙 Back', callback_data: `subu_ch:${channelId}` }]
                ]
            }
        });
    });

    bot.action(/^subu_go:(-?\d+):(\w+):([01])$/, async (ctx) => {
        await ctx.answerCbQuery();
        const [, channelId, planId, ar] = ctx.match;
        const ch = getChannel(channelId);
        const plan = getPlan(channelId, planId);
        if (!ch || !plan) return;
        await ctx.telegram.sendInvoice(ctx.from.id, {
            title: `${ch.title} — ${planLabel(plan)}`,
            description: `Access to "${ch.title}" for ${plan.days} day(s).`,
            payload: `p:${channelId}:${planId}:${ar}`,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: planLabel(plan), amount: plan.stars }]
        });
    });

    bot.action(/^subu_bd:(\w+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const b = getBundle(ctx.match[1]);
        if (!b) { await renderUserCatalog(ctx); return; }
        const titles = b.channelIds.map(id => (getChannel(id) || {}).title || id).join(', ');
        await sendOrEdit(ctx, `🎁 *${b.title}*\n\nIncludes: ${titles}\n${b.days} day(s) — ${b.stars}⭐\n\nAuto-renew? The bot will send a renewal invoice shortly before it expires — you still tap Pay each time.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔁 Pay with Auto-Renew ON', callback_data: `subu_bgo:${b.id}:1` }],
                    [{ text: '➡️ Pay (Auto-Renew OFF)', callback_data: `subu_bgo:${b.id}:0` }],
                    [{ text: '🔙 Back', callback_data: 'subu_menu' }]
                ]
            }
        });
    });

    bot.action(/^subu_bgo:(\w+):([01])$/, async (ctx) => {
        await ctx.answerCbQuery();
        const [, bundleId, ar] = ctx.match;
        const b = getBundle(bundleId);
        if (!b) return;
        await ctx.telegram.sendInvoice(ctx.from.id, {
            title: b.title,
            description: `Bundle access to ${b.channelIds.length} channels for ${b.days} day(s).`,
            payload: `b:${bundleId}:${ar}`,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: b.title, amount: b.stars }]
        });
    });

    // ===== User: /mysubscriptions + auto-renew toggle =====

    async function renderMySubs(ctx) {
        const now = Date.now();
        const mine = getUserMemberships(ctx.from.id).filter(m => m.status === 'active' && m.expiresAt > now);
        if (mine.length === 0) {
            await sendOrEdit(ctx, "You don't have any active subscriptions.", {
                reply_markup: { inline_keyboard: [[{ text: '💳 Browse Subscriptions', callback_data: 'subu_menu' }]] }
            });
            return;
        }
        const rows = mine.map(m => {
            const ch = getChannel(m.channelId);
            const title = ch ? ch.title : m.channelId;
            const when = new Date(m.expiresAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
            return [{ text: `${m.autoRenew ? '🔁' : '⏸'} ${title} — until ${when}`, callback_data: `subu_toggle:${m.channelId}` }];
        });
        await sendOrEdit(ctx, '📋 *Your Subscriptions*\n\nTap one to toggle Auto-Renew.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    }

    bot.command('mysubscriptions', async (ctx) => {
        if (ctx.chat.type !== 'private') return;
        await renderMySubs(ctx);
    });

    bot.action(/^subu_toggle:(-?\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const m = getMembership(ctx.match[1], ctx.from.id);
        if (!m) return;
        setAutoRenew(ctx.match[1], ctx.from.id, !m.autoRenew);
        await renderMySubs(ctx);
    });

    // ===== Payment handling =====

    bot.on('pre_checkout_query', async (ctx) => {
        try { await ctx.answerPreCheckoutQuery(true); } catch (e) { log('pre_checkout_query', e); }
    });

    async function deliverInviteLink(ctx, channelId) {
        const ch = getChannel(channelId);
        const title = ch ? ch.title : channelId;
        try {
            const link = await ctx.telegram.createChatInviteLink(channelId, {
                member_limit: 1,
                expire_date: Math.floor(Date.now() / 1000) + 30 * 60 // 30 min to use it
            });
            await ctx.telegram.sendMessage(ctx.from.id, `✅ Payment received!\n\n📡 *${title}*\nTap to join (single-use, valid 30 min):\n${link.invite_link}`, { parse_mode: 'Markdown' });
        } catch (e) {
            log('deliverInviteLink', e);
            try { await ctx.telegram.sendMessage(ctx.from.id, `✅ Payment received for *${title}*, but I couldn't create the invite link — please contact the admin.`, { parse_mode: 'Markdown' }); } catch (e2) { /* ignore */ }
        }
    }

    async function handleSuccessfulPayment(ctx) {
        const sp = ctx.message.successful_payment;
        const payload = sp.invoice_payload || '';
        const parts = payload.split(':');

        if (parts[0] === 'p') {
            const [, channelId, planId, ar] = parts;
            const plan = getPlan(channelId, planId);
            if (!plan) { log('successful_payment', new Error(`Unknown plan in payload: ${payload}`)); return; }
            createOrExtendMembership(channelId, ctx.from.id, plan.days, { planId, autoRenew: ar === '1' });
            logPurchase({ userId: ctx.from.id, channelId, planId, stars: sp.total_amount, kind: 'plan' });
            await deliverInviteLink(ctx, channelId);
        } else if (parts[0] === 'b') {
            const [, bundleId, ar] = parts;
            const bundle = getBundle(bundleId);
            if (!bundle) { log('successful_payment', new Error(`Unknown bundle in payload: ${payload}`)); return; }
            for (const channelId of bundle.channelIds) {
                createOrExtendMembership(channelId, ctx.from.id, bundle.days, { bundleId, autoRenew: ar === '1' });
                await deliverInviteLink(ctx, channelId);
            }
            logPurchase({ userId: ctx.from.id, bundleId, stars: sp.total_amount, kind: 'bundle' });
        }
    }

    // ===== The one early catch-all middleware =====
    // Registered first (see register() below) so it always sees updates
    // before bot.js's own handlers. It only ever *consumes* an update
    // (skips next()) for things this module owns: successful payments,
    // and admin text replies while a sub_* wizard is pending. Everything
    // else calls next() so the rest of bot.js behaves exactly as before.
    bot.use(async (ctx, next) => {
        try {
            if (ctx.message && ctx.message.successful_payment) {
                await handleSuccessfulPayment(ctx);
                return;
            }
            if (ctx.chat && ctx.chat.type === 'private' && ctx.message && typeof ctx.message.text === 'string' && isAdmin(ctx.from.id) && pendingAdmin[ctx.from.id]) {
                const consumed = await handleAdminText(ctx, ctx.message.text);
                if (consumed) return;
            }
        } catch (e) {
            log('subscriptions middleware', e);
        }
        return next();
    });

    // ===== Background: expiry sweep + auto-renew reminder =====

    async function checkExpiries() {
        const now = Date.now();
        const due = getAllMemberships().filter(m => m.status === 'active' && m.expiresAt <= now);
        for (const m of due) {
            const ch = getChannel(m.channelId);
            try {
                await bot.telegram.banChatMember(m.channelId, m.userId);
                await bot.telegram.unbanChatMember(m.channelId, m.userId, { only_if_banned: true });
            } catch (e) {
                log(`Subscription kick ${m.channelId}/${m.userId}`, e);
            }
            setMembershipStatus(m.channelId, m.userId, 'expired');
            try {
                await bot.telegram.sendMessage(m.userId,
                    `⏳ Your access to "${ch ? ch.title : m.channelId}" has expired and you've been removed.`,
                    { reply_markup: { inline_keyboard: [[{ text: '🔁 Renew', callback_data: `subu_ch:${m.channelId}` }]] } }
                );
            } catch (e) { /* user may have blocked the bot */ }
        }
    }

    async function checkAutoRenewals() {
        const now = Date.now();
        const soon = getAllMemberships().filter(m =>
            m.status === 'active' &&
            m.autoRenew &&
            m.expiresAt > now &&
            m.expiresAt - now <= AUTO_RENEW_WINDOW_MS &&
            m.renewInvoiceSentFor !== m.expiresAt
        );
        const sentForUserBundle = new Set(); // avoid sending one invoice per channel for the same bundle
        for (const m of soon) {
            try {
                if (m.bundleId) {
                    const dedupeKey = `${m.userId}:${m.bundleId}`;
                    if (sentForUserBundle.has(dedupeKey)) { markRenewInvoiceSent(m.channelId, m.userId, m.expiresAt); continue; }
                    sentForUserBundle.add(dedupeKey);
                    const b = getBundle(m.bundleId);
                    if (!b) continue;
                    await bot.telegram.sendMessage(m.userId, `🔁 Your bundle "${b.title}" renews soon. Tap to pay and keep access:`, {
                        reply_markup: { inline_keyboard: [[{ text: `Renew — ${b.stars}⭐`, callback_data: `subu_bgo:${b.id}:1` }]] }
                    });
                } else if (m.planId) {
                    const plan = getPlan(m.channelId, m.planId);
                    const ch = getChannel(m.channelId);
                    if (!plan || !ch) continue;
                    await bot.telegram.sendMessage(m.userId, `🔁 Your access to "${ch.title}" renews soon. Tap to pay and keep access:`, {
                        reply_markup: { inline_keyboard: [[{ text: `Renew — ${plan.stars}⭐`, callback_data: `subu_go:${m.channelId}:${m.planId}:1` }]] }
                    });
                }
                markRenewInvoiceSent(m.channelId, m.userId, m.expiresAt);
            } catch (e) {
                log(`Auto-renew invoice ${m.channelId}/${m.userId}`, e);
            }
        }
    }

    setInterval(() => { checkExpiries().catch(e => log('Subscription expiry sweep', e)); }, 60 * 1000);
    setInterval(() => { checkAutoRenewals().catch(e => log('Subscription auto-renew sweep', e)); }, 5 * 60 * 1000);
}

module.exports = {
    register,
    // exported for tests / admin tooling if ever needed
    addChannel, removeChannel, listChannels, getChannel, addPlan, removePlan, getPlan,
    addBundle, removeBundle, listBundles, getBundle,
    createOrExtendMembership, getMembership, getAllMemberships, getUserMemberships, setAutoRenew
};
