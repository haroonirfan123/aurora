const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral, COLORS } = require('../lib/theme');
const { addCase, notify, hierarchyError, warn } = require('../lib/moderation');
const { parseDuration, formatDuration, ts, truncate } = require('../lib/util');

const reasonOpt = (o) => o.setName('reason').setDescription('Why').setMaxLength(500);

// Fetches the target member and checks the role hierarchy; replies with an error if not allowed.
async function resolveTarget(interaction) {
  const user = interaction.options.getUser('user');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply(ephemeral(fail('That user is not in this server.')));
    return null;
  }
  const err = hierarchyError(interaction.member, member);
  if (err) {
    await interaction.reply(ephemeral(fail(err)));
    return null;
  }
  return member;
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to ban').setRequired(true))
      .addStringOption(reasonOpt)
      .addIntegerOption((o) =>
        o.setName('delete_messages').setDescription('Delete their recent messages').addChoices(
          { name: "Don't delete", value: 0 },
          { name: 'Last hour', value: 3600 },
          { name: 'Last 24 hours', value: 86400 },
          { name: 'Last 7 days', value: 604800 },
        ),
      ),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason given';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        const err = hierarchyError(interaction.member, member);
        if (err) return interaction.reply(ephemeral(fail(err)));
        await notify(interaction.guild, user, 'ban', reason);
      }
      await interaction.guild.members.ban(user, { reason: `${interaction.user.tag}: ${reason}`, deleteMessageSeconds: interaction.options.getInteger('delete_messages') || 0 });
      const id = addCase(interaction.guild, { action: 'ban', target: user, moderator: interaction.user, reason });
      await interaction.reply({ embeds: [ok(`**${user.tag}** was banned · Case #${id}\n> ${reason}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption((o) => o.setName('user_id').setDescription('The user ID to unban').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const id = interaction.options.getString('user_id').trim();
      const reason = interaction.options.getString('reason') || 'No reason given';
      const user = await interaction.guild.members.unban(id, reason).catch(() => null);
      if (!user) return interaction.reply(ephemeral(fail("That user isn't banned, or the ID is wrong.")));
      const caseId = addCase(interaction.guild, { action: 'unban', target: user, moderator: interaction.user, reason });
      await interaction.reply({ embeds: [ok(`**${user.tag}** was unbanned · Case #${caseId}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const member = await resolveTarget(interaction);
      if (!member) return;
      const reason = interaction.options.getString('reason') || 'No reason given';
      await notify(interaction.guild, member.user, 'kick', reason);
      await member.kick(`${interaction.user.tag}: ${reason}`);
      const id = addCase(interaction.guild, { action: 'kick', target: member.user, moderator: interaction.user, reason });
      await interaction.reply({ embeds: [ok(`**${member.user.tag}** was kicked · Case #${id}\n> ${reason}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Stop a member from talking for a while')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to time out').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms || ms > 28 * 864e5) return interaction.reply(ephemeral(fail('Use a duration like `10m`, `2h` or `1d` (up to 28 days).')));
      const member = await resolveTarget(interaction);
      if (!member) return;
      const reason = interaction.options.getString('reason') || 'No reason given';
      await member.timeout(ms, `${interaction.user.tag}: ${reason}`);
      await notify(interaction.guild, member.user, 'timeout', reason, ms);
      const id = addCase(interaction.guild, { action: 'timeout', target: member.user, moderator: interaction.user, reason, duration: ms });
      await interaction.reply({ embeds: [ok(`**${member.user.tag}** was timed out for **${formatDuration(ms)}** · Case #${id}\n> ${reason}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription("Remove a member's timeout")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to un-mute').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const member = await resolveTarget(interaction);
      if (!member) return;
      if (!member.isCommunicationDisabled()) return interaction.reply(ephemeral(fail("That member isn't timed out.")));
      const reason = interaction.options.getString('reason') || 'No reason given';
      await member.timeout(null, reason);
      addCase(interaction.guild, { action: 'untimeout', target: member.user, moderator: interaction.user, reason });
      await interaction.reply({ embeds: [ok(`**${member.user.tag}** can talk again.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Give a member a warning')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to warn').setRequired(true))
      .addStringOption((o) => reasonOpt(o).setRequired(true)),
    async execute(interaction) {
      const member = await resolveTarget(interaction);
      if (!member) return;
      const reason = interaction.options.getString('reason');
      const { count, escalated } = await warn(interaction.guild, member, interaction.user, reason);
      const extra = escalated ? `\n🔺 They reached ${count} warnings and were **${escalated}**.` : '';
      await interaction.reply({ embeds: [ok(`**${member.user.tag}** was warned (warning #${count})\n> ${reason}${extra}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription("See a member's warnings")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Whose warnings').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const list = db.guild(interaction.guild.id).warnings[user.id] || [];
      const e = embed(interaction.guild, { title: `⚠️  Warnings for ${user.username}`, thumbnail: user.displayAvatarURL(), color: COLORS.warn });
      e.setDescription(
        list.length
          ? list.slice(-15).map((w, i) => `**${i + 1}.** ${truncate(w.reason, 120)}\n┗ ${w.moderatorId ? `<@${w.moderatorId}>` : 'AutoMod'} · ${ts(w.at)} · \`${w.id}\``).join('\n')
          : 'This member has a clean record. ✨',
      );
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearwarnings')
      .setDescription("Clear a member's warnings")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Whose warnings').setRequired(true))
      .addStringOption((o) => o.setName('warning_id').setDescription('Only remove this one warning (ID from /warnings)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const g = db.guild(interaction.guild.id);
      const one = interaction.options.getString('warning_id');
      const list = g.warnings[user.id] || [];
      if (one) {
        const before = list.length;
        g.warnings[user.id] = list.filter((w) => w.id !== one);
        if (g.warnings[user.id].length === before) return interaction.reply(ephemeral(fail('No warning with that ID.')));
      } else {
        delete g.warnings[user.id];
      }
      db.save();
      addCase(interaction.guild, { action: 'clearwarns', target: user, moderator: interaction.user, reason: one ? `Removed warning ${one}` : 'Cleared all warnings' });
      await interaction.reply({ embeds: [ok(one ? `Removed that warning from **${user.tag}**.` : `Cleared all warnings for **${user.tag}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete recent messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user'))
      .addBooleanOption((o) => o.setName('bots').setDescription('Only delete messages from bots')),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const bots = interaction.options.getBoolean('bots');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter((m) => m.author.id === user.id);
      if (bots) messages = messages.filter((m) => m.author.bot);
      const deleted = await interaction.channel.bulkDelete([...messages.values()].slice(0, amount), true);
      addCase(interaction.guild, { action: 'purge', moderator: interaction.user, reason: `Deleted ${deleted.size} messages in <#${interaction.channel.id}>${user ? ` from ${user.tag}` : ''}` });
      await interaction.editReply({ embeds: [ok(`Deleted **${deleted.size}** messages.${deleted.size < amount ? '\n-# Messages older than 14 days can\'t be bulk deleted.' : ''}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set slowmode for this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 5s, 1m, 2h — or "off"').setRequired(true)),
    async execute(interaction) {
      const raw = interaction.options.getString('duration');
      const ms = raw.toLowerCase() === 'off' ? 0 : parseDuration(raw);
      if (ms === null || ms > 6 * 36e5) return interaction.reply(ephemeral(fail('Use something like `5s`, `1m` or `off` (max 6h).')));
      await interaction.channel.setRateLimitPerUser(Math.round(ms / 1000));
      await interaction.reply({ embeds: [ok(ms ? `Slowmode set to **${formatDuration(ms)}**.` : 'Slowmode turned off.')] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Stop everyone from sending messages in a channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addChannelOption((o) => o.setName('channel').setDescription('Defaults to this channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason') || 'No reason given';
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason });
      await channel.send({ embeds: [embed(interaction.guild, { title: '🔒  Channel locked', description: `> ${reason}`, color: COLORS.error })] }).catch(() => {});
      await interaction.reply(ephemeral(ok(`Locked ${channel}.`)));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Let everyone talk in a channel again')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addChannelOption((o) => o.setName('channel').setDescription('Defaults to this channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await channel.send({ embeds: [embed(interaction.guild, { title: '🔓  Channel unlocked', color: COLORS.success })] }).catch(() => {});
      await interaction.reply(ephemeral(ok(`Unlocked ${channel}.`)));
    },
  },
];
