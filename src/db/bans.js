const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'bans.json');

function loadAll() {
  return readJSON(FILE, { banned: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function isBanned(userId) {
  return !!loadAll().banned[String(userId)];
}
function ban(userId, reason, bannedBy) {
  const data = loadAll();
  data.banned[String(userId)] = { reason, bannedAt: new Date().toISOString(), bannedBy };
  saveAll(data);
}
function unban(userId) {
  const data = loadAll();
  delete data.banned[String(userId)];
  saveAll(data);
}
function list() {
  const data = loadAll();
  return Object.entries(data.banned).map(([id, v]) => ({ id, ...v }));
}

module.exports = { isBanned, ban, unban, list };
