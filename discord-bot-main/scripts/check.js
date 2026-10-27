// Loads every command and module without logging in, so mistakes show up before you start the bot.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
let names = new Set();
let count = 0;
for (const file of fs.readdirSync(path.join(src, 'commands'))) {
  for (const cmd of require(path.join(src, 'commands', file))) {
    const json = cmd.data.toJSON();
    if (names.has(json.name)) throw new Error(`Duplicate command name: ${json.name}`);
    names.add(json.name);
    count++;
  }
}
for (const file of fs.readdirSync(path.join(src, 'modules'))) require(path.join(src, 'modules', file));
require(path.join(src, 'dashboard', 'server.js'));
console.log(`✓ ${count} commands and all modules loaded fine (Discord allows 100 commands, you have ${count}).`);
process.exit(0);
