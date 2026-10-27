const { categoryEmbed } = require('../commands/general');
const { fail, ephemeral } = require('../lib/theme');

module.exports = {
  components: {
    // help:<ownerId> — the category menu under /help
    async help(interaction, [ownerId], client) {
      if (interaction.user.id !== ownerId) return interaction.reply(ephemeral(fail('Run `/help` yourself to browse.')));
      await interaction.update({ embeds: [categoryEmbed(interaction, client, interaction.values[0])] });
    },
  },
};
