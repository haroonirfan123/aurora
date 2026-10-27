// Tiny database. Everything lives in memory and is saved shortly after each change:
// to MongoDB when MONGODB_URI is set (good for hosts without a disk), otherwise to data/db.json.
const fs = require('fs');
const path = require('path');
const defaults = require('../config/defaults');

// DATA_DIR lets hosts with a persistent volume keep the file across deploys
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const MONGO_URI = process.env.MONGODB_URI;

let state = { guilds: {} };
let collection = null; // set when using MongoDB

// Must be awaited once before anything reads data.
async function init() {
  if (MONGO_URI) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    await client.connect();
    collection = client.db(process.env.MONGODB_DB || 'aurora').collection('state');
    // Stored as one JSON string so Discord IDs and user text never clash with MongoDB key rules
    const doc = await collection.findOne({ _id: 'state' });
    if (doc?.json) state = JSON.parse(doc.json);
    console.log('✓ Connected to MongoDB');
    return;
  }
  if (fs.existsSync(FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      fs.copyFileSync(FILE, backup);
      console.error(`[db] db.json could not be read, a copy was saved to ${backup}`);
    }
  }
}

let timer = null;
let writing = Promise.resolve();
function save() {
  // MongoDB writes go over the network, so batch them a little more
  if (!timer) timer = setTimeout(flush, collection ? 3000 : 1000);
}
function flush() {
  clearTimeout(timer);
  timer = null;
  const json = JSON.stringify(state);
  if (collection) {
    // Chain writes so an older snapshot can never land after a newer one
    writing = writing
      .then(() => collection.replaceOne({ _id: 'state' }, { _id: 'state', json, savedAt: new Date() }, { upsert: true }))
      .catch((err) => console.error('[db] MongoDB save failed:', err.message));
    return writing;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, FILE);
  return Promise.resolve();
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await flush();
    process.exit(0);
  });
}
process.on('exit', () => timer && !collection && flush());

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

module.exports = { init, guild, setConfig, save, flush, merge, uid };
