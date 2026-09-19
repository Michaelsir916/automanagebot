// Lightweight in-memory state used for:
//  - multi-step admin input wizards (e.g. "add channel" flow)
//  - active admin <-> user relay chat sessions
//
// This intentionally resets on bot restart. Wizard steps are short-lived
// (a few messages), and relay sessions can simply be re-started with the
// "Message this user" button, so persistence isn't worth the complexity.

const userState = new Map();     // userId -> { step, data }
const relayByAdmin = new Map();  // adminId -> targetUserId
const relayByUser = new Map();   // userId  -> adminId

function setState(userId, step, data = {}) {
  userState.set(String(userId), { step, data });
}
function getState(userId) {
  return userState.get(String(userId)) || null;
}
function clearState(userId) {
  userState.delete(String(userId));
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

module.exports = {
  setState, getState, clearState,
  startRelay, endRelay, getRelayTarget, getRelayAdmin
};
