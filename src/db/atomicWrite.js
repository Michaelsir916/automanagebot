const fs = require('fs');
const path = require('path');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, defaultValue) {
  try {
    ensureDir(filePath);
    if (!fs.existsSync(filePath)) {
      writeJSON(filePath, defaultValue);
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DB] Failed to read ${filePath}:`, err.message);
    return defaultValue;
  }
}

// Atomic write: write to a temp file then rename over the original, so a
// crash mid-write never leaves a corrupted/half-written JSON file behind.
function writeJSON(filePath, data) {
  ensureDir(filePath);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = { readJSON, writeJSON };
