// Packs the bot into aurora-bot.tgz for uploading to a server.
// Leaves out node_modules, your data and your .env secrets.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'aurora-bot.tgz');
const tmp = path.join(os.tmpdir(), `aurora-bot-${Date.now()}.tgz`);
const skip = ['node_modules', 'data', '.env', 'aurora-bot.tgz', '.git'];

const entries = fs.readdirSync(root).filter((name) => !skip.includes(name));
execFileSync('tar', ['-czf', tmp, '-C', root, ...entries], { stdio: 'inherit' });
fs.copyFileSync(tmp, out);
fs.unlinkSync(tmp);
console.log(`✓ Created ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
