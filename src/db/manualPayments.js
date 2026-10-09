const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(__dirname, '..', '..', 'data', 'manualPayments.json');

// status: 'awaiting_proof' | 'pending' | 'approved' | 'rejected' | 'cancelled'
function loadAll() { return readJSON(FILE, { items: {} }); }
function saveAll(d) { writeJSON(FILE, d); }

function create(userId, rupees, stars) {
  const data = loadAll();
  const item = {
    id: genId('upi'), userId: String(userId), rupees, stars,
    status: 'awaiting_proof', fileUniqueId: null, fileId: null,
    createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null
  };
  data.items[item.id] = item;
  saveAll(data);
  return item;
}

function get(id) { return loadAll().items[id] || null; }

function update(id, patch) {
  const data = loadAll();
  if (!data.items[id]) return null;
  data.items[id] = { ...data.items[id], ...patch };
  saveAll(data);
  return data.items[id];
}

function getAwaitingProof(userId) {
  return Object.values(loadAll().items).find(i => i.userId === String(userId) && i.status === 'awaiting_proof') || null;
}

function proofAlreadyUsed(fileUniqueId) {
  return Object.values(loadAll().items).some(i => i.fileUniqueId === fileUniqueId && ['pending', 'approved'].includes(i.status));
}

function listPending() {
  return Object.values(loadAll().items).filter(i => i.status === 'pending');
}

function listAll() { return Object.values(loadAll().items); }

module.exports = { create, get, update, getAwaitingProof, proofAlreadyUsed, listPending, listAll };
