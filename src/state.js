// Lightweight in-memory state used for:
//  - multi-step admin input wizards (e.g. "add channel" flow)
//  - active admin <-> user relay chat sessions
//
// This intentionally resets on bot restart. Wizard steps are short-lived
// (a few messages), and relay sessions can simply be re-started with the
// "Message this user" button, so persistence isn't worth the complexity.
//
// Wizard state also expires on its own: if someone starts a guided flow and
// walks away, the half-finished conversation is dropped after STATE_TTL_MINUTES
// instead of capturing their next unrelated message hours later.

const TTL_MS = Math.max(1, parseFloat(process.env.STATE_TTL_MINUTES || '15')) * 60 * 1000;

const userState = new Map();     // userId -> { step, data, at }
const relayByAdmin = new Map();  // adminId -> targetUserId
const relayByUser = new Map();   // userId  -> adminId

function setState(userId, step, data = {}) {
  userState.set(String(userId), { step, data, at: Date.now() });
}
function getState(userId, now = Date.now()) {
  const key = String(userId);
  const s = userState.get(key);
  if (!s) return null;
  if (now - s.at > TTL_MS) {
    userState.delete(key);
    return null;
  }
  return s;
}
function clearState(userId) {
  userState.delete(String(userId));
}
// Drop every expired wizard (called periodically so the Map cannot grow forever).
function purgeExpiredStates(now = Date.now()) {
  let removed = 0;
  for (const [key, s] of userState) {
    if (now - s.at > TTL_MS) { userState.delete(key); removed += 1; }
  }
  return removed;
}

function startRelay(adminId, targetUserId) {
  relayByAdmin.set(String(adminId), String(targetUserId));
  relayByUser.set(String(targetUserId), String(adminId));
}
function endRelay(adminId) {
  const target = relayByAdmin.get(String(adminId));
  if (target) relayByUser.delete(target);
  relayByAdmin.delete(String(adminId));
}
function getRelayTarget(adminId) {
  return relayByAdmin.get(String(adminId)) || null;
}
function getRelayAdmin(userId) {
  return relayByUser.get(String(userId)) || null;
}

// Coupon the user has typed in for a specific plan (applied at checkout).
const pendingCoupon = new Map(); // `${userId}:${planId}` -> code
function setCoupon(userId, planId, code) { pendingCoupon.set(`${userId}:${planId}`, code); }
function getCoupon(userId, planId) { return pendingCoupon.get(`${userId}:${planId}`) || null; }
function clearCoupon(userId, planId) { pendingCoupon.delete(`${userId}:${planId}`); }

module.exports = {
  setCoupon, getCoupon, clearCoupon,
  setState, getState, clearState, purgeExpiredStates,
  startRelay, endRelay, getRelayTarget, getRelayAdmin
};
