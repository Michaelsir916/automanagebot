const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(DATA_DIR, 'payments.json');

// Payment lifecycle (one record per Telegram charge, never deleted):
//   received  - Telegram confirmed the charge, wallet credit not finished yet
//   credited  - wallet credited, everything done
//   rejected  - charge arrived but failed validation; NOT credited, needs an admin
//   refunding - a Stars refund was started and not confirmed yet
//   refunded  - Telegram confirmed the Stars refund
// Records written by older versions have no status and count as "credited".
const STATUSES = ['received', 'credited', 'rejected', 'refunding', 'refunded'];

function loadAll() {
  return readJSON(FILE, { payments: [] });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function statusOf(p) {
  return p.status || 'credited';
}

// Legacy helper kept for callers that only know "a payment happened".
function add(userId, stars, chargeId, meta = {}) {
  const data = loadAll();
  const payment = {
    id: genId('pay'),
    userId,
    stars,
    telegramPaymentChargeId: chargeId,
    date: new Date().toISOString(),
    status: 'credited',
    ...meta
  };
  data.payments.push(payment);
  saveAll(data);
  return payment;
}

// Idempotent insert keyed by the Telegram charge ID. Returns the existing
// record (created: false) when this charge was already seen, so a re-delivered
// update can never create a second payment.
function begin({ chargeId, providerChargeId = '', userId, stars, currency = 'XTR', payload = '', status = 'received', note = '' }) {
  if (!chargeId) throw new Error('chargeId is required');
  const data = loadAll();
  const existing = data.payments.find(p => p.telegramPaymentChargeId === chargeId);
  if (existing) return { record: existing, created: false };
  const record = {
    id: genId('pay'),
    userId: String(userId),
    stars,
    currency,
    telegramPaymentChargeId: chargeId,
    providerPaymentChargeId: providerChargeId || '',
    payload,
    date: new Date().toISOString(),
    status,
    note
  };
  data.payments.push(record);
  saveAll(data);
  return { record, created: true };
}

function setStatus(chargeId, status, patch = {}) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown payment status: ${status}`);
  const data = loadAll();
  const p = data.payments.find(x => x.telegramPaymentChargeId === chargeId);
  if (!p) return null;
  p.status = status;
  p.statusAt = new Date().toISOString();
  Object.assign(p, patch);
  saveAll(data);
  return p;
}

function getByCharge(chargeId) {
  if (!chargeId) return null;
  return loadAll().payments.find(p => p.telegramPaymentChargeId === chargeId) || null;
}

function listByStatus(status) {
  return loadAll().payments.filter(p => statusOf(p) === status);
}

function listByUser(userId) {
  return loadAll().payments.filter(p => String(p.userId) === String(userId));
}

function listAll() {
  return loadAll().payments;
}

function hasCharge(chargeId) {
  return !!getByCharge(chargeId);
}

module.exports = { add, begin, setStatus, getByCharge, listByStatus, listByUser, listAll, hasCharge, statusOf, STATUSES };
