function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Human-readable "@username (Name)" or "Name [id: 123]" fallback when no username
function userTag(from) {
  if (!from) return 'Unknown';
  const name = escapeHtml(from.first_name || 'User');
  return from.username ? `@${escapeHtml(from.username)} (${name})` : `${name} [id: ${from.id}]`;
}

const TZ = process.env.BOT_TIMEZONE || 'Asia/Kolkata';

// "07 Oct 2026, 03:45 PM" in the shop's timezone (not the server's).
function fmtDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  }).format(d).replace(' am', ' AM').replace(' pm', ' PM');
}

function fmtDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

// YYYY-MM-DD in the shop's timezone (used to bucket revenue by day).
function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function fmtNum(n) {
  const x = Math.round(Number(n || 0) * 100) / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

// Whole + fractional days left, shown as "3d 4h" / "5h 20m" / "12m".
function timeLeft(expiresAt, now = new Date()) {
  const ms = new Date(expiresAt) - now;
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

module.exports = { escapeHtml, userTag, fmtDate, fmtDay, dayKey, fmtNum, timeLeft, TZ };
