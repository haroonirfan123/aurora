require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Events, ActivityType } = require('discord.js');
const db = require('./lib/db');
const { fail, ephemeral } = require('./lib/theme');

for (const key of ['DISCORD_TOKEN', 'GUILD_ID']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
  allowedMentions: { parse: ['users'], repliedUser: false },
});

// ── Commands: every file in /commands exports an array of { data, execute, autocomplete? }
client.commands = new Map();
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  for (const cmd of require(`./commands/${file}`)) client.commands.set(cmd.data.name, { ...cmd, category: file.replace('.js', '') });
}

// ── Modules: each may export init(client), components { prefix: fn }, modals { prefix: fn }, tick(client)
const modules = fs
  .readdirSync(path.join(__dirname, 'modules'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => require(`./modules/${f}`));
const components = {};
const modals = {};
for (const mod of modules) {
  mod.init?.(client);
  Object.assign(components, mod.components);
  Object.assign(modals, mod.modals);
}

client.once(Events.ClientReady, async () => {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) {
    console.error(`The bot is not in the server ${process.env.GUILD_ID}. Invite it first (see README).`);
  } else {
    await guild.commands.set([...client.commands.values()].map((c) => c.data.toJSON()));
    await guild.members.fetch().catch(() => {});
    console.log(`✓ Registered ${client.commands.size} slash commands in ${guild.name}`);
  }
  client.user.setPresence({ activities: [{ name: 'over the server', type: ActivityType.Watching }], status: 'online' });
  console.log(`✓ Logged in as ${client.user.tag}`);

  // One heartbeat for everything time-based (giveaways, polls, reminders, schedules…)
  setInterval(() => {
    for (const mod of modules) Promise.resolve(mod.tick?.(client)).catch((e) => console.error('[tick]', e));
  }, 15_000);

  if (process.env.CLIENT_SECRET) require('./dashboard/server')(client);
  else console.log('ℹ Dashboard disabled (set CLIENT_SECRET in .env to enable it)');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction, client);
    } else if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, client);
    } else if (interaction.isMessageComponent()) {
      const [prefix, ...args] = interaction.customId.split(':');
      if (components[prefix]) await components[prefix](interaction, args, client);
    } else if (interaction.isModalSubmit()) {
      const [prefix, ...args] = interaction.customId.split(':');
      if (modals[prefix]) await modals[prefix](interaction, args, client);
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.commandName || interaction.customId}:`, err);
    if (interaction.isAutocomplete()) return;
    const payload = ephemeral(fail('Something went wrong while doing that.'));
    if (interaction.deferred || interaction.replied) interaction.followUp(payload).catch(() => {});
    else interaction.reply(payload).catch(() => {});
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

// Load saved data, make sure the server's settings exist, then connect to Discord.
db.init()
  .then(() => {
    db.guild(process.env.GUILD_ID);
    return client.login(process.env.DISCORD_TOKEN);
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
