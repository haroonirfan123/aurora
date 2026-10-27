const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral, COLORS } = require('../lib/theme');
const { account, money } = require('../modules/economy');
const { randInt, formatDuration, fmt } = require('../lib/util');

const JOBS = [
  'designed a logo for a local café',
  'fixed a bug that nobody else could find',
  'walked seven very energetic dogs',
  'streamed for six hours straight',
  'delivered pizzas in the rain',
  'moderated a chaotic Discord server',
  'tutored someone in maths',
  'sold handmade bracelets',
  'edited a YouTube video',
  'baked 200 cookies for a bake sale',
];
const SLOTS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
const SLOT_PAYOUT = { '🍒': 3, '🍋': 4, '🍇': 5, '🔔': 8, '💎': 15, '7️⃣': 25 };

const cfg = (interaction) => db.guild(interaction.guild.id).config.economy;

// Returns null if ready, or a reply payload if still on cooldown.
function cooldown(acc, key, ms) {
  const left = (acc.cd[key] || 0) + ms - Date.now();
  return left > 0 ? left : null;
}

// Parses "all", "half" or a number against an available balance.
function parseAmount(raw, available) {
  raw = String(raw).toLowerCase().replace(/,/g, '');
  if (raw === 'all' || raw === 'max') return available;
  if (raw === 'half') return Math.floor(available / 2);
  const n = Math.floor(Number(raw.replace(/k$/, '000')));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function guard(interaction) {
  if (!cfg(interaction).enabled) {
    interaction.reply(ephemeral(fail('The economy is disabled on this server.')));
    return false;
  }
  return true;
}

const amountOpt = (o) => o.setName('amount').setDescription('A number, "half" or "all"').setRequired(true);

function betCheck(interaction, acc) {
  const bet = parseAmount(interaction.options.getString('bet'), acc.wallet);
  const max = cfg(interaction).maxBet;
  if (!bet) return [null, 'Enter a valid bet.'];
  if (bet > acc.wallet) return [null, `You only have ${money(interaction.guild.id, acc.wallet)} in your wallet.`];
  if (max > 0 && bet > max) return [null, `The maximum bet is ${money(interaction.guild.id, max)}.`];
  return [bet, null];
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your (or someone else’s) balance')
      .addUserOption((o) => o.setName('user').setDescription('Whose balance')),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const user = interaction.options.getUser('user') || interaction.user;
      const acc = account(interaction.guild.id, user.id);
      const gid = interaction.guild.id;
      const all = Object.entries(db.guild(gid).economy).sort((a, b) => b[1].wallet + b[1].bank - (a[1].wallet + a[1].bank));
      const rank = all.findIndex(([id]) => id === user.id) + 1;
      const e = embed(interaction.guild, { title: `${cfg(interaction).currencyEmoji}  ${user.username}'s balance`, thumbnail: user.displayAvatarURL() }).addFields(
        { name: '👛 Wallet', value: money(gid, acc.wallet), inline: true },
        { name: '🏦 Bank', value: money(gid, acc.bank), inline: true },
        { name: '📊 Net worth', value: `${money(gid, acc.wallet + acc.bank)}\nRank **#${rank}**`, inline: true },
      );
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward (streaks give a bonus)'),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const left = cooldown(acc, 'daily', 864e5);
      if (left) return interaction.reply(ephemeral(fail(`You already claimed today. Come back in **${formatDuration(left)}**.`)));
      acc.streak = Date.now() - (acc.cd.daily || 0) < 2 * 864e5 ? (acc.streak || 0) + 1 : 1;
      const bonus = Math.min(acc.streak - 1, 7) * 0.1;
      const amount = Math.round(cfg(interaction).daily * (1 + bonus));
      acc.wallet += amount;
      acc.cd.daily = Date.now();
      db.save();
      const e = embed(interaction.guild, {
        title: '🎁  Daily reward',
        color: COLORS.success,
        description: `You received ${money(interaction.guild.id, amount)}!\n🔥 Streak: **${acc.streak}** day(s)${bonus ? ` (+${Math.round(bonus * 100)}% bonus)` : ''}`,
      });
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const left = cooldown(acc, 'weekly', 7 * 864e5);
      if (left) return interaction.reply(ephemeral(fail(`Come back in **${formatDuration(left)}**.`)));
      acc.wallet += cfg(interaction).weekly;
      acc.cd.weekly = Date.now();
      db.save();
      await interaction.reply({ embeds: [embed(interaction.guild, { title: '📦  Weekly reward', color: COLORS.success, description: `You received ${money(interaction.guild.id, cfg(interaction).weekly)}!` })] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('work').setDescription('Work a shift to earn money'),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const c = cfg(interaction);
      const acc = account(interaction.guild.id, interaction.user.id);
      const left = cooldown(acc, 'work', c.workCooldownMinutes * 6e4);
      if (left) return interaction.reply(ephemeral(fail(`You're tired. Rest for **${formatDuration(left)}**.`)));
      const amount = randInt(c.workMin, Math.max(c.workMin, c.workMax));
      acc.wallet += amount;
      acc.cd.work = Date.now();
      db.save();
      const job = JOBS[randInt(0, JOBS.length - 1)];
      await interaction.reply({ embeds: [embed(interaction.guild, { title: '💼  Shift complete', description: `You ${job} and earned ${money(interaction.guild.id, amount)}.`, color: COLORS.success })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Send money to someone')
      .addUserOption((o) => o.setName('user').setDescription('Who to pay').setRequired(true))
      .addStringOption(amountOpt),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const target = interaction.options.getUser('user');
      if (target.bot || target.id === interaction.user.id) return interaction.reply(ephemeral(fail('Pick another (human) member.')));
      const acc = account(interaction.guild.id, interaction.user.id);
      const amount = parseAmount(interaction.options.getString('amount'), acc.wallet);
      if (!amount || amount > acc.wallet) return interaction.reply(ephemeral(fail("You don't have that much in your wallet.")));
      acc.wallet -= amount;
      account(interaction.guild.id, target.id).wallet += amount;
      db.save();
      await interaction.reply({ embeds: [ok(`You sent ${money(interaction.guild.id, amount)} to ${target}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('deposit').setDescription('Move money into your bank (safe from robbers)').addStringOption(amountOpt),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const amount = parseAmount(interaction.options.getString('amount'), acc.wallet);
      if (!amount || amount > acc.wallet) return interaction.reply(ephemeral(fail("You don't have that much in your wallet.")));
      acc.wallet -= amount;
      acc.bank += amount;
      db.save();
      await interaction.reply({ embeds: [ok(`Deposited ${money(interaction.guild.id, amount)}. Bank: ${money(interaction.guild.id, acc.bank)}`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('withdraw').setDescription('Take money out of your bank').addStringOption(amountOpt),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const amount = parseAmount(interaction.options.getString('amount'), acc.bank);
      if (!amount || amount > acc.bank) return interaction.reply(ephemeral(fail("You don't have that much in the bank.")));
      acc.bank -= amount;
      acc.wallet += amount;
      db.save();
      await interaction.reply({ embeds: [ok(`Withdrew ${money(interaction.guild.id, amount)}. Wallet: ${money(interaction.guild.id, acc.wallet)}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rob')
      .setDescription("Try to steal from someone's wallet (risky!)")
      .addUserOption((o) => o.setName('user').setDescription('Your target').setRequired(true)),
    async execute(interaction) {
      if (!guard(interaction)) return;
      if (!cfg(interaction).robEnabled) return interaction.reply(ephemeral(fail('Robbing is disabled here.')));
      const target = interaction.options.getUser('user');
      if (target.bot || target.id === interaction.user.id) return interaction.reply(ephemeral(fail('Pick another (human) member.')));
      const acc = account(interaction.guild.id, interaction.user.id);
      const victim = account(interaction.guild.id, target.id);
      const left = cooldown(acc, 'rob', 2 * 36e5);
      if (left) return interaction.reply(ephemeral(fail(`Lay low for **${formatDuration(left)}** first.`)));
      if (victim.wallet < 100) return interaction.reply(ephemeral(fail(`${target.username} doesn't have enough in their wallet to be worth it.`)));
      if (acc.wallet < 100) return interaction.reply(ephemeral(fail('You need at least 100 in your wallet to attempt a robbery.')));
      acc.cd.rob = Date.now();
      const gid = interaction.guild.id;
      if (Math.random() < 0.45) {
        const stolen = Math.floor(victim.wallet * (randInt(10, 30) / 100));
        victim.wallet -= stolen;
        acc.wallet += stolen;
        db.save();
        return interaction.reply({ embeds: [embed(interaction.guild, { title: '🦹  Heist successful', color: COLORS.success, description: `You snuck away with ${money(gid, stolen)} from ${target}!` })] });
      }
      const fine = Math.floor(acc.wallet * 0.15);
      acc.wallet -= fine;
      victim.wallet += fine;
      db.save();
      await interaction.reply({ embeds: [embed(interaction.guild, { title: '🚓  Caught!', color: COLORS.error, description: `You got caught and paid ${target} ${money(gid, fine)} in damages.` })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Bet on a coin flip (double or nothing)')
      .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
      .addStringOption((o) => o.setName('bet').setDescription('Amount, "half" or "all"').setRequired(true)),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const [bet, err] = betCheck(interaction, acc);
      if (err) return interaction.reply(ephemeral(fail(err)));
      const side = interaction.options.getString('side');
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const win = side === result;
      acc.wallet += win ? bet : -bet;
      db.save();
      const gid = interaction.guild.id;
      await interaction.reply({
        embeds: [
          embed(interaction.guild, {
            title: `🪙  It landed on ${result}!`,
            color: win ? COLORS.success : COLORS.error,
            description: win ? `You won ${money(gid, bet)}!` : `You lost ${money(gid, bet)}.`,
          }).setFooter({ text: `Wallet: ${fmt(acc.wallet)}` }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Spin the slot machine')
      .addStringOption((o) => o.setName('bet').setDescription('Amount, "half" or "all"').setRequired(true)),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const acc = account(interaction.guild.id, interaction.user.id);
      const [bet, err] = betCheck(interaction, acc);
      if (err) return interaction.reply(ephemeral(fail(err)));
      const reels = [0, 0, 0].map(() => SLOTS[randInt(0, SLOTS.length - 1)]);
      let mult = 0;
      if (reels[0] === reels[1] && reels[1] === reels[2]) mult = SLOT_PAYOUT[reels[0]];
      else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) mult = 1.5;
      const payout = Math.floor(bet * mult);
      acc.wallet += payout - bet;
      db.save();
      const gid = interaction.guild.id;
      const e = embed(interaction.guild, {
        title: '🎰  Slots',
        color: mult ? COLORS.success : COLORS.error,
        description: `## ${reels.join('  ')}\n${mult ? `**${mult}x!** You won ${money(gid, payout)}.` : `No luck — you lost ${money(gid, bet)}.`}`,
      }).setFooter({ text: `Wallet: ${fmt(acc.wallet)}` });
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('The richest members'),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const gid = interaction.guild.id;
      const top = Object.entries(db.guild(gid).economy)
        .map(([id, a]) => [id, a.wallet + a.bank])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map(([id, total], i) => `${medals[i] || `\`#${i + 1}\``}  <@${id}> · ${money(gid, total)}`);
      await interaction.reply({ embeds: [embed(interaction.guild, { title: '🏆  Leaderboard', description: lines.join('\n') || 'Nobody has any money yet.' })] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('shop').setDescription('See what you can buy'),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const gid = interaction.guild.id;
      const items = cfg(interaction).shop;
      const e = embed(interaction.guild, { title: '🛍️  Shop' });
      if (!items.length) e.setDescription('The shop is empty. Admins can add items in the dashboard.');
      else
        e.setDescription(
          items.map((it) => `${it.emoji || '📦'}  **${it.name}** — ${money(gid, it.price)}${it.roleId ? `\n┗ Gives <@&${it.roleId}>` : ''}${it.description ? `\n┗ *${it.description}*` : ''}`).join('\n\n') +
            '\n\n-# Buy with /buy',
        );
      await interaction.reply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy something from the shop')
      .addStringOption((o) => o.setName('item').setDescription('What to buy').setRequired(true).setAutocomplete(true)),
    async autocomplete(interaction) {
      const q = interaction.options.getFocused().toLowerCase();
      await interaction.respond(cfg(interaction).shop.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 25).map((i) => ({ name: `${i.name} — ${fmt(i.price)}`.slice(0, 100), value: i.id })));
    },
    async execute(interaction) {
      if (!guard(interaction)) return;
      const item = cfg(interaction).shop.find((i) => i.id === interaction.options.getString('item'));
      if (!item) return interaction.reply(ephemeral(fail('That item does not exist.')));
      const acc = account(interaction.guild.id, interaction.user.id);
      if (acc.wallet < item.price) return interaction.reply(ephemeral(fail(`You need ${money(interaction.guild.id, item.price - acc.wallet)} more.`)));
      if (item.roleId) {
        const role = interaction.guild.roles.cache.get(item.roleId);
        if (!role?.editable) return interaction.reply(ephemeral(fail("I can't give that item's role right now. Tell an admin.")));
        if (interaction.member.roles.cache.has(role.id)) return interaction.reply(ephemeral(fail('You already have that role.')));
        await interaction.member.roles.add(role, 'Shop purchase');
      }
      acc.wallet -= item.price;
      acc.inv[item.id] = (acc.inv[item.id] || 0) + 1;
      db.save();
      await interaction.reply({ embeds: [ok(`You bought ${item.emoji || '📦'} **${item.name}** for ${money(interaction.guild.id, item.price)}!`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('See what you own')
      .addUserOption((o) => o.setName('user').setDescription('Whose inventory')),
    async execute(interaction) {
      if (!guard(interaction)) return;
      const user = interaction.options.getUser('user') || interaction.user;
      const acc = account(interaction.guild.id, user.id);
      const shop = cfg(interaction).shop;
      const lines = Object.entries(acc.inv)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => {
          const it = shop.find((i) => i.id === id);
          return `${it?.emoji || '📦'}  **${it?.name || 'Retired item'}** × ${n}`;
        });
      await interaction.reply({ embeds: [embed(interaction.guild, { title: `🎒  ${user.username}'s inventory`, description: lines.join('\n') || 'Empty.' })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('eco')
      .setDescription('Manage the economy (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('give')
          .setDescription('Give money')
          .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('take')
          .setDescription('Take money')
          .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) => s.setName('reset').setDescription("Reset someone's account").addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user');
      const gid = interaction.guild.id;
      if (sub === 'reset') {
        delete db.guild(gid).economy[user.id];
        db.save();
        return interaction.reply({ embeds: [ok(`Reset ${user}'s account.`)] });
      }
      const acc = account(gid, user.id);
      const amount = interaction.options.getInteger('amount');
      if (sub === 'give') acc.wallet += amount;
      else acc.wallet = Math.max(0, acc.wallet - amount);
      db.save();
      await interaction.reply({ embeds: [ok(`${sub === 'give' ? 'Gave' : 'Took'} ${money(gid, amount)} ${sub === 'give' ? 'to' : 'from'} ${user}. Wallet: ${money(gid, acc.wallet)}`)] });
    },
  },
];

