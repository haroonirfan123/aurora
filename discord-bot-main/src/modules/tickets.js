// Ticket system: panel → private channel → claim/close → HTML transcript.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral, COLORS } = require('../lib/theme');
const { log } = require('../lib/logger');
const { fill, ts } = require('../lib/util');

const STAFF_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

function panelMessage(guild) {
  const cfg = db.guild(guild.id).config.tickets;
  const e = embed(guild, { title: cfg.panelTitle, description: cfg.panelDescription, thumbnail: guild.iconURL() });
  let row;
  if (cfg.topics.length > 1) {
    row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ticket:topic')
        .setPlaceholder(cfg.buttonLabel || 'Open a ticket')
        .addOptions(cfg.topics.slice(0, 25).map((t, i) => ({ label: t.slice(0, 100), value: String(i), emoji: '📨' }))),
    );
  } else {
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel(cfg.buttonLabel || 'Open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
    );
  }
  return { embeds: [e], components: [row] };
}

async function postPanel(guild, channel) {
  return channel.send(panelMessage(guild));
}

function isStaff(member) {
  const cfg = db.guild(member.guild.id).config.tickets;
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || member.roles.cache.some((r) => cfg.supportRoles.includes(r.id));
}

async function openTicket(interaction, topic) {
  const guild = interaction.guild;
  const g = db.guild(guild.id);
  const cfg = g.config.tickets;
  if (!cfg.enabled) return interaction.reply(ephemeral(fail('Tickets are currently disabled.')));

  const mine = Object.entries(g.tickets).filter(([id, t]) => t.ownerId === interaction.user.id && guild.channels.cache.has(id));
  if (mine.length >= cfg.maxOpen) return interaction.reply(ephemeral(fail(`You already have an open ticket: <#${mine[0][0]}>`)));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  g.ticketCounter += 1;
  const number = g.ticketCounter;
  const supportRoles = cfg.supportRoles.filter((id) => guild.roles.cache.has(id));
  const parent = cfg.categoryId && guild.channels.cache.get(cfg.categoryId)?.type === ChannelType.GuildCategory ? cfg.categoryId : null;

  const channel = await guild.channels.create({
    name: `ticket-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent,
    topic: `${topic} · opened by ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: STAFF_PERMS },
      { id: guild.client.user.id, allow: [...STAFF_PERMS, PermissionFlagsBits.ManageChannels] },
      ...supportRoles.map((id) => ({ id, allow: STAFF_PERMS })),
    ],
  });

  g.tickets[channel.id] = { number, ownerId: interaction.user.id, topic, openedAt: Date.now(), claimedBy: null };
  db.save();

  const e = embed(guild, { title: `🎫  Ticket #${number} · ${topic}`, description: fill(cfg.welcomeMessage, interaction.member, guild) }).addFields(
    { name: 'Opened by', value: `${interaction.user}`, inline: true },
    { name: 'Opened', value: ts(Date.now()), inline: true },
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  const ping = [interaction.user.id && `${interaction.user}`, ...supportRoles.map((id) => `<@&${id}>`)].join(' ');
  await channel.send({ content: ping, embeds: [e], components: [row], allowedMentions: { users: [interaction.user.id], roles: supportRoles } });

  log(guild, embed(guild, { title: '🎫  Ticket opened', color: COLORS.info, description: `${channel} by ${interaction.user} · ${topic}` }), { mod: true });
  await interaction.editReply({ embeds: [ok(`Your ticket is ready: ${channel}`)] });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function transcript(channel, ticket) {
  let all = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  all = all.reverse();
  const rows = all
    .map((m) => {
      const body = [esc(m.content), ...m.embeds.map((e) => `<div class="em">${esc(e.title)}<br>${esc(e.description)}</div>`), ...m.attachments.map((a) => `<a href="${esc(a.url)}">📎 ${esc(a.name)}</a>`)].filter(Boolean).join('<br>');
      return `<div class="msg"><img src="${esc(m.author.displayAvatarURL({ size: 64 }))}"><div><b>${esc(m.author.tag)}</b> <span>${new Date(m.createdTimestamp).toLocaleString('en-GB')}</span><p>${body}</p></div></div>`;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(channel.name)}</title><style>
body{background:#0f0f14;color:#e4e4eb;font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:32px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#8b8b9a;margin-bottom:24px}.msg{display:flex;gap:12px;padding:10px 0;border-top:1px solid #1f1f29}
img{width:40px;height:40px;border-radius:50%}span{color:#6b6b7a;font-size:12px}p{margin:2px 0;white-space:pre-wrap}
.em{border-left:3px solid #8b5cf6;background:#17171f;padding:8px 12px;border-radius:6px;margin-top:4px}a{color:#a78bfa}
</style></head><body><h1>#${esc(channel.name)} · ${esc(ticket.topic)}</h1><div class="sub">${all.length} messages · opened ${new Date(ticket.openedAt).toLocaleString('en-GB')}</div>${rows}</body></html>`;
  return new AttachmentBuilder(Buffer.from(html), { name: `${channel.name}.html` });
}

async function closeTicket(channel, closer, reason = 'No reason given') {
  const guild = channel.guild;
  const g = db.guild(guild.id);
  const ticket = g.tickets[channel.id];
  if (!ticket) return false;
  delete g.tickets[channel.id];
  db.save();

  await channel.send({ embeds: [embed(guild, { description: `🔒  Ticket closed by ${closer}. This channel will be deleted in 5 seconds.`, color: COLORS.error, footer: false })] }).catch(() => {});
  const file = await transcript(channel, ticket);
  const summary = embed(guild, { title: `📑  Ticket #${ticket.number} closed`, color: COLORS.muted }).addFields(
    { name: 'Opened by', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Closed by', value: `${closer}`, inline: true },
    { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody', inline: true },
    { name: 'Topic', value: ticket.topic, inline: true },
    { name: 'Opened', value: ts(ticket.openedAt), inline: true },
    { name: 'Reason', value: reason },
  );
  const cfg = g.config.tickets;
  const logChannel = cfg.transcriptChannelId && guild.channels.cache.get(cfg.transcriptChannelId);
  if (logChannel) await logChannel.send({ embeds: [summary], files: [file] }).catch(() => {});
  const owner = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  if (owner) owner.send({ embeds: [summary], files: [file] }).catch(() => {});
  setTimeout(() => channel.delete(`Ticket closed by ${closer.tag ?? closer.username}`).catch(() => {}), 5000);
  return true;
}

module.exports = {
  postPanel,
  closeTicket,
  isStaff,
  components: {
    async ticket(interaction, [action]) {
      const g = db.guild(interaction.guild.id);
      if (action === 'open') return openTicket(interaction, g.config.tickets.topics[0] || 'Support');
      if (action === 'topic') return openTicket(interaction, g.config.tickets.topics[Number(interaction.values[0])] || 'Support');

      const ticket = g.tickets[interaction.channel.id];
      if (!ticket) return interaction.reply(ephemeral(fail('This is not an open ticket.')));

      if (action === 'claim') {
        if (!isStaff(interaction.member)) return interaction.reply(ephemeral(fail('Only staff can claim tickets.')));
        if (ticket.claimedBy) return interaction.reply(ephemeral(fail(`Already claimed by <@${ticket.claimedBy}>.`)));
        ticket.claimedBy = interaction.user.id;
        db.save();
        return interaction.reply({ embeds: [embed(interaction.guild, { description: `🙋  ${interaction.user} will be handling this ticket.`, color: COLORS.success, footer: false })] });
      }
      if (action === 'close') {
        if (interaction.user.id !== ticket.ownerId && !isStaff(interaction.member)) return interaction.reply(ephemeral(fail("You can't close this ticket.")));
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:confirm').setLabel('Yes, close it').setStyle(ButtonStyle.Danger),
        );
        return interaction.reply({ embeds: [embed(interaction.guild, { description: 'Are you sure you want to close this ticket?', footer: false })], components: [row], flags: MessageFlags.Ephemeral });
      }
      if (action === 'confirm') {
        await interaction.update({ embeds: [ok('Closing…')], components: [] });
        return closeTicket(interaction.channel, interaction.user);
      }
    },
  },
};
