// Personal reminders, delivered in the channel they were made in (or by DM).
const db = require('../lib/db');
const { embed } = require('../lib/theme');
const { ts } = require('../lib/util');

module.exports = {
  async tick(client) {
    for (const guild of client.guilds.cache.values()) {
      const g = db.guild(guild.id);
      const due = g.reminders.filter((r) => Date.now() >= r.at);
      if (!due.length) continue;
      g.reminders = g.reminders.filter((r) => Date.now() < r.at);
      db.save();
      for (const r of due) {
        const e = embed(guild, { title: '⏰  Reminder', description: `${r.text}\n\n-# You asked me ${ts(r.createdAt)}` });
        const channel = guild.channels.cache.get(r.channelId);
        const sent = await channel?.send({ content: `<@${r.userId}>`, embeds: [e], allowedMentions: { users: [r.userId] } }).catch(() => null);
        if (!sent) {
          const user = await client.users.fetch(r.userId).catch(() => null);
          await user?.send({ embeds: [e] }).catch(() => {});
        }
      }
    }
  },
};
