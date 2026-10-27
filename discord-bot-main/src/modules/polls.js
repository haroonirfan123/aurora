// Button polls with live result bars.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, ephemeral, fail, COLORS } = require('../lib/theme');
const { bar, ts, truncate } = require('../lib/util');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function render(guild, poll) {
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(...counts);
  const lines = poll.options.map((opt, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    const crown = poll.ended && total && counts[i] === top ? '  🏆' : '';
    return `${NUMBERS[i]}  **${opt}**${crown}\n${bar(total ? counts[i] / total : 0)}  ${pct}% · ${counts[i]} vote${counts[i] === 1 ? '' : 's'}`;
  });
  const status = poll.ended ? `Poll ended ${ts(poll.endsAt)}` : `Ends ${ts(poll.endsAt)}`;
  const e = embed(guild, {
    title: `📊  ${poll.question}`,
    description: `${lines.join('\n\n')}\n\n-# ${total} total vote${total === 1 ? '' : 's'} · ${status} · by <@${poll.hostId}>`,
    color: poll.ended ? COLORS.muted : undefined,
  });
  const rows = [];
  poll.options.forEach((opt, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder());
    rows[rows.length - 1].addComponents(
      new ButtonBuilder().setCustomId(`poll:${i}`).setEmoji(NUMBERS[i]).setLabel(truncate(opt, 40)).setStyle(ButtonStyle.Secondary).setDisabled(poll.ended),
    );
  });
  return { embeds: [e], components: rows };
}

async function create(interaction, { question, options, durationMs }) {
  const g = db.guild(interaction.guild.id);
  const poll = { channelId: interaction.channel.id, question, options, votes: {}, endsAt: Date.now() + durationMs, ended: false, hostId: interaction.user.id };
  await interaction.reply(render(interaction.guild, poll));
  const msg = await interaction.fetchReply();
  g.polls[msg.id] = poll;
  db.save();
}

async function end(guild, messageId) {
  const g = db.guild(guild.id);
  const poll = g.polls[messageId];
  if (!poll || poll.ended) return false;
  poll.ended = true;
  db.save();
  const channel = guild.channels.cache.get(poll.channelId);
  const msg = await channel?.messages.fetch(messageId).catch(() => null);
  if (msg) await msg.edit(render(guild, poll)).catch(() => {});
  return true;
}

module.exports = {
  create,
  end,
  components: {
    async poll(interaction, [idx]) {
      const g = db.guild(interaction.guild.id);
      const poll = g.polls[interaction.message.id];
      if (!poll || poll.ended) return interaction.reply(ephemeral(fail('This poll has ended.')));
      const i = Number(idx);
      let note;
      if (poll.votes[interaction.user.id] === i) {
        delete poll.votes[interaction.user.id];
        note = 'Your vote was removed.';
      } else {
        poll.votes[interaction.user.id] = i;
        note = `You voted for **${poll.options[i]}**.`;
      }
      db.save();
      await interaction.update(render(interaction.guild, poll));
      await interaction.followUp(ephemeral(ok(note)));
    },
  },
  async tick(client) {
    for (const guild of client.guilds.cache.values()) {
      const g = db.guild(guild.id);
      for (const [id, poll] of Object.entries(g.polls)) {
        if (!poll.ended && Date.now() >= poll.endsAt) await end(guild, id);
        // Forget polls a week after they end
        if (poll.ended && Date.now() - poll.endsAt > 7 * 864e5) delete g.polls[id];
      }
    }
  },
};
