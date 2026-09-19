const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const config = require('../config');

const FILE = path.join(__dirname, '..', '..', 'data', 'admins.json');

const ALL_PERMISSIONS = [
  'manage_channels', 'generate_link', 'broadcast',
  'wallet_adjust', 'ban', 'view_payments', 'manage_admins'
];

function loadAll() {
  return readJSON(FILE, { admins: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

// Bootstrap admins come from ADMIN_IDS in .env - always full access,
// independent of data/admins.json. This guarantees you can never lock
// yourself out of the admin panel.
function isBootstrapAdmin(userId) {
  return config.ADMIN_IDS.includes(String(userId));
}

function isAdmin(userId) {
  if (isBootstrapAdmin(userId)) return true;
  const data = loadAll();
  return !!data.admins[String(userId)];
}

function isSuperAdmin(userId) {
  if (isBootstrapAdmin(userId)) return true;
  const data = loadAll();
  const a = data.admins[String(userId)];
  return !!a && a.role === 'superadmin';
}

function hasPermission(userId, permission) {
  if (isBootstrapAdmin(userId)) return true;
  const data = loadAll();
  const a = data.admins[String(userId)];
  if (!a) return false;
  if (a.role === 'superadmin') return true;
  return (a.permissions || []).includes(permission);
}

function addAdmin(userId, role, permissions, addedBy) {
  const data = loadAll();
  data.admins[String(userId)] = {
    role, // 'superadmin' | 'moderator'
    permissions: role === 'superadmin' ? ALL_PERMISSIONS : (permissions || []),
    addedAt: new Date().toISOString(),
    addedBy
  };
  saveAll(data);
}

function removeAdmin(userId) {
  const data = loadAll();
  delete data.admins[String(userId)];
  saveAll(data);
}

function listAdmins() {
  const data = loadAll();
  const bootstrap = config.ADMIN_IDS.map(id => ({ id, role: 'superadmin (bootstrap)', permissions: ALL_PERMISSIONS }));
  const stored = Object.entries(data.admins)
    .filter(([id]) => !config.ADMIN_IDS.includes(id))
    .map(([id, v]) => ({ id, ...v }));
  return [...bootstrap, ...stored];
}

function allAdminIds() {
  const data = loadAll();
  return Array.from(new Set([...config.ADMIN_IDS, ...Object.keys(data.admins)]));
}

module.exports = {
  isAdmin, isSuperAdmin, hasPermission,
  addAdmin, removeAdmin, listAdmins, allAdminIds,
  ALL_PERMISSIONS
};
