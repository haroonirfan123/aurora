const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral, COLORS } = require('../lib/theme');
const { lockdown, unlockdown } = require('../lib/moderation');
const { parseDuration, ts } = require('../lib/util');
const antiraid = require('../modules/antiraid');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Lock or unlock every public channel at once')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((s) => s.setName('start').setDescription('Lock all public channels').addStringOption((o) => o.setName('reason').setDescription('Why')))
      .addSubcommand((s) => s.setName('end').setDescription('Unlock the channels locked by /lockdown start')),
    async execute(interaction) {
      await interaction.deferReply();
      if (interaction.options.getSubcommand() === 'start') {
        const reason = interaction.options.getString('reason') || 'Server lockdown';
        const n = await lockdown(interaction.guild, interaction.user, reason);
        await interaction.editReply({ embeds: [embed(interaction.guild, { title: '🔒  Server locked down', description: `Locked **${n}** channels.\n> ${reason}`, color: COLORS.error })] });
      } else {
        if (!db.guild(interaction.guild.id).lockdown.length) return interaction.editReply({ embeds: [fail('There is no active lockdown.')] });
        const n = await unlockdown(interaction.guild, interaction.user, 'Lockdown ended');
        await interaction.editReply({ embeds: [embed(interaction.guild, { title: '🔓  Lockdown lifted', description: `Unlocked **${n}** channels.`, color: COLORS.success })] });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('raidmode')
      .setDescription('Turn raid mode on or off (new joiners are removed while it is on)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((s) =>
        s.setName('on').setDescription('Turn raid mode on').addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 30m (default from dashboard)')),
      )
      .addSubcommand((s) => s.setName('off').setDescription('Turn raid mode off'))
      .addSubcommand((s) => s.setName('status').setDescription('Show the current security status')),
    async execute(interaction) {
      const g = db.guild(interaction.guild.id);
      const sub = interaction.options.getSubcommand();
      if (sub === 'on') {
        const raw = interaction.options.getString('duration');
        const ms = raw ? parseDuration(raw) : null;
        if (raw && !ms) return interaction.reply(ephemeral(fail('Use a duration like `30m` or `2h`.')));
        await antiraid.startRaid(interaction.guild, `Turned on by ${interaction.user.tag}`, ms);
        return interaction.reply({ embeds: [ok(`Raid mode is **on** until ${ts(g.raid.until)}. New members will be removed.`)] });
      }
      if (sub === 'off') {
        if (!g.raid.active) return interaction.reply(ephemeral(fail('Raid mode is already off.')));
        await antiraid.endRaid(interaction.guild, `Turned off by ${interaction.user.tag}`);
        return interaction.reply({ embeds: [ok('Raid mode is **off**.')] });
      }
      const c = g.config.antiraid;
      const a = g.config.automod;
      const on = (v) => (v ? '🟢' : '⚫');
      const e = embed(interaction.guild, { title: '🛡️  Security status' }).addFields(
        { name: 'Raid mode', value: g.raid.active ? `🔴 Active — ends ${ts(g.raid.until)}` : '🟢 Calm', inline: true },
        { name: 'Lockdown', value: g.lockdown.length ? `🔒 ${g.lockdown.length} channels` : '🔓 None', inline: true },
        { name: '​', value: '​', inline: true },
        {
          name: 'Anti-raid',
          value: `${on(c.enabled)} Join-burst detection (${c.joinThreshold} joins / ${c.joinSeconds}s)\n${on(c.antiNuke)} Anti-nuke\n${on(c.antiBotAdd)} Block unapproved bots\n${on(c.minAccountAgeDays > 0)} Min account age: ${c.minAccountAgeDays}d`,
          inline: true,
        },
        {
          name: 'AutoMod',
          value: `${on(a.enabled && a.antiSpam)} Spam\n${on(a.enabled && a.antiInvite)} Invites\n${on(a.enabled && a.antiLinks)} Links\n${on(a.enabled && a.antiMassMention)} Mass mentions\n${on(a.enabled && a.antiCaps)} Caps\n${on(a.enabled && a.bannedWords.length)} Word filter (${a.bannedWords.length})`,
          inline: true,
        },
      );
      await interaction.reply({ embeds: [e] });
    },
  },
];
