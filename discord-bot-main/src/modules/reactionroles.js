// Button role panels (built in the dashboard) and classic emoji reaction roles.
const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../lib/db');
const { embed, ok, fail, ephemeral } = require('../lib/theme');

function panelPayload(guild, panel) {
  const lines = panel.roles.map((r) => `${r.emoji ? `${r.emoji}  ` : '• '}<@&${r.roleId}>${r.label ? ` — ${r.label}` : ''}`).join('\n');
  const desc = [panel.description, lines].filter(Boolean).join('\n\n');
  const footerHint = panel.mode === 'unique' ? 'You can pick one role from this panel.' : 'Click a button to add or remove a role.';
  const e = embed(guild, { title: panel.title || 'Pick your roles', description: `${desc}\n\n-# ${footerHint}` });
  const rows = [];
  panel.roles.slice(0, 25).forEach((r, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder());
    const role = guild.roles.cache.get(r.roleId);
    const btn = new ButtonBuilder()
      .setCustomId(`rr:${panel.id}:${r.roleId}`)
      .setLabel((r.label || role?.name || 'Role').slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
    if (r.emoji) btn.setEmoji(r.emoji);
    rows[rows.length - 1].addComponents(btn);
  });
  return { embeds: [e], components: rows };
}

// Posts the panel, or edits the existing message if it's still there.
async function postPanel(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId);
  if (!channel?.isTextBased()) throw new Error('Pick a text channel for this panel first.');
  if (!panel.roles.length) throw new Error('Add at least one role to the panel.');
  const payload = panelPayload(guild, panel);
  if (panel.messageId) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  }
  const msg = await channel.send(payload);
  const g = db.guild(guild.id);
  const stored = g.config.reactionRoles.panels.find((p) => p.id === panel.id);
  if (stored) stored.messageId = msg.id;
  db.save();
  return msg;
}

const emojiKey = (emoji) => emoji.id || emoji.name;

async function onReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const guild = reaction.message.guild;
  if (!guild) return;
  const key = emojiKey(reaction.emoji);
  const entries = db.guild(guild.id).config.reactionRoles.emoji.filter((e) => e.messageId === reaction.message.id && e.emoji === key);
  if (!entries.length) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  for (const entry of entries) {
    const role = guild.roles.cache.get(entry.roleId);
    if (!role?.editable) continue;
    if (add) await member.roles.add(role, 'Reaction role').catch(() => {});
    else await member.roles.remove(role, 'Reaction role').catch(() => {});
  }
}

module.exports = {
  postPanel,
  emojiKey,
  init(client) {
    client.on(Events.MessageReactionAdd, (r, u) => onReaction(r, u, true).catch((e) => console.error('[rr]', e)));
    client.on(Events.MessageReactionRemove, (r, u) => onReaction(r, u, false).catch((e) => console.error('[rr]', e)));
  },
  components: {
    // rr:<panelId>:<roleId>
    async rr(interaction, [panelId, roleId]) {
      const panel = db.guild(interaction.guild.id).config.reactionRoles.panels.find((p) => p.id === panelId);
      const role = interaction.guild.roles.cache.get(roleId);
      if (!panel || !role) return interaction.reply(ephemeral(fail('This role option no longer exists.')));
      if (!role.editable) return interaction.reply(ephemeral(fail("I can't give that role — it's above my highest role.")));
      const member = interaction.member;

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role, 'Role panel');
        return interaction.reply(ephemeral(ok(`Removed ${role}.`)));
      }
      if (panel.mode === 'unique') {
        const others = panel.roles.map((r) => r.roleId).filter((id) => id !== roleId && member.roles.cache.has(id));
        if (others.length) await member.roles.remove(others, 'Role panel (unique)').catch(() => {});
      }
      await member.roles.add(role, 'Role panel');
      return interaction.reply(ephemeral(ok(`Gave you ${role}.`)));
    },
  },
};
