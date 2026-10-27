// Announcements: sent now (command or dashboard) or on a schedule.
const { ChannelType } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral } = require('../lib/theme');

async function send(guild, { channelId, title, message, pingRoleId, imageUrl, color }) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) throw new Error('That channel does not exist or is not a text channel.');
  const e = embed(guild, { title: title ? `📢  ${title}` : undefined, description: message, color });
  if (imageUrl && /^https?:\/\//.test(imageUrl)) e.setImage(imageUrl);
  let content;
  let allowedMentions = { parse: [] };
  if (pingRoleId === 'everyone') {
    content = '@everyone';
    allowedMentions = { parse: ['everyone'] };
  } else if (pingRoleId) {
    content = `<@&${pingRoleId}>`;
    allowedMentions = { roles: [pingRoleId] };
  }
  const msg = await channel.send({ content, embeds: [e], allowedMentions });
  if (channel.type === ChannelType.GuildAnnouncement) await msg.crosspost().catch(() => {});
  return msg;
}

module.exports = {
  send,
  modals: {
    // announce:<channelId>:<roleId|everyone|none>
    async announce(interaction, [channelId, ping]) {
      try {
        await send(interaction.guild, {
          channelId,
          title: interaction.fields.getTextInputValue('title'),
          message: interaction.fields.getTextInputValue('message'),
          imageUrl: interaction.fields.getTextInputValue('image'),
          pingRoleId: ping === 'none' ? '' : ping,
        });
        await interaction.reply(ephemeral(ok(`Announcement sent in <#${channelId}>.`)));
      } catch (err) {
        await interaction.reply(ephemeral(fail(err.message)));
      }
    },
  },
  async tick(client) {
    for (const guild of client.guilds.cache.values()) {
      const g = db.guild(guild.id);
      let changed = false;
      for (const a of g.config.announcements.scheduled) {
        if (!a.enabled || !a.nextRun || Date.now() < a.nextRun) continue;
        await send(guild, a).catch((e) => console.error('[announce]', e.message));
        if (a.repeatHours > 0) {
          while (a.nextRun <= Date.now()) a.nextRun += a.repeatHours * 36e5;
        } else {
          a.enabled = false;
        }
        changed = true;
      }
      if (changed) db.save();
    }
  },
};
