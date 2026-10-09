// Slow / flaky network protection.
//
// Everything here is installed ONCE as middleware (see bot.js) so the
// existing handlers get the benefits without being rewritten:
//
//  1. Retry with backoff for transient Telegram API failures (timeouts,
//     resets, 429 flood-wait, 5xx).
//  2. ctx.answerCbQuery() can never throw or run twice. On a slow link the
//     callback query is often "too old" by the time the handler runs; the
//     stock call would throw and the whole handler would silently die.
//  3. The spinner on a tapped button is stopped immediately.
//  4. ctx.reply() inside a button press EDITS the current message instead of
//     piling up new ones (falls back to a new message if editing is not
//     possible). Screens stay tidy and a lagging client never shows 5
//     copies of the same menu.
//  5. A per-user lock ignores repeat taps of the same button while the first
//     tap is still being processed (prevents double purchases / double
//     recharges when the user taps again because nothing happened yet).

const https = require('https');

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND',
  'EPIPE', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function errText(err) {
  return String((err && (err.description || err.message)) || err || '');
}

function isNotModified(err) {
  return /message is not modified/i.test(errText(err));
}

function isTransient(err) {
  if (!err) return false;
  const code = err.code || (err.errno) || (err.cause && err.cause.code);
  if (code && TRANSIENT_CODES.has(code)) return true;
  if (err.type === 'system' || err.name === 'FetchError') return true;
  const status = err.response && (err.response.error_code || err.response.status);
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (/timed? ?out|socket hang up|network|ECONN|EAI_AGAIN/i.test(errText(err))) return true;
  return false;
}

function retryAfterMs(err) {
  const p = err && err.response && err.response.parameters;
  if (p && p.retry_after) return (p.retry_after + 1) * 1000;
  return 0;
}

// Run fn(), retrying transient failures. Never retries "real" API errors
// (400 bad request, 403 blocked, etc.) since repeating those can't help.
async function withRetry(fn, { tries = 4, baseMs = 700, label = '' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === tries) throw err;
      const wait = Math.max(retryAfterMs(err), baseMs * 2 ** (attempt - 1));
      if (label) console.warn(`[net] ${label} failed (${errText(err).slice(0, 80)}), retry ${attempt}/${tries - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Shared keep-alive agent. family:4 avoids very slow IPv6 fallbacks that are
// common on Termux / cheap VPS networks.
function makeAgent() {
  return new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 64, family: 4 });
}

// Wrap telegram.callApi so EVERY API call (including ones made from jobs and
// broadcasts, not just handlers) gets retry + flood-wait handling.
function patchTelegramRetry(telegram) {
  if (telegram.__retryPatched) return;
  const original = telegram.callApi.bind(telegram);
  telegram.callApi = (method, payload, opts) => {
    // getUpdates is a long poll that Telegraf already retries on its own.
    if (method === 'getUpdates') return original(method, payload, opts);
    return withRetry(() => original(method, payload, opts), { label: method });
  };
  telegram.__retryPatched = true;
}

// ---------------------------------------------------------------------------
// Per-update middleware
// ---------------------------------------------------------------------------

const inFlight = new Map(); // key -> startedAt
const LOCK_MAX_MS = 60 * 1000; // never let a stuck lock block a user forever

function lockKey(ctx) {
  const uid = ctx.from && ctx.from.id;
  if (!uid) return null;
  const cb = ctx.callbackQuery;
  if (cb && cb.data) return `${uid}:cb:${cb.data}`;
  return null;
}

function hasInlineKeyboard(extra) {
  return !!(extra && extra.reply_markup && Array.isArray(extra.reply_markup.inline_keyboard));
}

function resilience() {
  return async (ctx, next) => {
    // -------- callback-query handling --------
    if (ctx.callbackQuery) {
      let answered = false;
      let answerPromise = null;
      ctx.answerCbQuery = (text, extra) => {
        if (answered) return Promise.resolve(true);
        answered = true;
        // Fire and forget: failure here ("query too old") must never stop
        // the real handler from running.
        answerPromise = Promise.resolve()
          .then(() => ctx.telegram.answerCbQuery(ctx.callbackQuery.id, text, extra))
          .catch(() => false);
        return Promise.resolve(true);
      };

      const key = lockKey(ctx);
      if (key) {
        const started = inFlight.get(key);
        if (started && Date.now() - started < LOCK_MAX_MS) {
          // Same button, same user, still processing -> ignore the repeat.
          ctx.telegram.answerCbQuery(ctx.callbackQuery.id, '⏳ Processing… / ദയവായി കാത്തിരിക്കൂ', { show_alert: false }).catch(() => {});
          return;
        }
        inFlight.set(key, Date.now());
      }

      // Stop the button spinner right away (before any slow DB / API work).
      ctx.answerCbQuery();

      // Edit-in-place reply: first screen-like reply (one with an inline
      // keyboard) edits the message the button lives on.
      const origReply = ctx.reply.bind(ctx);
      let edited = false;
      ctx.replyNew = origReply;
      ctx.reply = async (text, extra) => {
        if (!edited && hasInlineKeyboard(extra) && ctx.callbackQuery.message) {
          edited = true;
          try {
            return await ctx.editMessageText(text, extra);
          } catch (err) {
            if (isNotModified(err)) return ctx.callbackQuery.message;
            // Not editable (media / invoice / too old) -> send as new.
          }
        }
        return origReply(text, extra);
      };
      // Helper for handlers that want to update only the buttons.
      ctx.editKeyboard = async markup => {
        try {
          await ctx.editMessageReplyMarkup((markup && markup.reply_markup) || markup);
        } catch (err) {
          if (!isNotModified(err)) console.warn('[ui] editKeyboard failed:', errText(err).slice(0, 80));
        }
      };

      try {
        return await next();
      } finally {
        if (key) inFlight.delete(key);
      }
    }

    return next();
  };
}

// Send the "typing…" indicator without ever throwing.
function typing(ctx, action = 'typing') {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId) return;
  ctx.telegram.sendChatAction(chatId, action).catch(() => {});
}

// Show a "⏳ working…" placeholder, run the slow job, and always leave the
// user with either the result or a clear failure message.
async function withLoading(ctx, loadingText, job, { failText = '⚠️ Network is slow or something went wrong. Please try again in a moment.' } = {}) {
  typing(ctx);
  let placeholder = null;
  try {
    placeholder = await ctx.reply(loadingText);
  } catch (e) { /* placeholder is optional */ }
  try {
    return await job(placeholder);
  } catch (err) {
    console.error('[withLoading] job failed:', errText(err));
    try { await (ctx.replyNew || ctx.reply.bind(ctx))(failText); } catch (e) { /* nothing more to do */ }
    return undefined;
  }
}

module.exports = {
  withRetry, isTransient, isNotModified, errText, sleep,
  makeAgent, patchTelegramRetry, resilience, typing, withLoading, hasInlineKeyboard
};
