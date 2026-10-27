const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral } = require('../lib/theme');
const rr = require('../modules/reactionroles');

// "<:name:123>" → "123", "🔥" → "🔥"
function parseEmoji(raw) {
  const custom = raw.match(/<a?:\w+:(\d+)>/);
  return custom ? custom[1] : raw.trim();
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('reactionrole')
      .setDescription('Classic emoji reaction roles')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('React to a message with an emoji that gives a role')
          .addStringOption((o) => o.setName('message_id').setDescription('ID of the message (in this channel)').setRequired(true))
          .addStringOption((o) => o.setName('emoji').setDescription('The emoji').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove an emoji reaction role')
          .addStringOption((o) => o.setName('message_id').setDescription('ID of the message').setRequired(true))
          .addStringOption((o) => o.setName('emoji').setDescription('The emoji').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List all emoji reaction roles')),
    async execute(interaction) {
      const g = db.guild(interaction.guild.id);
      const list = g.config.reactionRoles.emoji;
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const lines = list.map((e) => `[message](https://discord.com/channels/${interaction.guild.id}/${e.channelId}/${e.messageId}) · ${/^\d+$/.test(e.emoji) ? `<:e:${e.emoji}>` : e.emoji} → <@&${e.roleId}>`);
        return interaction.reply({ embeds: [embed(interaction.guild, { title: '🎭  Emoji reaction roles', description: lines.join('\n') || 'None yet. Use `/reactionrole add`.' })] });
      }

      const messageId = interaction.options.getString('message_id');
      const emoji = parseEmoji(interaction.options.getString('emoji'));

      if (sub === 'remove') {
        const before = list.length;
        g.config.reactionRoles.emoji = list.filter((e) => !(e.messageId === messageId && e.emoji === emoji));
        db.save();
        return interaction.reply(ephemeral(before === g.config.reactionRoles.emoji.length ? fail('No reaction role matched.') : ok('Reaction role removed.')));
      }

      const role = interaction.options.getRole('role');
      if (!role.editable) return interaction.reply(ephemeral(fail("That role is above my highest role, so I can't give it.")));
      const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
      if (!message) return interaction.reply(ephemeral(fail("I couldn't find that message in this channel.")));
      try {
        await message.react(interaction.options.getString('emoji').trim());
      } catch {
        return interaction.reply(ephemeral(fail("I couldn't react with that emoji. Use a default emoji or one from this server.")));
      }
      list.push({ channelId: interaction.channel.id, messageId, emoji, roleId: role.id });
      db.save();
      await interaction.reply(ephemeral(ok(`Reacting with that emoji on [the message](${message.url}) now gives ${role}.`)));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rolepanel')
      .setDescription('Post a button role panel created in the dashboard')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addStringOption((o) => o.setName('panel').setDescription('Which panel').setRequired(true).setAutocomplete(true)),
    async autocomplete(interaction) {
      const q = interaction.options.getFocused().toLowerCase();
      const panels = db.guild(interaction.guild.id).config.reactionRoles.panels;
      await interaction.respond(panels.filter((p) => (p.title || '').toLowerCase().includes(q)).slice(0, 25).map((p) => ({ name: (p.title || 'Untitled panel').slice(0, 100), value: p.id })));
    },
    async execute(interaction) {
      const panel = db.guild(interaction.guild.id).config.reactionRoles.panels.find((p) => p.id === interaction.options.getString('panel'));
      if (!panel) return interaction.reply(ephemeral(fail('Panel not found. Create panels in the dashboard.')));
      try {
        const msg = await rr.postPanel(interaction.guild, panel);
        await interaction.reply(ephemeral(ok(`Panel posted: ${msg.url}`)));
      } catch (err) {
        await interaction.reply(ephemeral(fail(err.message)));
      }
    },
  },
];
