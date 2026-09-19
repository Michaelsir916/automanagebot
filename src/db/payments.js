const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(__dirname, '..', '..', 'data', 'payments.json');

function loadAll() {
  return readJSON(FILE, { payments: [] });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function add(userId, stars, chargeId, meta = {}) {
  const data = loadAll();
  const payment = {
    id: genId('pay'),
    userId,
    stars,
    telegramPaymentChargeId: chargeId,
    date: new Date().toISOString(),
    ...meta
  };
  data.payments.push(payment);
  saveAll(data);
  return payment;
}

function listByUser(userId) {
  return loadAll().payments.filter(p => String(p.userId) === String(userId));
}

function listAll() {
  return loadAll().payments;
}

module.exports = { add, listByUser, listAll };
