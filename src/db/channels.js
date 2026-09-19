const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'channels.json');

function loadAll() {
  return readJSON(FILE, { channels: [] });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function list() {
  return loadAll().channels;
}
function listActive() {
  return list().filter(c => c.active);
}
function getById(id) {
  return list().find(c => c.id === id) || null;
}
function getByChatId(chatId) {
  return list().find(c => String(c.chatId) === String(chatId)) || null;
}
function add(channel) {
  const data = loadAll();
  data.channels.push(channel);
  saveAll(data);
  return channel;
}
function update(id, patch) {
  const data = loadAll();
  const idx = data.channels.findIndex(c => c.id === id);
  if (idx === -1) return null;
  data.channels[idx] = { ...data.channels[idx], ...patch };
  saveAll(data);
  return data.channels[idx];
}
function remove(id) {
  const data = loadAll();
  data.channels = data.channels.filter(c => c.id !== id);
  saveAll(data);
}

module.exports = { list, listActive, getById, getByChatId, add, update, remove };
