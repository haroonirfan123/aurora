// Shared moderation helpers used by commands, automod and anti-raid.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { embed, COLORS } = require('./theme');
const { log } = require('./logger');
const { formatDuration } = require('./util');

const ACTION_STYLE = {
  ban: ['🔨', 'Ban', COLORS.error],
  unban: ['🕊️', 'Unban', COLORS.success],
  kick: ['👢', 'Kick', COLORS.warn],
  timeout: ['🔇', 'Timeout', COLORS.warn],
  untimeout: ['🔊', 'Timeout removed', COLORS.success],
  warn: ['⚠️', 'Warning', COLORS.warn],
  clearwarns: ['🧹', 'Warnings cleared', COLORS.success],
  purge: ['🗑️', 'Purge', COLORS.info],
  lockdown: ['🔒', 'Lockdown', COLORS.error],
  unlock: ['🔓', 'Lockdown lifted', COLORS.success],
  antinuke: ['☢️', 'Anti-nuke', COLORS.error],
  automod: ['🤖', 'AutoMod', COLORS.warn],
};

// Records a case and posts it to the mod log.
function addCase(guild, { action, target, moderator, reason, duration, extra }) {
  const g = db.guild(guild.id);
  const id = g.cases.length + 1;
  g.cases.push({ id, action, targetId: target?.id, moderatorId: moderator?.id, reason, duration, at: Date.now() });
  if (g.cases.length > 1000) g.cases.splice(0, g.cases.length - 1000);
  db.save();

  const [icon, label, color] = ACTION_STYLE[action] || ['📝', action, COLORS.info];
  const e = embed(guild, { title: `${icon}  ${label}  ·  Case #${id}`, color });
  if (target) e.addFields({ name: 'User', value: `<@${target.id}>\n\`${target.id}\``, inline: true });
  e.addFields({ name: 'Moderator', value: moderator ? `<@${moderator.id}>` : 'AutoMod', inline: true });
  if (duration) e.addFields({ name: 'Duration', value: formatDuration(duration), inline: true });
  if (extra) e.addFields({ name: 'Details', value: extra });
  e.addFields({ name: 'Reason', value: reason || 'No reason given' });
  if (target?.displayAvatarURL) e.setThumbnail(target.displayAvatarURL());
  log(guild, e, { mod: true });
  return id;
}

// Tells the user what happened before acting (DMs fail once they're kicked).
async function notify(guild, user, action, reason, duration) {
  if (!db.guild(guild.id).config.moderation.dmOnAction) return;
  const [icon, label, color] = ACTION_STYLE[action] || ['📝', action, COLORS.info];
  const e = embed(guild, {
    title: `${icon}  ${label}`,
    color,
    description: `You received a **${label.toLowerCase()}** in **${guild.name}**.`,
  }).addFields({ name: 'Reason', value: reason || 'No reason given' });
  if (duration) e.addFields({ name: 'Duration', value: formatDuration(duration) });
  await user.send({ embeds: [e] }).catch(() => {});
}

// Returns an error message if `actor` (or the bot) can't act on `target`, else null.
function hierarchyError(actor, target) {
  const guild = target.guild;
  if (target.id === guild.ownerId) return "You can't act on the server owner.";
  if (target.id === actor.id) return "You can't do that to yourself.";
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position)
    return 'That member has a role equal to or higher than yours.';
  if (!target.manageable) return "My role is below that member's highest role, so I can't act on them.";
  return null;
}

// Adds a warning and applies the automatic punishments set in the dashboard.
async function warn(guild, member, moderator, reason) {
  const g = db.guild(guild.id);
  const list = (g.warnings[member.id] ||= []);
  list.push({ id: db.uid(), reason, moderatorId: moderator?.id || null, at: Date.now() });
  db.save();
  await notify(guild, member.user, 'warn', reason);
  addCase(guild, { action: 'warn', target: member.user, moderator, reason, extra: `Total warnings: **${list.length}**` });

  const cfg = g.config.moderation;
  const n = list.length;
  const auto = `Automatic: reached ${n} warnings`;
  try {
    if (cfg.warnBanAt > 0 && n >= cfg.warnBanAt && member.bannable) {
      await notify(guild, member.user, 'ban', auto);
      await member.ban({ reason: auto });
      addCase(guild, { action: 'ban', target: member.user, moderator: null, reason: auto });
      return { count: n, escalated: 'banned' };
    }
    if (cfg.warnKickAt > 0 && n >= cfg.warnKickAt && member.kickable) {
      await notify(guild, member.user, 'kick', auto);
      await member.kick(auto);
      addCase(guild, { action: 'kick', target: member.user, moderator: null, reason: auto });
      return { count: n, escalated: 'kicked' };
    }
    if (cfg.warnTimeoutAt > 0 && n >= cfg.warnTimeoutAt && member.moderatable) {
      const ms = cfg.warnTimeoutMinutes * 6e4;
      await member.timeout(ms, auto);
      addCase(guild, { action: 'timeout', target: member.user, moderator: null, reason: auto, duration: ms });
      return { count: n, escalated: `timed out for ${formatDuration(ms)}` };
    }
  } catch (err) {
    console.error('[moderation] auto-punish failed:', err.message);
  }
  return { count: n, escalated: null };
}

// Stops @everyone from talking in every text channel they can currently see.
async function lockdown(guild, moderator, reason) {
  const g = db.guild(guild.id);
  const everyone = guild.roles.everyone;
  const locked = [];
  for (const ch of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(ch.type)) continue;
    const perms = ch.permissionsFor(everyone);
    if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) continue;
    try {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason });
      locked.push(ch.id);
    } catch {}
  }
  g.lockdown = [...new Set([...g.lockdown, ...locked])];
  db.save();
  addCase(guild, { action: 'lockdown', moderator, reason, extra: `Locked **${locked.length}** channels` });
  return locked.length;
}

async function unlockdown(guild, moderator, reason) {
  const g = db.guild(guild.id);
  let count = 0;
  for (const id of g.lockdown) {
    const ch = guild.channels.cache.get(id);
    if (!ch) continue;
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null }, { reason });
      count++;
    } catch {}
  }
  g.lockdown = [];
  db.save();
  addCase(guild, { action: 'unlock', moderator, reason, extra: `Unlocked **${count}** channels` });
  return count;
}

module.exports = { addCase, notify, hierarchyError, warn, lockdown, unlockdown };
