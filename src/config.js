try { require('dotenv').config(); } catch (e) { /* dotenv is optional when variables come from the real environment */ }

const { validateEnv } = require('./configValidate');

const { errors, warnings, values } = validateEnv(process.env);

warnings.forEach(w => console.warn(`[config] ${w}`));
if (errors.length) {
  console.error('[config] Invalid configuration, refusing to start:');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

module.exports = values;
