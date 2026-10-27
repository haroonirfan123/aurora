const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const { fail, ephemeral, brand } = require('../lib/theme');
const { setAfk } = require('../modules/afk');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('afk')
      .setDescription("Let people know you're away")
      .addStringOption((o) => o.setName('reason').setDescription("What you're up to").setMaxLength(200)),
    async execute(interaction) {
      if (!db.guild(interaction.guild.id).config.afk.enabled) return interaction.reply(ephemeral(fail('AFK is disabled on this server.')));
      const reason = interaction.options.getString('reason') || '';
      await setAfk(interaction.member, reason);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(brand(interaction.guild)).setDescription(`💤  ${interaction.user} is now AFK${reason ? `: ${reason}` : ''}`)],
      });
    },
  },
];
