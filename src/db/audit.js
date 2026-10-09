const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'audit.json');
const MAX_ENTRIES = 2000; // keep the file small; oldest entries roll off

function add(adminId, action, detail = '') {
  const data = readJSON(FILE, { entries: [] });
  data.entries.push({
    at: new Date().toISOString(),
    adminId: String(adminId),
    action,
    detail: String(detail).slice(0, 300)
  });
  if (data.entries.length > MAX_ENTRIES) data.entries = data.entries.slice(-MAX_ENTRIES);
  writeJSON(FILE, data);
}

function list() {
  return readJSON(FILE, { entries: [] }).entries;
}

module.exports = { add, list };
