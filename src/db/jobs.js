const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { readJSON, writeJSON } = require('./atomicWrite');
const { genId } = require('../utils/ids');

const FILE = path.join(DATA_DIR, 'jobs.json');

// Durable job queue stored next to the rest of the data. Unlike setInterval
// loops that only live in memory, a queued job survives restarts and keeps
// being retried (with exponential backoff + jitter) until it succeeds or runs
// out of attempts and is parked as "dead" for an admin to look at.
//
//   status: pending -> running -> done
//                         \-> pending (retry, runAt pushed back)
//                         \-> dead    (attempts exhausted)

const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const DONE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function loadAll() { return readJSON(FILE, { jobs: [] }); }
function saveAll(data) { writeJSON(FILE, data); }

// attempt is 1-based (the attempt that just failed).
function backoffMs(attempt, rand = Math.random) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return Math.round(exp * (0.5 + rand() * 0.5)); // 50-100% of the cap = jitter
}

// A job with the same dedupeKey that is still pending/running is returned
// instead of creating a duplicate.
function enqueue(type, payload, { dedupeKey = null, runAt = null, maxAttempts = 6 } = {}) {
  const data = loadAll();
  if (dedupeKey) {
    const existing = data.jobs.find(j => j.dedupeKey === dedupeKey && (j.status === 'pending' || j.status === 'running'));
    if (existing) return { job: existing, created: false };
  }
  const now = new Date().toISOString();
  const job = {
    id: genId('job'), type, payload, dedupeKey,
    status: 'pending', attempts: 0, maxAttempts,
    runAt: runAt || now, createdAt: now, updatedAt: now, lastError: null, deadNotified: false
  };
  data.jobs.push(job);
  saveAll(data);
  return { job, created: true };
}

// Atomically (single-threaded, one write) marks due jobs as running and returns them.
function claimDue(now = new Date(), limit = 20) {
  const data = loadAll();
  const due = data.jobs
    .filter(j => j.status === 'pending' && new Date(j.runAt) <= now)
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
    .slice(0, limit);
  if (due.length === 0) return [];
  for (const j of due) {
    j.status = 'running';
    j.startedAt = now.toISOString();
    j.updatedAt = now.toISOString();
  }
  saveAll(data);
  return due.map(j => ({ ...j }));
}

function complete(id, result = '') {
  const data = loadAll();
  const j = data.jobs.find(x => x.id === id);
  if (!j) return null;
  j.status = 'done';
  j.result = String(result).slice(0, 200);
  j.updatedAt = new Date().toISOString();
  saveAll(data);
  return j;
}

// Record a failed attempt. Returns the updated job; status is 'dead' once
// attempts are exhausted (or immediately when fatal is true).
function fail(id, error, { fatal = false, now = new Date(), rand = Math.random } = {}) {
  const data = loadAll();
  const j = data.jobs.find(x => x.id === id);
  if (!j) return null;
  j.attempts += 1;
  j.lastError = String(error).slice(0, 300);
  j.updatedAt = now.toISOString();
  if (fatal || j.attempts >= j.maxAttempts) {
    j.status = 'dead';
  } else {
    j.status = 'pending';
    j.runAt = new Date(now.getTime() + backoffMs(j.attempts, rand)).toISOString();
  }
  saveAll(data);
  return j;
}

// After a crash/restart, jobs left "running" would never be picked up again.
function recoverStuck(now = new Date(), timeoutMs = 5 * 60 * 1000) {
  const data = loadAll();
  let n = 0;
  for (const j of data.jobs) {
    if (j.status === 'running' && now - new Date(j.startedAt || j.updatedAt) > timeoutMs) {
      j.status = 'pending';
      j.updatedAt = now.toISOString();
      n += 1;
    }
  }
  if (n) saveAll(data);
  return n;
}

function requeueDead(id = null) {
  const data = loadAll();
  let n = 0;
  for (const j of data.jobs) {
    if (j.status === 'dead' && (!id || j.id === id)) {
      j.status = 'pending';
      j.attempts = 0;
      j.runAt = new Date().toISOString();
      j.deadNotified = false;
      n += 1;
    }
  }
  if (n) saveAll(data);
  return n;
}

function markDeadNotified(id) {
  const data = loadAll();
  const j = data.jobs.find(x => x.id === id);
  if (j) { j.deadNotified = true; saveAll(data); }
}

function purgeDone(now = new Date()) {
  const data = loadAll();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter(j => !(j.status === 'done' && now - new Date(j.updatedAt) > DONE_KEEP_MS));
  if (data.jobs.length !== before) saveAll(data);
  return before - data.jobs.length;
}

function patchPayload(id, patch) {
  const data = loadAll();
  const j = data.jobs.find(x => x.id === id);
  if (!j) return null;
  j.payload = { ...j.payload, ...patch };
  saveAll(data);
  return j;
}

function list(status = null) {
  const jobs = loadAll().jobs;
  return status ? jobs.filter(j => j.status === status) : jobs;
}

function counts() {
  const c = { pending: 0, running: 0, done: 0, dead: 0 };
  for (const j of loadAll().jobs) c[j.status] = (c[j.status] || 0) + 1;
  return c;
}

module.exports = {
  enqueue, claimDue, complete, fail, recoverStuck, requeueDead, markDeadNotified,
  purgeDone, patchPayload, list, counts, backoffMs
};
