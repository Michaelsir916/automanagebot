const path = require('path');
const { readJSON, writeJSON } = require('./atomicWrite');

const FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

// Every tunable lives here so admins can change it from the bot (⚙️ Settings)
// without editing code or restarting.
const DEFAULTS = {
  maintenance: false,
  maintenanceMessage: '🛠 We are updating the bot. Please try again in a few minutes.',
  // Recharge packages: stars -> bonus percent
  rechargePackages: [
    { stars: 50, bonusPct: 0 },
    { stars: 100, bonusPct: 5 },
    { stars: 250, bonusPct: 10, popular: true },
    { stars: 500, bonusPct: 15 }
  ],
  // Referral: reward for the referrer when the referred user makes their
  // FIRST successful recharge (more fraud-resistant than rewarding /start).
  referralEnabled: true,
  referralRewardStars: 10,
  // Renewal discount when someone re-buys a plan they already had
  renewDiscountPct: 10,
  // Win-back
  winbackEnabled: true,
  winbackDiscountPct: 15,
  winbackAfterDays: [3, 7],
  // Reminders (days before expiry)
  reminderDays: [3, 1],
  // Backups
  backupEnabled: true,
  backupEveryHours: 12,
  // Manual UPI payments
  upiEnabled: false,
  upiId: '',
  upiName: '',
  upiStarsPerRupee: 1,
  upiMinRupees: 10
};

function load() {
  const stored = readJSON(FILE, {});
  return { ...DEFAULTS, ...stored };
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  const stored = readJSON(FILE, {});
  stored[key] = value;
  writeJSON(FILE, stored);
  return { ...DEFAULTS, ...stored };
}

function setMany(patch) {
  const stored = readJSON(FILE, {});
  Object.assign(stored, patch);
  writeJSON(FILE, stored);
  return { ...DEFAULTS, ...stored };
}

module.exports = { load, get, set, setMany, DEFAULTS };
