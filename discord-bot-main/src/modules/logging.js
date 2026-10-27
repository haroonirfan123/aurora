// Server activity log: messages, members, roles, channels, bans and voice.
const { Events, AttachmentBuilder } = require('discord.js');
const db = require('../lib/db');
const { embed, COLORS } = require('../lib/theme');
const { log } = require('../lib/logger');
const { ts, truncate } = require('../lib/util');

const ignored = (guild, channelId) => db.guild(guild.id).config.logging.ignoredChannels.includes(channelId);
const who = (user) => ({ name: user.tag ?? user.username ?? 'Unknown', iconURL: user.displayAvatarURL?.() });

module.exports = {
  init(client) {
    client.on(Events.MessageDelete, async (message) => {
      if (!message.guild || message.author?.bot || ignored(message.guild, message.channelId)) return;
      const e = embed(message.guild, { title: '🗑️  Message deleted', color: COLORS.error });
      if (message.author) e.setAuthor(who(message.author));
      e.setDescription(message.content ? truncate(message.content, 3900) : '*Message was not cached, so its content is unknown.*');
      e.addFields({ name: 'Channel', value: `<#${message.channelId}>`, inline: true });
      if (message.author) e.addFields({ name: 'Author', value: `<@${message.author.id}>`, inline: true });
      if (message.attachments?.size) e.addFields({ name: 'Attachments', value: message.attachments.map((a) => a.name).join('\n') });
      log(message.guild, e, { type: 'messageDelete' });
    });

    client.on(Events.MessageBulkDelete, async (messages, channel) => {
      if (ignored(channel.guild, channel.id)) return;
      const text = [...messages.values()]
        .reverse()
        .map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag ?? 'Unknown'}: ${m.content ?? ''}`)
        .join('\n');
      const e = embed(channel.guild, { title: '🧹  Bulk delete', color: COLORS.error, description: `**${messages.size}** messages deleted in ${channel}` });
      const cfg = db.guild(channel.guild.id).config.logging;
      const target = cfg.enabled && cfg.events.messageDelete && cfg.channelId && channel.guild.channels.cache.get(cfg.channelId);
      if (target) target.send({ embeds: [e], files: [new AttachmentBuilder(Buffer.from(text), { name: 'deleted-messages.txt' })] }).catch(() => {});
    });

    client.on(Events.MessageUpdate, async (before, after) => {
      if (!after.guild || after.author?.bot || ignored(after.guild, after.channelId)) return;
      if (before.content === after.content || !after.content) return;
      const e = embed(after.guild, { title: '✏️  Message edited', color: COLORS.info, description: `[Jump to message](${after.url}) in <#${after.channelId}>` })
        .setAuthor(who(after.author))
        .addFields(
          { name: 'Before', value: truncate(before.content, 1020) || '*Not cached*' },
          { name: 'After', value: truncate(after.content, 1020) },
        );
      log(after.guild, e, { type: 'messageEdit' });
    });

    client.on(Events.GuildMemberAdd, async (member) => {
      const age = Date.now() - member.user.createdTimestamp;
      const e = embed(member.guild, { title: '📥  Member joined', color: COLORS.success, thumbnail: member.displayAvatarURL() })
        .setDescription(`${member} · ${member.user.tag}`)
        .addFields(
          { name: 'Account created', value: `${ts(member.user.createdTimestamp, 'D')} (${ts(member.user.createdTimestamp)})${age < 7 * 864e5 ? '  ⚠️ new account' : ''}`, inline: true },
          { name: 'Member count', value: `${member.guild.memberCount}`, inline: true },
        );
      log(member.guild, e, { type: 'memberJoin' });
    });

    client.on(Events.GuildMemberRemove, async (member) => {
      const roles = member.roles?.cache.filter((r) => r.id !== member.guild.id);
      const e = embed(member.guild, { title: '📤  Member left', color: COLORS.warn, thumbnail: member.displayAvatarURL() })
        .setDescription(`<@${member.id}> · ${member.user?.tag ?? member.id}`)
        .addFields({ name: 'Joined', value: member.joinedTimestamp ? ts(member.joinedTimestamp) : 'Unknown', inline: true });
      if (roles?.size) e.addFields({ name: 'Roles', value: truncate(roles.map(String).join(' '), 1020) });
      log(member.guild, e, { type: 'memberLeave' });
    });

    client.on(Events.GuildMemberUpdate, async (before, after) => {
      if (before.partial) return;
      const guild = after.guild;
      const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
      const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
      if (added.size || removed.size) {
        const e = embed(guild, { title: '🎭  Roles updated', color: COLORS.info, description: `${after}` }).setAuthor(who(after.user));
        if (added.size) e.addFields({ name: '➕ Added', value: added.map(String).join(' ') });
        if (removed.size) e.addFields({ name: '➖ Removed', value: removed.map(String).join(' ') });
        log(guild, e, { type: 'memberUpdate' });
      }
      if (before.nickname !== after.nickname) {
        const e = embed(guild, { title: '🏷️  Nickname changed', color: COLORS.info, description: `${after}` })
          .setAuthor(who(after.user))
          .addFields({ name: 'Before', value: before.nickname || '*None*', inline: true }, { name: 'After', value: after.nickname || '*None*', inline: true });
        log(guild, e, { type: 'memberUpdate' });
      }
    });

    client.on(Events.GuildBanAdd, async (ban) => {
      log(ban.guild, embed(ban.guild, { title: '🔨  Member banned', color: COLORS.error, description: `<@${ban.user.id}> · ${ban.user.tag}`, thumbnail: ban.user.displayAvatarURL() }), { type: 'bans' });
    });
    client.on(Events.GuildBanRemove, async (ban) => {
      log(ban.guild, embed(ban.guild, { title: '🕊️  Member unbanned', color: COLORS.success, description: `<@${ban.user.id}> · ${ban.user.tag}` }), { type: 'bans' });
    });

    client.on(Events.ChannelCreate, async (channel) => {
      if (!channel.guild) return;
      log(channel.guild, embed(channel.guild, { title: '📁  Channel created', color: COLORS.success, description: `${channel} · \`#${channel.name}\`` }), { type: 'channels' });
    });
    client.on(Events.ChannelDelete, async (channel) => {
      if (!channel.guild) return;
      log(channel.guild, embed(channel.guild, { title: '📁  Channel deleted', color: COLORS.error, description: `\`#${channel.name}\`` }), { type: 'channels' });
    });
    client.on(Events.GuildRoleCreate, async (role) => {
      log(role.guild, embed(role.guild, { title: '🎨  Role created', color: COLORS.success, description: `${role} · \`${role.name}\`` }), { type: 'roles' });
    });
    client.on(Events.GuildRoleDelete, async (role) => {
      log(role.guild, embed(role.guild, { title: '🎨  Role deleted', color: COLORS.error, description: `\`${role.name}\`` }), { type: 'roles' });
    });

    client.on(Events.VoiceStateUpdate, async (before, after) => {
      const member = after.member;
      if (!member || member.user.bot || before.channelId === after.channelId) return;
      let title, description, color;
      if (!before.channelId) [title, description, color] = ['🔊  Joined voice', `${member} joined <#${after.channelId}>`, COLORS.success];
      else if (!after.channelId) [title, description, color] = ['🔇  Left voice', `${member} left <#${before.channelId}>`, COLORS.warn];
      else [title, description, color] = ['🔀  Switched voice', `${member} moved <#${before.channelId}> → <#${after.channelId}>`, COLORS.info];
      log(after.guild, embed(after.guild, { title, description, color }).setAuthor(who(member.user)), { type: 'voice' });
    });
  },
};
