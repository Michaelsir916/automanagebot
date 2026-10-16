const path = require('path');
const { DATA_DIR } = require('../db/dataDir');
const { readJSON, writeJSON } = require('../db/atomicWrite');

const FILE = path.join(DATA_DIR, 'processed_updates.json');

// Skips Telegram updates that were already handled (same update_id), which can
// be re-delivered after a restart or a slow acknowledgement.
//
// Important: an update is only recorded AFTER its handlers finished without
// throwing. If the process dies half-way through a handler, Telegram will
// deliver the update again and it must be processed again - the payment code
// is idempotent per charge ID, so that is safe, whereas recording the id up
// front could silently drop a paid update.
function createUpdateDedup({ file = FILE, max = 2000, persistEveryMs = 2000 } = {}) {
  const seen = new Set(readJSON(file, { ids: [] }).ids);
  const order = Array.from(seen);
  const inFlight = new Set();
  let timer = null;

  function persist() {
    timer = null;
    try { writeJSON(file, { ids: order.slice(-Math.floor(max / 2)) }); } catch (e) { console.error('[dedup] persist failed:', e.message); }
  }
  function schedulePersist() {
    if (!timer && persistEveryMs >= 0) {
      timer = setTimeout(persist, persistEveryMs);
      if (timer.unref) timer.unref();
    }
  }
  function remember(id) {
    seen.add(id);
    order.push(id);
    while (order.length > max) seen.delete(order.shift());
    schedulePersist();
  }

  const middleware = async (ctx, next) => {
    const id = ctx.update && ctx.update.update_id;
    if (id === undefined || id === null) return next();
    if (seen.has(id) || inFlight.has(id)) return undefined;
    inFlight.add(id);
    try {
      const result = await next();
      remember(id);
      return result;
    } finally {
      inFlight.delete(id);
    }
  };
  middleware.flush = () => { if (timer) clearTimeout(timer); persist(); };
  middleware.has = id => seen.has(id);
  return middleware;
}

module.exports = { createUpdateDedup };
