const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(__dirname, '..', '..', 'data', 'subscriptions.json');

function loadAll() {
  return readJSON(FILE, { subscriptions: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

// One subscription per (channelId, userId) at a time. Re-subscribing
// overwrites the previous record for that pair with a fresh expiry.
function key(channelId, userId) {
  return `${channelId}:${userId}`;
}

function start(channelId, userId, chatId, linkId, durationDays) {
  const data = loadAll();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const sub = {
    id: genId('sub'),
    channelId,
    userId: String(userId),
    chatId,
    linkId,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active'
  };
  data.subscriptions[key(channelId, userId)] = sub;
  saveAll(data);
  return sub;
}

function get(channelId, userId) {
  const data = loadAll();
  return data.subscriptions[key(channelId, userId)] || null;
}

function markExpired(channelId, userId) {
  const data = loadAll();
  const k = key(channelId, userId);
  if (!data.subscriptions[k]) return null;
  data.subscriptions[k].status = 'expired';
  saveAll(data);
  return data.subscriptions[k];
}

// All subscriptions still marked "active" whose expiry has passed -
// this is what the background sweep job acts on.
function listActiveExpired(now = new Date()) {
  const data = loadAll();
  return Object.values(data.subscriptions).filter(
    s => s.status === 'active' && new Date(s.expiresAt) <= now
  );
}

function listByUser(userId) {
  const data = loadAll();
  return Object.values(data.subscriptions).filter(s => String(s.userId) === String(userId));
}

module.exports = { start, get, markExpired, listActiveExpired, listByUser };
