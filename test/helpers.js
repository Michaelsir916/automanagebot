// Test helpers: isolated data directory, fake environment, and a stub for the
// "telegraf" and "dotenv" packages so the project's modules can be loaded
// without installing dependencies or touching the network.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup() {
  process.env.BOT_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  process.env.ADMIN_IDS = '1';
  process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-test-'));
  process.env.LINK_EXPIRY_HOURS = '72';

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'telegraf') {
      return {
        Telegraf: class {},
        Markup: {
          inlineKeyboard: rows => ({ reply_markup: { inline_keyboard: rows } }),
          button: { callback: (text, data) => ({ text, callback_data: data }) }
        }
      };
    }
    if (request === 'dotenv') return { config() {} };
    return originalLoad.call(this, request, ...rest);
  };
}

// Wipe every stored file between tests.
function resetData() {
  const dir = process.env.BOT_DATA_DIR;
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

// A fake Telegram client. Every call is recorded; behaviours can be overridden per test.
function fakeTelegram(overrides = {}) {
  const calls = [];
  const rec = (name, impl) => async (...args) => {
    calls.push({ name, args });
    return impl ? impl(...args) : true;
  };
  const tg = {
    calls,
    sendMessage: rec('sendMessage'),
    getMe: rec('getMe', () => ({ id: 999 })),
    getChat: rec('getChat', () => ({ title: 'Chan', type: 'channel' })),
    getChatMember: rec('getChatMember', () => ({ status: 'member' })),
    banChatMember: rec('banChatMember'),
    unbanChatMember: rec('unbanChatMember'),
    revokeChatInviteLink: rec('revokeChatInviteLink'),
    createChatInviteLink: rec('createChatInviteLink', () => ({ invite_link: `https://t.me/+${Math.random().toString(36).slice(2, 12)}` })),
    callApi: rec('callApi', () => true)
  };
  for (const [k, v] of Object.entries(overrides)) tg[k] = rec(k, v);
  return tg;
}

function timeoutError() {
  const e = new Error('connect ETIMEDOUT');
  e.code = 'ETIMEDOUT';
  return e;
}

function apiError(code, description) {
  const e = new Error(`${code}: ${description}`);
  e.response = { error_code: code, description };
  return e;
}

module.exports = { setup, resetData, fakeTelegram, timeoutError, apiError };
