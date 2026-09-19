const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'removedMembers.json');

function loadAll() {
  return readJSON(FILE, { removed: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function key(channelId, userId) {
  return `${channelId}:${userId}`;
}

// Someone who was kicked (subscription expiry, misuse, etc.) lands here.
// While they're on this list for a channel, a join request for that
// channel is blocked even if the invite link itself would otherwise match -
// they're only let back in once they're removed from this list, which
// happens automatically the moment they buy fresh access again.
function add(channelId, userId, reason) {
  const data = loadAll();
  data.removed[key(channelId, userId)] = {
    channelId,
    userId: String(userId),
    reason,
    removedAt: new Date().toISOString()
  };
  saveAll(data);
}

function remove(channelId, userId) {
  const data = loadAll();
  const k = key(channelId, userId);
  if (!data.removed[k]) return false;
  delete data.removed[k];
  saveAll(data);
  return true;
}

function isRemoved(channelId, userId) {
  return !!loadAll().removed[key(channelId, userId)];
}

function list() {
  return Object.values(loadAll().removed);
}

module.exports = { add, remove, isRemoved, list };
