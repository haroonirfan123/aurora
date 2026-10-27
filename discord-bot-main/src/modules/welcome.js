// Welcome / goodbye messages and auto-roles.
const { Events } = require('discord.js');
const db = require('../lib/db');
const { embed, COLORS } = require('../lib/theme');
const { fill } = require('../lib/util');

module.exports = {
  init(client) {
    client.on(Events.GuildMemberAdd, async (member) => {
      const cfg = db.guild(member.guild.id).config.welcome;
      if (db.guild(member.guild.id).raid.active) return; // don't greet raiders

      const roles = cfg.autoRoles.filter((id) => member.guild.roles.cache.get(id)?.editable);
      if (roles.length && !member.user.bot) await member.roles.add(roles, 'Auto-role').catch(() => {});

      if (cfg.enabled && cfg.channelId) {
        const channel = member.guild.channels.cache.get(cfg.channelId);
        const e = embed(member.guild, { title: `👋  Welcome, ${member.user.username}!`, description: fill(cfg.message, member, member.guild), thumbnail: member.displayAvatarURL({ size: 256 }) });
        channel?.send({ content: `${member}`, embeds: [e] }).catch(() => {});
      }
      if (cfg.dmEnabled && cfg.dmMessage) {
        const e = embed(member.guild, { title: `✨  ${member.guild.name}`, description: fill(cfg.dmMessage, member, member.guild), thumbnail: member.guild.iconURL() });
        member.send({ embeds: [e] }).catch(() => {});
      }
    });

    client.on(Events.GuildMemberRemove, async (member) => {
      const cfg = db.guild(member.guild.id).config.welcome;
      if (!cfg.leaveEnabled || !cfg.leaveChannelId) return;
      const channel = member.guild.channels.cache.get(cfg.leaveChannelId);
      const e = embed(member.guild, { description: `👋  ${fill(cfg.leaveMessage, member, member.guild)}`, color: COLORS.muted, footer: false });
      channel?.send({ embeds: [e] }).catch(() => {});
    });
  },
};
