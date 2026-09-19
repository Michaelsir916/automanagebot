const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'plans.json');

// A plan is either:
//   type: 'single' -> channelIds has exactly 1 channel
//   type: 'bundle'  -> channelIds has 2+ channels, all unlocked/kicked together
// Shape: { id, type, title, channelIds:[], durationDays, price, testPrice, active, createdAt, createdBy }

function loadAll() {
  return readJSON(FILE, { plans: [] });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

function list() {
  return loadAll().plans;
}
function listActive() {
  return list().filter(p => p.active);
}

// Every active plan a user could buy that includes this channel - a
// channel's own single plans AND any bundle that happens to include it.
function listActiveByChannel(channelId) {
  return listActive().filter(p => p.channelIds.includes(channelId));
}
function listActiveBundles() {
  return listActive().filter(p => p.type === 'bundle');
}
function listActiveSingles() {
  return listActive().filter(p => p.type === 'single');
}

function getById(id) {
  return list().find(p => p.id === id) || null;
}
function add(plan) {
  const data = loadAll();
  data.plans.push(plan);
  saveAll(data);
  return plan;
}
function update(id, patch) {
  const data = loadAll();
  const idx = data.plans.findIndex(p => p.id === id);
  if (idx === -1) return null;
  data.plans[idx] = { ...data.plans[idx], ...patch };
  saveAll(data);
  return data.plans[idx];
}
function remove(id) {
  const data = loadAll();
  data.plans = data.plans.filter(p => p.id !== id);
  saveAll(data);
}

module.exports = {
  list, listActive, listActiveByChannel, listActiveBundles, listActiveSingles,
  getById, add, update, remove
};
