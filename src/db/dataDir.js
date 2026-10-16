const path = require('path');

// Single place that decides where JSON data lives. Tests (and unusual
// deployments) can point it elsewhere with BOT_DATA_DIR.
const DATA_DIR = process.env.BOT_DATA_DIR
  ? path.resolve(process.env.BOT_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

module.exports = { DATA_DIR };
