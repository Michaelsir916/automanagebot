const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(__dirname, '..', '..', 'data', 'wallets.json');

function loadAll() {
  return readJSON(FILE, { wallets: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function getWallet(userId) {
  const data = loadAll();
  const key = String(userId);
  if (!data.wallets[key]) {
    data.wallets[key] = { balance: 0, transactions: [] };
    saveAll(data);
  }
  return data.wallets[key];
}

function getBalance(userId) {
  return getWallet(userId).balance;
}

// amount can be positive (credit) or negative (debit). Always returns the
// updated wallet so callers can read the new balance immediately.
function addTransaction(userId, amount, type, meta = {}) {
  const data = loadAll();
  const key = String(userId);
  if (!data.wallets[key]) data.wallets[key] = { balance: 0, transactions: [] };

  data.wallets[key].balance = Math.round((data.wallets[key].balance + amount) * 100) / 100;
  data.wallets[key].transactions.push({
    id: genId('txn'),
    type,
    amount,
    balanceAfter: data.wallets[key].balance,
    date: new Date().toISOString(),
    ...meta
  });

  saveAll(data);
  return data.wallets[key];
}

function canAfford(userId, price) {
  return getBalance(userId) >= price;
}

// Users who have recharged at least once (used for "paid users" broadcast)
function listUsersWithRecharge() {
  const data = loadAll();
  return Object.entries(data.wallets)
    .filter(([, w]) => w.transactions.some(t => t.type === 'recharge'))
    .map(([id]) => id);
}

module.exports = { getWallet, getBalance, addTransaction, canAfford, listUsersWithRecharge };
