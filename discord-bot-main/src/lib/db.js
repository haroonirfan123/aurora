// Tiny JSON-file database. Everything lives in memory and is written to
// data/db.json shortly after each change, so there is nothing to install.
const fs = require('fs');
const path = require('path');
const defaults = require('../config/defaults');

// DATA_DIR lets hosts with a persistent volume (e.g. Railway) keep the data across deploys
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let state = { guilds: {} };
if (fs.existsSync(FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`[db] db.json could not be read, a copy was saved to ${backup}`);
  }
}

let timer = null;
function save() {
  if (!timer) timer = setTimeout(flush, 1000);
}
function flush() {
  clearTimeout(timer);
  timer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flush();
    process.exit(0);
  });
}
process.on('exit', () => timer && flush());

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Keeps the shape of `base`, taking values from `over` where they exist.
function merge(base, over) {
  const out = {};
  for (const key of Object.keys(base)) {
    if (isObj(base[key])) out[key] = merge(base[key], isObj(over?.[key]) ? over[key] : {});
    else out[key] = over?.[key] !== undefined ? over[key] : clone(base[key]);
  }
  return out;
}

const ready = new Set();
function guild(id) {
  if (!state.guilds[id]) state.guilds[id] = {};
  const g = state.guilds[id];
  if (!ready.has(id)) {
    g.config = merge(defaults, g.config || {});
    for (const key of ['warnings', 'economy', 'afk', 'tickets', 'giveaways', 'polls']) g[key] ||= {};
    for (const key of ['reminders', 'cases', 'lockdown']) g[key] ||= [];
    g.ticketCounter ||= 0;
    g.raid ||= { active: false, until: 0 };
    ready.add(id);
  }
  return g;
}

function setConfig(id, config) {
  guild(id).config = merge(defaults, config);
  save();
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

module.exports = { guild, setConfig, save, flush, merge, uid };
