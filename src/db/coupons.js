const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'coupons.json');

// coupon: {
//   code, type: 'percent'|'flat', value,
//   maxUses (0 = unlimited), used, usedBy: [userId...],
//   expiresAt (ISO | null), userId (restrict to one user | null),
//   planIds ([] = any plan), active, createdAt, createdBy, source
// }
function loadAll() { return readJSON(FILE, { coupons: {} }); }
function saveAll(d) { writeJSON(FILE, d); }

function norm(code) { return String(code || '').trim().toUpperCase(); }

function get(code) { return loadAll().coupons[norm(code)] || null; }
function list() { return Object.values(loadAll().coupons); }

function create({ code, type, value, maxUses = 0, expiresAt = null, userId = null, planIds = [], createdBy = null, source = 'admin' }) {
  const data = loadAll();
  const c = norm(code);
  if (!c) throw new Error('empty code');
  if (data.coupons[c]) throw new Error('exists');
  data.coupons[c] = {
    code: c, type, value: Number(value), maxUses: Number(maxUses) || 0,
    used: 0, usedBy: [], expiresAt, userId: userId ? String(userId) : null,
    planIds, active: true, createdAt: new Date().toISOString(), createdBy, source
  };
  saveAll(data);
  return data.coupons[c];
}

function remove(code) {
  const data = loadAll();
  delete data.coupons[norm(code)];
  saveAll(data);
}

function setActive(code, active) {
  const data = loadAll();
  const c = data.coupons[norm(code)];
  if (!c) return null;
  c.active = active;
  saveAll(data);
  return c;
}

// Returns { ok, reason?, coupon? }. Pure check - does NOT consume the coupon.
function validate(code, userId, planId, now = new Date()) {
  const c = get(code);
  if (!c) return { ok: false, reason: 'not_found' };
  if (!c.active) return { ok: false, reason: 'inactive' };
  if (c.expiresAt && new Date(c.expiresAt) <= now) return { ok: false, reason: 'expired' };
  if (c.maxUses > 0 && c.used >= c.maxUses) return { ok: false, reason: 'used_up' };
  if (c.userId && c.userId !== String(userId)) return { ok: false, reason: 'not_yours' };
  if (c.usedBy.includes(String(userId))) return { ok: false, reason: 'already_used' };
  if (c.planIds.length && planId && !c.planIds.includes(planId)) return { ok: false, reason: 'wrong_plan' };
  return { ok: true, coupon: c };
}

function discountFor(coupon, price) {
  let off = coupon.type === 'percent'
    ? Math.floor(price * coupon.value / 100)
    : Math.floor(coupon.value);
  off = Math.max(0, Math.min(off, price));
  return off;
}

// Consume exactly once per user. Returns false if it can't be consumed
// (e.g. two taps raced) so the caller never gives a discount twice.
function consume(code, userId) {
  const data = loadAll();
  const c = data.coupons[norm(code)];
  if (!c) return false;
  if (c.usedBy.includes(String(userId))) return false;
  if (c.maxUses > 0 && c.used >= c.maxUses) return false;
  c.used += 1;
  c.usedBy.push(String(userId));
  saveAll(data);
  return true;
}

function randomCode(prefix = 'OFF') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

module.exports = { get, list, create, remove, setActive, validate, discountFor, consume, randomCode, norm };
