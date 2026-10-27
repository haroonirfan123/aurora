const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const { embed } = require('../lib/theme');
const { ts } = require('../lib/util');

const CATEGORIES = {
  general: ['🧭', 'General', 'Info and utility commands'],
  moderation: ['🛡️', 'Moderation', 'Ban, kick, timeout, warn, purge and lock'],
  security: ['🚨', 'Security', 'Lockdown and raid mode'],
  tickets: ['🎫', 'Tickets', 'Support ticket tools'],
  roles: ['🎭', 'Roles', 'Reaction and button roles'],
  afk: ['💤', 'AFK', 'Let people know you are away'],
  economy: ['🪙', 'Economy', 'Earn, spend and gamble coins'],
  community: ['🎉', 'Community', 'Polls, giveaways, reminders and announcements'],
};

function categoryEmbed(interaction, client, key) {
  const [icon, label, desc] = CATEGORIES[key];
  const cmds = [...client.commands.values()].filter((c) => c.category === key);
  const lines = cmds.map((c) => {
    const json = c.data.toJSON();
    const subs = (json.options || []).filter((o) => o.type === 1);
    if (subs.length) return subs.map((s) => `\`/${json.name} ${s.name}\` · ${s.description}`).join('\n');
    return `\`/${json.name}\` · ${json.description}`;
  });
  return embed(interaction.guild, { title: `${icon}  ${label}`, description: `*${desc}*\n\n${lines.join('\n')}` });
}

module.exports = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Browse everything the bot can do'),
    async execute(interaction, client) {
      const overview = embed(interaction.guild, {
        title: `✨  ${client.user.username}`,
        thumbnail: client.user.displayAvatarURL(),
        description:
          'Your all-in-one server companion. Pick a category below to see its commands.\n\n' +
          Object.values(CATEGORIES).map(([i, l, d]) => `${i}  **${l}** — ${d}`).join('\n'),
      });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`help:${interaction.user.id}`)
        .setPlaceholder('Choose a category…')
        .addOptions(Object.entries(CATEGORIES).map(([value, [emoji, label, description]]) => ({ value, emoji, label, description })));
      await interaction.reply({ embeds: [overview], components: [new ActionRowBuilder().addComponents(menu)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ping').setDescription("Check the bot's response time"),
    async execute(interaction, client) {
      await interaction.reply({ embeds: [embed(interaction.guild, { description: '🏓  Pinging…', footer: false })] });
      const sent = await interaction.fetchReply();
      const rtt = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply({
        embeds: [embed(interaction.guild, { description: `🏓  **Pong!**\nRound trip: \`${rtt}ms\` · Gateway: \`${client.ws.ping}ms\``, footer: false })],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server'),
    async execute(interaction) {
      const g = interaction.guild;
      const channels = g.channels.cache;
      const e = embed(g, { title: g.name, thumbnail: g.iconURL({ size: 256 }), description: g.description || null }).addFields(
        { name: '👑 Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: '📅 Created', value: ts(g.createdTimestamp, 'D'), inline: true },
        { name: '👥 Members', value: `${g.memberCount}`, inline: true },
        { name: '💬 Channels', value: `${channels.filter((c) => c.type === ChannelType.GuildText).size} text · ${channels.filter((c) => c.type === ChannelType.GuildVoice).size} voice`, inline: true },
        { name: '🎭 Roles', value: `${g.roles.cache.size - 1}`, inline: true },
        { name: '🚀 Boosts', value: `${g.premiumSubscriptionCount || 0} (tier ${g.premiumTier})`, inline: true },
      );
      if (g.bannerURL()) e.setImage(g.bannerURL({ size: 1024 }));
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Show information about a member')
      .addUserOption((o) => o.setName('user').setDescription('Who to look up')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const e = embed(interaction.guild, { title: user.tag, thumbnail: user.displayAvatarURL({ size: 256 }) }).addFields(
        { name: '🆔 ID', value: `\`${user.id}\``, inline: true },
        { name: '📅 Account created', value: ts(user.createdTimestamp, 'R'), inline: true },
      );
      if (member) {
        e.setColor(member.displayColor || null);
        e.addFields({ name: '📥 Joined server', value: ts(member.joinedTimestamp, 'R'), inline: true });
        const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
        e.addFields({ name: `🎭 Roles (${roles.size})`, value: roles.size ? roles.first(15).join(' ') : 'None' });
      }
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription("Show someone's avatar")
      .addUserOption((o) => o.setName('user').setDescription('Whose avatar')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const e = embed(interaction.guild, { title: `${user.username}'s avatar` }).setImage(user.displayAvatarURL({ size: 1024 }));
      await interaction.reply({ embeds: [e] });
    },
  },
];

module.exports.categoryEmbed = categoryEmbed;
