const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(DATA_DIR, 'refunds.json');

// Append-only refund ledger. Every refund is its own record with a unique
// `key`, so pressing a refund button twice (or retrying after a crash) finds
// the same record instead of paying out twice.
//   kind:   'stars'          - Telegram Stars returned to the payer via refundStarPayment
//           'wallet_credit'  - wallet balance credited back (failed delivery, link misuse)
//   status: 'pending' -> 'completed' | 'failed'

function loadAll() { return readJSON(FILE, { refunds: [] }); }
function saveAll(data) { writeJSON(FILE, data); }

function begin(key, fields) {
  const data = loadAll();
  const existing = data.refunds.find(r => r.key === key);
  if (existing) return { record: existing, created: false };
  const now = new Date().toISOString();
  const record = { id: genId('rf'), key, status: 'pending', createdAt: now, updatedAt: now, ...fields };
  data.refunds.push(record);
  saveAll(data);
  return { record, created: true };
}

function update(key, patch) {
  const data = loadAll();
  const r = data.refunds.find(x => x.key === key);
  if (!r) return null;
  Object.assign(r, patch, { updatedAt: new Date().toISOString() });
  saveAll(data);
  return r;
}

function getByKey(key) { return loadAll().refunds.find(r => r.key === key) || null; }
function listAll() { return loadAll().refunds; }
function listPending() { return loadAll().refunds.filter(r => r.status === 'pending'); }

module.exports = { begin, update, getByKey, listAll, listPending };
