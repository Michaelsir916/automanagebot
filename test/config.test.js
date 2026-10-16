const test = require('node:test');
const assert = require('node:assert');
const { validateEnv } = require('../src/configValidate');

const GOOD_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('valid configuration passes and applies defaults', () => {
  const { errors, values } = validateEnv({ BOT_TOKEN: GOOD_TOKEN, ADMIN_IDS: '111, 222' });
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(values.ADMIN_IDS, ['111', '222']);
  assert.strictEqual(values.AUTO_KICK_UNPAID, true);
  assert.strictEqual(values.LINK_EXPIRY_HOURS, 72);
});

test('missing or malformed token is rejected', () => {
  assert.ok(validateEnv({ ADMIN_IDS: '1' }).errors.some(e => /BOT_TOKEN is missing/.test(e)));
  assert.ok(validateEnv({ BOT_TOKEN: 'nonsense', ADMIN_IDS: '1' }).errors.some(e => /does not look like/.test(e)));
});

test('non-numeric admin ids are rejected', () => {
  const { errors } = validateEnv({ BOT_TOKEN: GOOD_TOKEN, ADMIN_IDS: '12,abc' });
  assert.ok(errors.some(e => /ADMIN_IDS/.test(e) && /abc/.test(e)));
});

test('bad booleans, numbers and timezone are reported', () => {
  const { errors } = validateEnv({
    BOT_TOKEN: GOOD_TOKEN, ADMIN_IDS: '1', AUTO_KICK_UNPAID: 'yes',
    SUBSCRIPTION_CHECK_INTERVAL_MINUTES: '-5', JOB_MAX_ATTEMPTS: '2.5', BOT_TIMEZONE: 'Mars/Base'
  });
  assert.strictEqual(errors.length, 4);
});

test('missing admin ids is only a warning', () => {
  const { errors, warnings } = validateEnv({ BOT_TOKEN: GOOD_TOKEN });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.length, 1);
});
