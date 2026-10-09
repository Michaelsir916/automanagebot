const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'tickets.json');

function loadAll() { return readJSON(FILE, { seq: 0, tickets: {} }); }
function saveAll(d) { writeJSON(FILE, d); }

function getOpenByUser(userId) {
  return Object.values(loadAll().tickets).find(t => t.userId === String(userId) && t.status === 'open') || null;
}

function open(userId, text) {
  const data = loadAll();
  data.seq += 1;
  const t = {
    no: data.seq, userId: String(userId), status: 'open',
    createdAt: new Date().toISOString(), closedAt: null, closedBy: null,
    messages: [{ from: 'user', text: String(text).slice(0, 2000), at: new Date().toISOString() }]
  };
  data.tickets[String(t.no)] = t;
  saveAll(data);
  return t;
}

function addMessage(no, from, text) {
  const data = loadAll();
  const t = data.tickets[String(no)];
  if (!t) return null;
  t.messages.push({ from, text: String(text).slice(0, 2000), at: new Date().toISOString() });
  saveAll(data);
  return t;
}

function close(no, adminId) {
  const data = loadAll();
  const t = data.tickets[String(no)];
  if (!t || t.status === 'closed') return null;
  t.status = 'closed';
  t.closedAt = new Date().toISOString();
  t.closedBy = String(adminId);
  saveAll(data);
  return t;
}

function get(no) { return loadAll().tickets[String(no)] || null; }
function listOpen() { return Object.values(loadAll().tickets).filter(t => t.status === 'open'); }

module.exports = { getOpenByUser, open, addMessage, close, get, listOpen };
