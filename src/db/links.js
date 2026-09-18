const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'links.json');

function loadAll() {
  return readJSON(FILE, { links: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function add(link) {
  const data = loadAll();
  data.links[link.id] = link;
  saveAll(data);
  return link;
}

function getById(id) {
  return loadAll().links[id] || null;
}

function update(id, patch) {
  const data = loadAll();
  if (!data.links[id]) return null;
  data.links[id] = { ...data.links[id], ...patch };
  saveAll(data);
  return data.links[id];
}

// Find a still-pending link matching this chat + exact invite link string
function findPendingByInvite(chatId, inviteLinkStr) {
  const data = loadAll();
  return Object.values(data.links).find(
    l => l.status === 'pending' && String(l.chatId) === String(chatId) && l.inviteLink === inviteLinkStr
  ) || null;
}

// Find a link that was already marked used for this chat + invite string
function findUsedByInvite(chatId, inviteLinkStr) {
  const data = loadAll();
  return Object.values(data.links).find(
    l => l.status === 'used' && String(l.chatId) === String(chatId) && l.inviteLink === inviteLinkStr
  ) || null;
}

function listByOwner(userId) {
  const data = loadAll();
  return Object.values(data.links).filter(l => String(l.ownerUserId) === String(userId));
}

function listAll() {
  return Object.values(loadAll().links);
}

module.exports = { add, getById, update, findPendingByInvite, findUsedByInvite, listByOwner, listAll };
