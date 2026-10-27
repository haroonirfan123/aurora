// Economy accounts + coins for chatting.
const { Events } = require('discord.js');
const db = require('../lib/db');
const { randInt, fmt } = require('../lib/util');

function account(guildId, userId) {
  const g = db.guild(guildId);
  if (!g.economy[userId]) {
    g.economy[userId] = { wallet: g.config.economy.startingBalance, bank: 0, inv: {}, cd: {}, streak: 0 };
    db.save();
  }
  return g.economy[userId];
}

// "🪙 1,250 coins"
function money(guildId, amount) {
  const c = db.guild(guildId).config.economy;
  return `${c.currencyEmoji} **${fmt(amount)}** ${c.currencyName}`;
}

module.exports = {
  account,
  money,
  init(client) {
    client.on(Events.MessageCreate, (message) => {
      if (!message.inGuild() || message.author.bot) return;
      const c = db.guild(message.guild.id).config.economy;
      if (!c.enabled || !c.chatRewards) return;
      const acc = account(message.guild.id, message.author.id);
      const now = Date.now();
      if (now - (acc.cd.chat || 0) < c.chatCooldownSeconds * 1000) return;
      acc.cd.chat = now;
      acc.wallet += randInt(c.chatMin, Math.max(c.chatMin, c.chatMax));
      db.save();
    });
  },
};
