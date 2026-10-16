// Pure validation of environment settings. Kept separate from config.js so it
// can be unit-tested without exiting the process.

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;

function parseBool(raw, fallback, name, errors) {
  if (raw === undefined || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  errors.push(`${name} must be "true" or "false" (got "${raw}").`);
  return fallback;
}

function parseNumber(raw, fallback, name, errors, { min = 0, max = Infinity, integer = false } = {}) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    errors.push(`${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max === Infinity ? '∞' : max} (got "${raw}").`);
    return fallback;
  }
  return n;
}

// Returns { errors, warnings, values }. Never throws and never exits.
function validateEnv(env) {
  const errors = [];
  const warnings = [];

  const BOT_TOKEN = (env.BOT_TOKEN || '').trim();
  if (!BOT_TOKEN) errors.push('BOT_TOKEN is missing. Get one from @BotFather.');
  else if (!TOKEN_RE.test(BOT_TOKEN)) errors.push('BOT_TOKEN does not look like a Telegram bot token (expected 123456:ABC...).');

  const ADMIN_IDS = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const badIds = ADMIN_IDS.filter(id => !/^\d{1,15}$/.test(id));
  if (badIds.length) errors.push(`ADMIN_IDS must be comma-separated numeric Telegram user IDs (invalid: ${badIds.join(', ')}).`);
  if (ADMIN_IDS.length === 0) warnings.push('No ADMIN_IDS set - the admin panel will be inaccessible until you set one.');

  const values = {
    BOT_TOKEN,
    ADMIN_IDS: ADMIN_IDS.filter(id => /^\d{1,15}$/.test(id)),
    AUTO_KICK_UNPAID: parseBool(env.AUTO_KICK_UNPAID, true, 'AUTO_KICK_UNPAID', errors),
    SUBSCRIPTION_CHECK_INTERVAL_MINUTES: parseNumber(env.SUBSCRIPTION_CHECK_INTERVAL_MINUTES, 10, 'SUBSCRIPTION_CHECK_INTERVAL_MINUTES', errors, { min: 0.1, max: 1440 }),
    AUTO_RENEW_CHECK_INTERVAL_MINUTES: parseNumber(env.AUTO_RENEW_CHECK_INTERVAL_MINUTES, 10, 'AUTO_RENEW_CHECK_INTERVAL_MINUTES', errors, { min: 0.1, max: 1440 }),
    LINK_EXPIRY_HOURS: parseNumber(env.LINK_EXPIRY_HOURS, 72, 'LINK_EXPIRY_HOURS', errors, { min: 1, max: 24 * 30 }),
    JOB_POLL_SECONDS: parseNumber(env.JOB_POLL_SECONDS, 20, 'JOB_POLL_SECONDS', errors, { min: 2, max: 3600 }),
    JOB_MAX_ATTEMPTS: parseNumber(env.JOB_MAX_ATTEMPTS, 6, 'JOB_MAX_ATTEMPTS', errors, { min: 1, max: 20, integer: true }),
    STATE_TTL_MINUTES: parseNumber(env.STATE_TTL_MINUTES, 15, 'STATE_TTL_MINUTES', errors, { min: 1, max: 1440 })
  };

  if (env.BOT_TIMEZONE) {
    try { new Intl.DateTimeFormat('en', { timeZone: env.BOT_TIMEZONE }); } catch (e) {
      errors.push(`BOT_TIMEZONE "${env.BOT_TIMEZONE}" is not a valid IANA timezone (e.g. Asia/Kolkata).`);
    }
  }

  return { errors, warnings, values };
}

module.exports = { validateEnv, TOKEN_RE };
