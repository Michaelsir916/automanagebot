const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(DATA_DIR, 'membership_events.json');
const MAX_EVENTS = 20000;

// Append-only (capped) log of membership changes the bot actually OBSERVED
// through chat_member updates or performed itself. It starts empty on the day
// tracking is first used: Telegram's Bot API cannot list existing members or
// replay history, so nothing before `trackingSince` is known.

function loadAll() {
  return readJSON(FILE, { trackingSince: null, events: [] });
}
function saveAll(data) { writeJSON(FILE, data); }

// Map a Telegram chat_member status change onto a small, stable vocabulary.
function classify(oldStatus, newStatus, actorId, userId) {
  const wasIn = ['member', 'administrator', 'creator'].includes(oldStatus) || oldStatus === 'restricted';
  if (newStatus === 'member' && oldStatus !== 'member') return 'joined';
  if (newStatus === 'left') return 'left';
  if (newStatus === 'kicked') return String(actorId) === String(userId) ? 'banned' : 'removed';
  if (newStatus === 'restricted') return 'restricted';
  if (newStatus === 'administrator' || newStatus === 'creator') return wasIn ? 'promoted' : 'joined';
  return 'other';
}

// Returns the stored event, or null when this Telegram update was already recorded.
function record(ev) {
  const data = loadAll();
  if (ev.updateId !== undefined && ev.updateId !== null) {
    const dup = data.events.slice(-500).some(e => e.updateId === ev.updateId && String(e.userId) === String(ev.userId) && String(e.chatId) === String(ev.chatId));
    if (dup) return null;
  }
  const at = ev.at || new Date().toISOString();
  if (!data.trackingSince) data.trackingSince = at;
  const event = {
    id: genId('mev'), at,
    chatId: String(ev.chatId), channelId: ev.channelId || null, userId: String(ev.userId),
    kind: ev.kind, oldStatus: ev.oldStatus || null, newStatus: ev.newStatus || null,
    source: ev.source || 'telegram', actorId: ev.actorId ? String(ev.actorId) : null,
    inviteLink: ev.inviteLink ? 'yes' : null, // the link itself is a secret; only note that one was used
    updateId: ev.updateId ?? null, reason: ev.reason || null
  };
  data.events.push(event);
  if (data.events.length > MAX_EVENTS) data.events = data.events.slice(-MAX_EVENTS);
  saveAll(data);
  return event;
}

function trackingSince() { return loadAll().trackingSince; }

function list({ chatId = null, userId = null, limit = 20, offset = 0 } = {}) {
  let ev = loadAll().events;
  if (chatId) ev = ev.filter(e => String(e.chatId) === String(chatId));
  if (userId) ev = ev.filter(e => String(e.userId) === String(userId));
  ev = ev.slice().reverse();
  return { total: ev.length, items: ev.slice(offset, offset + limit) };
}

// Counts of observed events per kind for one chat since `since`.
function summarize(chatId, since) {
  const out = { joined: 0, left: 0, removed: 0, banned: 0, restricted: 0 };
  for (const e of loadAll().events) {
    if (String(e.chatId) !== String(chatId)) continue;
    if (since && new Date(e.at) < since) continue;
    if (out[e.kind] !== undefined) out[e.kind] += 1;
  }
  return out;
}

module.exports = { record, classify, trackingSince, list, summarize };
