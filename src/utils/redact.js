// Keeps secrets out of logs. Installed once at boot (see bot.js) so every
// console.* call in the project is covered, including error messages that
// embed request URLs such as https://api.telegram.org/bot<TOKEN>/method.

// No leading \b: in API URLs the token directly follows the word "bot" (…/bot123:ABC/…).
const TOKEN_RE = /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,60}/g;
const INVITE_RE = /(https?:\/\/)?t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+/g;

function redact(text, extraSecrets = []) {
  let out = String(text);
  for (const s of extraSecrets) {
    if (s && s.length >= 8) out = out.split(s).join('<redacted>');
  }
  return out.replace(TOKEN_RE, '<bot-token>').replace(INVITE_RE, 't.me/+<invite>');
}

function redactArg(arg, extraSecrets) {
  if (typeof arg === 'string') return redact(arg, extraSecrets);
  if (arg instanceof Error) return redact(arg.stack || arg.message, extraSecrets);
  if (arg && typeof arg === 'object') {
    try { return redact(JSON.stringify(arg), extraSecrets); } catch (e) { return '[unserializable]'; }
  }
  return arg;
}

let installed = false;
function installConsoleRedaction(extraSecrets = []) {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => original(...args.map(a => redactArg(a, extraSecrets)));
  }
}

module.exports = { redact, installConsoleRedaction };
