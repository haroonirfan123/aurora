const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../lib/db');
const { ok, fail, ephemeral } = require('../lib/theme');
const tickets = require('../modules/tickets');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Ticket tools')
      .addSubcommand((s) =>
        s
          .setName('panel')
          .setDescription('Post the "open a ticket" panel (admin)')
          .addChannelOption((o) => o.setName('channel').setDescription('Where to post it').addChannelTypes(ChannelType.GuildText)),
      )
      .addSubcommand((s) => s.setName('add').setDescription('Add someone to this ticket').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from this ticket').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
      .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)))
      .addSubcommand((s) => s.setName('close').setDescription('Close this ticket').addStringOption((o) => o.setName('reason').setDescription('Why'))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const g = db.guild(interaction.guild.id);

      if (sub === 'panel') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply(ephemeral(fail('You need **Manage Server** to post panels.')));
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await tickets.postPanel(interaction.guild, channel);
        return interaction.reply(ephemeral(ok(`Ticket panel posted in ${channel}.`)));
      }

      const ticket = g.tickets[interaction.channel.id];
      if (!ticket) return interaction.reply(ephemeral(fail('Use this inside a ticket channel.')));
      const staff = tickets.isStaff(interaction.member);

      if (sub === 'close') {
        if (interaction.user.id !== ticket.ownerId && !staff) return interaction.reply(ephemeral(fail("You can't close this ticket.")));
        await interaction.reply(ephemeral(ok('Closing…')));
        return tickets.closeTicket(interaction.channel, interaction.user, interaction.options.getString('reason') || undefined);
      }
      if (!staff) return interaction.reply(ephemeral(fail('Only staff can do that.')));

      if (sub === 'add' || sub === 'remove') {
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.edit(user.id, sub === 'add' ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false });
        return interaction.reply({ embeds: [ok(sub === 'add' ? `Added ${user} to the ticket.` : `Removed ${user} from the ticket.`)] });
      }
      if (sub === 'rename') {
        const name = interaction.options.getString('name');
        await interaction.channel.setName(name);
        return interaction.reply({ embeds: [ok(`Renamed to **${interaction.channel.name}**.`)] });
      }
    },
  },
];
