#!/usr/bin/env node
/*
 * Restore test: proves a backup file can actually be restored.
 *
 *   node scripts/restore-test.js [path/to/backup.json.gz]
 *
 * Without an argument the newest file in data/backups is used. The backup is
 * unpacked into a throw-away temporary directory (your live data is never
 * touched), every file is parsed, written back and re-read, and the contents
 * are compared with the original. Exit code 0 = restorable, 1 = problem.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = process.env.BOT_DATA_DIR
  ? path.resolve(process.env.BOT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const FILE_NAME_RE = /^[A-Za-z0-9_-]+\.json$/;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function findBackup(arg) {
  if (arg) return path.resolve(arg);
  const dir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(dir)) fail(`no backups folder at ${dir}. Create one first (Admin → Settings → Backup).`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
  if (files.length === 0) fail('no backup files found.');
  return path.join(dir, files[files.length - 1]);
}

function countRecords(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    const arrays = Object.values(value).filter(v => Array.isArray(v));
    if (arrays.length) return arrays.reduce((n, a) => n + a.length, 0);
    return Object.keys(value).length;
  }
  return 0;
}

const backupPath = findBackup(process.argv[2]);
console.log(`Backup: ${backupPath}`);

let backup;
try {
  backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(backupPath)).toString('utf8'));
} catch (e) {
  fail(`cannot unzip/parse the backup (${e.message}).`);
}
if (!backup || backup.app !== 'automanagebot' || typeof backup.files !== 'object') fail('not an automanagebot backup.');
const names = Object.keys(backup.files);
if (names.length === 0) fail('backup contains no files.');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-restore-'));
let problems = 0;
try {
  for (const name of names) {
    if (!FILE_NAME_RE.test(name)) { console.error(`  ✗ ${name}: unsafe file name`); problems += 1; continue; }
    let original;
    try {
      original = JSON.parse(backup.files[name]);
    } catch (e) {
      console.error(`  ✗ ${name}: invalid JSON (${e.message})`); problems += 1; continue;
    }
    const target = path.join(tmp, name);
    fs.writeFileSync(target, JSON.stringify(original, null, 2));
    const restored = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (JSON.stringify(restored) !== JSON.stringify(original)) {
      console.error(`  ✗ ${name}: restored content differs from backup`); problems += 1; continue;
    }
    console.log(`  ✓ ${name.padEnd(28)} ${String(countRecords(original)).padStart(6)} record(s)`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (problems) fail(`${problems} file(s) could not be restored.`);
console.log(`\nOK: ${names.length} file(s) restored into a temporary folder and verified (created ${backup.createdAt}).`);
console.log('Live data was not modified.');
