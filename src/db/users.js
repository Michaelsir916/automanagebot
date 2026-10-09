const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'users.json');

// One profile per Telegram user who ever talked to the bot. Powers: user
// search, segmented broadcast, language preference, referral codes.
function loadAll() {
  return readJSON(FILE, { users: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

// In-memory write throttle: touching lastSeen on EVERY update would rewrite
// the file constantly. Only persist when something meaningful changed or the
// last write for this user is older than 10 minutes.
const lastWrite = new Map();

function refCodeFor(id) {
  return 'R' + Number(id).toString(36).toUpperCase();
}

function touch(from) {
  if (!from || from.is_bot) return null;
  const key = String(from.id);
  const data = loadAll();
  let u = data.users[key];
  const now = Date.now();
  let changed = false;

  if (!u) {
    u = {
      id: key,
      username: from.username || '',
      firstName: from.first_name || '',
      lastName: from.last_name || '',
      lang: 'ml',
      joinedAt: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      referralCode: refCodeFor(from.id),
      referredBy: null,
      referralRewarded: false,
      blocked: false
    };
    data.users[key] = u;
    changed = true;
  } else {
    const un = from.username || '';
    const fn = from.first_name || '';
    if (u.username !== un || u.firstName !== fn) {
      u.username = un; u.firstName = fn; u.lastName = from.last_name || '';
      changed = true;
    }
    if (u.blocked) { u.blocked = false; changed = true; }
    if (now - (lastWrite.get(key) || 0) > 10 * 60 * 1000) {
      u.lastSeen = new Date(now).toISOString();
      changed = true;
    }
  }
  if (changed) {
    lastWrite.set(key, now);
    saveAll(data);
  }
  return u;
}

function get(userId) {
  return loadAll().users[String(userId)] || null;
}

function update(userId, patch) {
  const data = loadAll();
  const k = String(userId);
  if (!data.users[k]) return null;
  data.users[k] = { ...data.users[k], ...patch };
  saveAll(data);
  return data.users[k];
}

function getLang(userId) {
  const u = get(userId);
  return u && u.lang ? u.lang : 'ml';
}

function setLang(userId, lang) {
  return update(userId, { lang });
}

function markBlocked(userId) {
  return update(userId, { blocked: true });
}

function list() {
  return Object.values(loadAll().users);
}

function findByUsername(username) {
  const q = String(username).replace(/^@/, '').toLowerCase();
  return list().find(u => (u.username || '').toLowerCase() === q) || null;
}

function findByReferralCode(code) {
  const q = String(code).toUpperCase();
  return list().find(u => u.referralCode === q) || null;
}

// Attach a referrer once, and only if the new user has no referrer yet and
// is not referring themselves.
function setReferrer(userId, referrerId) {
  if (String(userId) === String(referrerId)) return false;
  const u = get(userId);
  if (!u || u.referredBy) return false;
  if (!get(referrerId)) return false;
  update(userId, { referredBy: String(referrerId) });
  return true;
}

function listReferrals(referrerId) {
  return list().filter(u => u.referredBy === String(referrerId));
}

function hasUsedTrial(userId, planId) {
  const u = get(userId);
  return !!(u && (u.trials || []).includes(planId));
}
function markTrialUsed(userId, planId) {
  const u = get(userId);
  if (!u) return null;
  const trials = Array.from(new Set([...(u.trials || []), planId]));
  return update(userId, { trials });
}

module.exports = {
  hasUsedTrial, markTrialUsed,
  touch, get, update, getLang, setLang, markBlocked, list,
  findByUsername, findByReferralCode, setReferrer, listReferrals, refCodeFor
};
