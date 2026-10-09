const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeJSON } = require('../db/atomicWrite');
const adminsDb = require('../db/admins');
const { withRetry } = require('../utils/resilience');
const { fmtDate } = require('../utils/format');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_LOCAL = 10;
const FILE_NAME_RE = /^[A-Za-z0-9_-]+\.json$/;

function collect() {
  const files = {};
  if (fs.existsSync(DATA_DIR)) {
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (!FILE_NAME_RE.test(name)) continue;
      try { files[name] = fs.readFileSync(path.join(DATA_DIR, name), 'utf8'); } catch (e) { /* skip unreadable */ }
    }
  }
  return { app: 'automanagebot', version: 2, createdAt: new Date().toISOString(), files };
}

function makeBuffer() {
  return zlib.gzipSync(Buffer.from(JSON.stringify(collect())));
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function saveLocal(buffer, prefix = 'backup') {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${prefix}-${stamp()}.json.gz`);
  fs.writeFileSync(file, buffer);
  const all = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json.gz')).sort();
  while (all.length > KEEP_LOCAL) fs.unlinkSync(path.join(BACKUP_DIR, all.shift()));
  return file;
}

// Super admins only: a backup contains every user's data.
function backupRecipients() {
  return adminsDb.listAdmins()
    .filter(a => String(a.role).startsWith('superadmin'))
    .map(a => String(a.id))
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

async function runBackup(telegram, reason = 'scheduled') {
  const buffer = makeBuffer();
  const file = saveLocal(buffer);
  const name = path.basename(file);
  const caption = `💾 Backup (${reason})\n${fmtDate(new Date())}\n${(buffer.length / 1024).toFixed(1)} KB\n\nKeep this file safe. Restore it from ⚙️ Settings → Backup.`;
  let sent = 0;
  for (const id of backupRecipients()) {
    try {
      await telegram.sendDocument(id, { source: buffer, filename: name }, { caption });
      sent += 1;
    } catch (err) {
      console.error(`[backup] could not send to ${id}:`, err.message);
    }
  }
  return { file, name, size: buffer.length, sent };
}

// Parse + validate an uploaded backup. Throws with a readable message.
function parseBackup(buffer) {
  let obj;
  try {
    obj = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  } catch (e) {
    throw new Error('Not a valid backup file (cannot unzip/parse).');
  }
  if (!obj || obj.app !== 'automanagebot' || typeof obj.files !== 'object') {
    throw new Error('This file is not an automanagebot backup.');
  }
  const names = Object.keys(obj.files);
  if (names.length === 0) throw new Error('Backup is empty.');
  for (const name of names) {
    if (!FILE_NAME_RE.test(name)) throw new Error(`Unsafe file name in backup: ${name}`);
    try { JSON.parse(obj.files[name]); } catch (e) { throw new Error(`Corrupt data in ${name}.`); }
  }
  return obj;
}

// Writes every file atomically. A safety copy of the CURRENT data is saved
// first, so a wrong restore can itself be undone.
function applyBackup(obj) {
  saveLocal(makeBuffer(), 'pre-restore');
  for (const [name, content] of Object.entries(obj.files)) {
    writeJSON(path.join(DATA_DIR, name), JSON.parse(content));
  }
  return Object.keys(obj.files).length;
}

async function downloadTelegramFile(telegram, fileId) {
  const link = await withRetry(() => telegram.getFileLink(fileId), { label: 'getFileLink' });
  const res = await withRetry(async () => {
    const r = await fetch(String(link));
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    return r;
  }, { label: 'download backup' });
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  collect, makeBuffer, saveLocal, runBackup, parseBackup, applyBackup,
  downloadTelegramFile, backupRecipients, BACKUP_DIR
};
