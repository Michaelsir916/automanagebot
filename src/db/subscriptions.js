const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(__dirname, '..', '..', 'data', 'subscriptions.json');

function loadAll() {
  return readJSON(FILE, { subscriptions: {} });
}
function saveAll(data) {
  writeJSON(FILE, data);
}

// One subscription per (channelId, userId) at a time. Re-subscribing
// overwrites the previous record for that pair with a fresh expiry.
function key(channelId, userId) {
  return `${channelId}:${userId}`;
}

// opts:
//   groupId  - shared id linking every channel of a bundle purchase together
//              (defaults to a fresh id, i.e. a "group of one" for plain
//              single-channel subscriptions)
//   planId   - the plans.js plan this came from, if any (null for the old
//              per-channel quick-unlock flow)
function start(channelId, userId, chatId, linkId, durationDays, opts = {}) {
  const data = loadAll();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const sub = {
    id: genId('sub'),
    groupId: opts.groupId || genId('subgrp'),
    planId: opts.planId || null,
    channelId,
    userId: String(userId),
    chatId,
    linkId,
    autoRenew: false,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active'
  };
  data.subscriptions[key(channelId, userId)] = sub;
  saveAll(data);
  return sub;
}

// Start every channel of a bundle purchase at once, all sharing one groupId
// and the same expiry - this is what makes them expire/kick together.
// entries: [{ channelId, chatId, linkId }, ...]
function startGroup(entries, userId, durationDays, planId) {
  const groupId = genId('subgrp');
  return entries.map(e => start(e.channelId, userId, e.chatId, e.linkId, durationDays, { groupId, planId }));
}

function get(channelId, userId) {
  const data = loadAll();
  return data.subscriptions[key(channelId, userId)] || null;
}

function markExpired(channelId, userId) {
  const data = loadAll();
  const k = key(channelId, userId);
  if (!data.subscriptions[k]) return null;
  data.subscriptions[k].status = 'expired';
  saveAll(data);
  return data.subscriptions[k];
}

// All subscriptions still marked "active" whose expiry has passed -
// this is what the background sweep job acts on.
function listActiveExpired(now = new Date()) {
  const data = loadAll();
  return Object.values(data.subscriptions).filter(
    s => s.status === 'active' && new Date(s.expiresAt) <= now
  );
}

function listByUser(userId) {
  const data = loadAll();
  return Object.values(data.subscriptions).filter(s => String(s.userId) === String(userId));
}

// Every member (channel) of the same bundle purchase.
function listByGroup(groupId) {
  const data = loadAll();
  return Object.values(data.subscriptions).filter(s => s.groupId === groupId);
}

function setAutoRenew(channelId, userId, enabled) {
  const data = loadAll();
  const k = key(channelId, userId);
  if (!data.subscriptions[k]) return null;
  data.subscriptions[k].autoRenew = enabled;
  saveAll(data);
  return data.subscriptions[k];
}

// Flip auto-renew for every channel in a bundle at once, since it's one
// purchase/one toggle from the user's point of view.
function setGroupAutoRenew(groupId, enabled) {
  const data = loadAll();
  const touched = [];
  Object.values(data.subscriptions).forEach(s => {
    if (s.groupId === groupId) {
      s.autoRenew = enabled;
      touched.push(s);
    }
  });
  saveAll(data);
  return touched;
}

// Push every still-active member of a group's expiry forward by
// durationDays (from whichever is later: current expiry or now) - used by
// the auto-renew job right after a successful wallet charge.
function renewGroup(groupId, durationDays) {
  const data = loadAll();
  const now = new Date();
  const touched = [];
  Object.values(data.subscriptions).forEach(s => {
    if (s.groupId === groupId && s.status === 'active') {
      const base = new Date(s.expiresAt) > now ? new Date(s.expiresAt) : now;
      s.expiresAt = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
      touched.push(s);
    }
  });
  saveAll(data);
  return touched;
}

// One row per distinct group that has auto-renew on and is due to expire
// within windowMs - what the auto-renew job scans on every tick.
function listGroupsDueForRenewal(windowMs, now = new Date()) {
  const data = loadAll();
  const seen = new Map();
  Object.values(data.subscriptions).forEach(s => {
    if (s.status !== 'active' || !s.autoRenew) return;
    if (new Date(s.expiresAt) - now > windowMs) return;
    if (!seen.has(s.groupId)) {
      seen.set(s.groupId, { groupId: s.groupId, planId: s.planId, userId: s.userId, expiresAt: s.expiresAt });
    }
  });
  return Array.from(seen.values());
}

module.exports = {
  start, startGroup, get, markExpired, listActiveExpired, listByUser,
  listByGroup, setAutoRenew, setGroupAutoRenew, renewGroup, listGroupsDueForRenewal
};
