// Button giveaways with optional role requirement and rerolls.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral, COLORS } = require('../lib/theme');
const { ts } = require('../lib/util');

function render(guild, gw) {
  const lines = [
    gw.description ? `${gw.description}\n` : null,
    gw.ended ? `**Ended** ${ts(gw.endsAt)}` : `**Ends** ${ts(gw.endsAt)} (${ts(gw.endsAt, 'f')})`,
    `**Hosted by** <@${gw.hostId}>`,
    `**Winners** ${gw.winners}`,
    gw.requiredRoleId ? `**Required role** <@&${gw.requiredRoleId}>` : null,
    `**Entries** ${gw.entrants.length}`,
  ];
  if (gw.ended) lines.push('', gw.winnerIds.length ? `🏆 **Winner${gw.winnerIds.length > 1 ? 's' : ''}:** ${gw.winnerIds.map((id) => `<@${id}>`).join(', ')}` : '😢 Not enough entries — no winner.');
  const e = embed(guild, { title: `🎉  ${gw.prize}`, description: lines.filter((l) => l !== null).join('\n'), color: gw.ended ? COLORS.muted : undefined });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gw:enter')
      .setEmoji('🎉')
      .setLabel(gw.ended ? 'Giveaway ended' : `Enter · ${gw.entrants.length}`)
      .setStyle(gw.ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(gw.ended),
  );
  return { embeds: [e], components: [row] };
}

function pick(pool, n) {
  const copy = [...pool];
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
}

async function start(guild, channel, { prize, description, winners, durationMs, hostId, requiredRoleId }) {
  const gw = { channelId: channel.id, prize, description, winners, endsAt: Date.now() + durationMs, hostId, requiredRoleId, entrants: [], ended: false, winnerIds: [] };
  const msg = await channel.send(render(guild, gw));
  db.guild(guild.id).giveaways[msg.id] = gw;
  db.save();
  return msg;
}

async function end(guild, messageId) {
  const gw = db.guild(guild.id).giveaways[messageId];
  if (!gw || gw.ended) return null;
  gw.ended = true;
  gw.endsAt = Math.min(gw.endsAt, Date.now());
  gw.winnerIds = pick(gw.entrants, gw.winners);
  db.save();
  const channel = guild.channels.cache.get(gw.channelId);
  const msg = await channel?.messages.fetch(messageId).catch(() => null);
  if (msg) {
    await msg.edit(render(guild, gw)).catch(() => {});
    const text = gw.winnerIds.length
      ? `🎊 Congratulations ${gw.winnerIds.map((id) => `<@${id}>`).join(', ')}! You won **${gw.prize}**!`
      : `No valid entries for **${gw.prize}**, so there's no winner.`;
    await msg.reply({ content: text, allowedMentions: { users: gw.winnerIds } }).catch(() => {});
  }
  return gw;
}

async function reroll(guild, messageId, count = 1) {
  const gw = db.guild(guild.id).giveaways[messageId];
  if (!gw?.ended) return null;
  const fresh = pick(gw.entrants.filter((id) => !gw.winnerIds.includes(id)), count);
  if (!fresh.length) return [];
  gw.winnerIds.push(...fresh);
  db.save();
  const channel = guild.channels.cache.get(gw.channelId);
  const msg = await channel?.messages.fetch(messageId).catch(() => null);
  if (msg) {
    await msg.edit(render(guild, gw)).catch(() => {});
    await msg.reply({ content: `🔁 New winner${fresh.length > 1 ? 's' : ''}: ${fresh.map((id) => `<@${id}>`).join(', ')}! You won **${gw.prize}**!`, allowedMentions: { users: fresh } }).catch(() => {});
  }
  return fresh;
}

module.exports = {
  start,
  end,
  reroll,
  components: {
    async gw(interaction) {
      const gw = db.guild(interaction.guild.id).giveaways[interaction.message.id];
      if (!gw || gw.ended) return interaction.reply(ephemeral(fail('This giveaway has ended.')));
      if (gw.requiredRoleId && !interaction.member.roles.cache.has(gw.requiredRoleId))
        return interaction.reply(ephemeral(fail(`You need the <@&${gw.requiredRoleId}> role to enter.`)));
      const i = gw.entrants.indexOf(interaction.user.id);
      if (i >= 0) gw.entrants.splice(i, 1);
      else gw.entrants.push(interaction.user.id);
      db.save();
      await interaction.update(render(interaction.guild, gw));
      await interaction.followUp(ephemeral(i >= 0 ? ok('You left the giveaway.') : ok(`You're in! Good luck winning **${gw.prize}** 🍀`)));
    },
  },
  async tick(client) {
    for (const guild of client.guilds.cache.values()) {
      const g = db.guild(guild.id);
      for (const [id, gw] of Object.entries(g.giveaways)) {
        if (!gw.ended && Date.now() >= gw.endsAt) await end(guild, id);
        if (gw.ended && Date.now() - gw.endsAt > 30 * 864e5) delete g.giveaways[id];
      }
    }
  },
};
