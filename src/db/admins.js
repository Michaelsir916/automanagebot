const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { readJSON, writeJSON } = require('./atomicWrite');
const config = require('../config');

const FILE = path.join(DATA_DIR, 'admins.json');

const ALL_PERMISSIONS = [
  'manage_channels', 'manage_plans', 'generate_link', 'broadcast',
  'wallet_adjust', 'ban', 'view_payments', 'manage_admins',
  'view_stats', 'refund', 'support'
];

// Role -> permissions. Bootstrap admins (ADMIN_IDS) are always super admins.
//   superadmin - everything, including settings, admin roles, backups
//   moderator  - classic default: manual links, payment history, tickets
//   support    - answers users: tickets, payment history, stats, manual links
//   readonly   - can look (stats, payments) but never change anything
const ROLE_PRESETS = {
  superadmin: ALL_PERMISSIONS,
  moderator: ['generate_link', 'view_payments', 'support'],
  support: ['support', 'view_payments', 'view_stats', 'generate_link'],
  readonly: ['view_payments', 'view_stats']
};
const ROLES = Object.keys(ROLE_PRESETS);

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
  // Moderators created before the "support" permission existed keep ticket access.
  if (permission === 'support' && a.role === 'moderator') return true;
  return (a.permissions || []).includes(permission);
}

function roleOf(userId) {
  if (isBootstrapAdmin(userId)) return 'superadmin';
  const a = loadAll().admins[String(userId)];
  return a ? a.role : null;
}

function addAdmin(userId, role, permissions, addedBy) {
  const data = loadAll();
  data.admins[String(userId)] = {
    role, // one of ROLES
    permissions: role === 'superadmin' ? ALL_PERMISSIONS : (permissions || ROLE_PRESETS[role] || []),
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
  addAdmin, removeAdmin, listAdmins, allAdminIds, roleOf,
  ALL_PERMISSIONS, ROLE_PRESETS, ROLES
};
