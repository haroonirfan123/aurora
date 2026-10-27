// AFK status: tells people who ping you that you're away, and welcomes you back.
const { Events, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const { COLORS, brand } = require('../lib/theme');
const { ts, formatDuration, truncate } = require('../lib/util');

async function setAfk(member, reason) {
  const g = db.guild(member.guild.id);
  g.afk[member.id] = { reason, since: Date.now(), mentions: [], oldNick: member.nickname };
  db.save();
  const prefix = g.config.afk.nickPrefix;
  if (prefix && member.manageable && !member.displayName.startsWith(prefix)) {
    await member.setNickname(`${prefix}${member.displayName}`.slice(0, 32), 'AFK').catch(() => {});
  }
}

async function clearAfk(member) {
  const g = db.guild(member.guild.id);
  const data = g.afk[member.id];
  if (!data) return null;
  delete g.afk[member.id];
  db.save();
  if (member.manageable && member.displayName.startsWith(g.config.afk.nickPrefix)) {
    await member.setNickname(data.oldNick ?? null, 'Back from AFK').catch(() => {});
  }
  return data;
}

const tempReply = async (message, e) => {
  const reply = await message.reply({ embeds: [e], allowedMentions: { repliedUser: false } }).catch(() => null);
  if (reply) setTimeout(() => reply.delete().catch(() => {}), 12_000);
};

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot) return;
  const g = db.guild(message.guild.id);
  if (!g.config.afk.enabled) return;

  // They're back
  if (g.afk[message.author.id] && message.member) {
    const data = await clearAfk(message.member);
    const links = data.mentions.slice(-5).map((m) => `• <@${m.by}> — [jump](${m.url})`).join('\n');
    const e = new EmbedBuilder()
      .setColor(COLORS.success)
      .setDescription(
        `👋  Welcome back ${message.author}! You were away for **${formatDuration(Date.now() - data.since)}**.` +
          (data.mentions.length ? `\n\nYou were mentioned **${data.mentions.length}** time(s):\n${links}` : ''),
      );
    await tempReply(message, e);
  }

  // Someone pinged an AFK person
  const pinged = message.mentions.users.filter((u) => u.id !== message.author.id && g.afk[u.id]);
  if (!pinged.size) return;
  const lines = pinged.map((u) => {
    const data = g.afk[u.id];
    data.mentions.push({ by: message.author.id, url: message.url, at: Date.now() });
    if (data.mentions.length > 25) data.mentions.shift();
    return `💤  **${u.username}** is AFK${data.reason ? `: ${truncate(data.reason, 200)}` : ''} · ${ts(data.since)}`;
  });
  db.save();
  await tempReply(message, new EmbedBuilder().setColor(brand(message.guild)).setDescription(lines.join('\n')));
}

module.exports = {
  setAfk,
  init(client) {
    client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[afk]', e)));
  },
};
