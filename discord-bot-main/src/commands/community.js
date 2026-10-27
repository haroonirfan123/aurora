const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral } = require('../lib/theme');
const { parseDuration, formatDuration, ts, truncate } = require('../lib/util');
const polls = require('../modules/polls');
const giveaways = require('../modules/giveaways');

const MAX_DURATION = 60 * 864e5;

// Accepts a message link or a raw message ID.
const messageIdFrom = (raw) => raw.trim().split('/').pop();

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a poll with buttons')
      .addStringOption((o) => o.setName('question').setDescription('What are you asking?').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('options').setDescription('2–10 choices separated by | e.g. Pizza | Burgers | Tacos').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('How long it runs, e.g. 1h, 2d (default 24h)')),
    async execute(interaction) {
      const options = interaction.options
        .getString('options')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => truncate(s, 80));
      if (options.length < 2 || options.length > 10) return interaction.reply(ephemeral(fail('Give between 2 and 10 options separated by `|`.')));
      const raw = interaction.options.getString('duration');
      const durationMs = raw ? parseDuration(raw) : 864e5;
      if (!durationMs || durationMs > MAX_DURATION) return interaction.reply(ephemeral(fail('Use a duration like `30m`, `2h` or `3d` (max 60d).')));
      await polls.create(interaction, { question: interaction.options.getString('question'), options, durationMs });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('endpoll')
      .setDescription('End a poll early')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((o) => o.setName('message').setDescription('Poll message ID or link').setRequired(true)),
    async execute(interaction) {
      const done = await polls.end(interaction.guild, messageIdFrom(interaction.options.getString('message')));
      await interaction.reply(ephemeral(done ? ok('Poll ended.') : fail('No running poll with that ID.')));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Run giveaways')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('start')
          .setDescription('Start a giveaway')
          .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('duration').setDescription('e.g. 1h, 3d').setRequired(true))
          .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
          .addChannelOption((o) => o.setName('channel').setDescription('Where to post it').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can enter'))
          .addStringOption((o) => o.setName('description').setDescription('Extra details').setMaxLength(1000)),
      )
      .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now').addStringOption((o) => o.setName('message').setDescription('Giveaway message ID or link').setRequired(true)))
      .addSubcommand((s) =>
        s
          .setName('reroll')
          .setDescription('Pick new winner(s)')
          .addStringOption((o) => o.setName('message').setDescription('Giveaway message ID or link').setRequired(true))
          .addIntegerOption((o) => o.setName('count').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List running giveaways')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'start') {
        const durationMs = parseDuration(interaction.options.getString('duration'));
        if (!durationMs || durationMs > MAX_DURATION) return interaction.reply(ephemeral(fail('Use a duration like `1h` or `3d` (max 60d).')));
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const msg = await giveaways.start(interaction.guild, channel, {
          prize: interaction.options.getString('prize'),
          description: interaction.options.getString('description') || '',
          winners: interaction.options.getInteger('winners') || 1,
          durationMs,
          hostId: interaction.user.id,
          requiredRoleId: interaction.options.getRole('required_role')?.id || '',
        });
        return interaction.reply(ephemeral(ok(`Giveaway started: ${msg.url} — ends in **${formatDuration(durationMs)}**.`)));
      }
      if (sub === 'end') {
        const gw = await giveaways.end(interaction.guild, messageIdFrom(interaction.options.getString('message')));
        return interaction.reply(ephemeral(gw ? ok('Giveaway ended.') : fail('No running giveaway with that ID.')));
      }
      if (sub === 'reroll') {
        const winners = await giveaways.reroll(interaction.guild, messageIdFrom(interaction.options.getString('message')), interaction.options.getInteger('count') || 1);
        if (winners === null) return interaction.reply(ephemeral(fail("That giveaway doesn't exist or hasn't ended yet.")));
        return interaction.reply(ephemeral(winners.length ? ok('Rerolled!') : fail('Nobody else entered, so there is no one to reroll to.')));
      }
      const running = Object.entries(db.guild(interaction.guild.id).giveaways).filter(([, g]) => !g.ended);
      const lines = running.map(([id, g]) => `🎉 **${g.prize}** · [jump](https://discord.com/channels/${interaction.guild.id}/${g.channelId}/${id}) · ends ${ts(g.endsAt)} · ${g.entrants.length} entries`);
      await interaction.reply(ephemeral(embed(interaction.guild, { title: '🎉  Running giveaways', description: lines.join('\n') || 'None right now.' })));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Set a reminder')
      .addStringOption((o) => o.setName('in').setDescription('When, e.g. 10m, 2h, 1d').setRequired(true))
      .addStringOption((o) => o.setName('about').setDescription('What to remind you about').setRequired(true).setMaxLength(1000)),
    async execute(interaction) {
      const ms = parseDuration(interaction.options.getString('in'));
      if (!ms || ms < 1e4 || ms > 365 * 864e5) return interaction.reply(ephemeral(fail('Use a time like `10m`, `2h` or `3d` (up to a year).')));
      const g = db.guild(interaction.guild.id);
      if (g.reminders.filter((r) => r.userId === interaction.user.id).length >= 25) return interaction.reply(ephemeral(fail('You have too many reminders (25 max).')));
      const r = { id: db.uid(), userId: interaction.user.id, channelId: interaction.channel.id, text: interaction.options.getString('about'), at: Date.now() + ms, createdAt: Date.now() };
      g.reminders.push(r);
      db.save();
      await interaction.reply(ephemeral(ok(`I'll remind you ${ts(r.at)}: *${truncate(r.text, 200)}*`)));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('reminders')
      .setDescription('Manage your reminders')
      .addSubcommand((s) => s.setName('list').setDescription('Show your reminders'))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder').addStringOption((o) => o.setName('id').setDescription('Reminder ID from /reminders list').setRequired(true))),
    async execute(interaction) {
      const g = db.guild(interaction.guild.id);
      const mine = g.reminders.filter((r) => r.userId === interaction.user.id).sort((a, b) => a.at - b.at);
      if (interaction.options.getSubcommand() === 'cancel') {
        const id = interaction.options.getString('id').trim();
        if (!mine.some((r) => r.id === id)) return interaction.reply(ephemeral(fail('No reminder with that ID.')));
        g.reminders = g.reminders.filter((r) => r.id !== id);
        db.save();
        return interaction.reply(ephemeral(ok('Reminder cancelled.')));
      }
      const lines = mine.map((r) => `⏰ ${ts(r.at)} · ${truncate(r.text, 80)}\n┗ ID \`${r.id}\``);
      await interaction.reply(ephemeral(embed(interaction.guild, { title: '⏰  Your reminders', description: lines.join('\n') || 'You have no reminders.' })));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Write and send a styled announcement')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((o) => o.setName('channel').setDescription('Where to send it').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('ping').setDescription('Role to ping'))
      .addBooleanOption((o) => o.setName('ping_everyone').setDescription('Ping @everyone')),
    async execute(interaction) {
      const channelId = interaction.options.getChannel('channel')?.id || db.guild(interaction.guild.id).config.announcements.defaultChannelId || interaction.channel.id;
      const ping = interaction.options.getBoolean('ping_everyone') ? 'everyone' : interaction.options.getRole('ping')?.id || 'none';
      const modal = new ModalBuilder()
        .setCustomId(`announce:${channelId}:${ping}`)
        .setTitle('New announcement')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Message (markdown works)').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL (optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        );
      await interaction.showModal(modal);
    },
  },
];
