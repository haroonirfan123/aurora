// Join-burst raid detection, young-account filter, anti-nuke and bot-add protection.
const { Events, AuditLogEvent } = require('discord.js');
const db = require('../lib/db');
const { embed, COLORS } = require('../lib/theme');
const { alert } = require('../lib/logger');
const { addCase, lockdown } = require('../lib/moderation');
const { ts, formatDuration } = require('../lib/util');

const recentJoins = new Map(); // guildId → [{ id, at }]
const nukeActions = new Map(); // `${guildId}:${userId}` → [timestamps]

const NUKE_EVENTS = {
  [AuditLogEvent.ChannelDelete]: 'deleted channels',
  [AuditLogEvent.RoleDelete]: 'deleted roles',
  [AuditLogEvent.MemberBanAdd]: 'banned members',
  [AuditLogEvent.MemberKick]: 'kicked members',
  [AuditLogEvent.WebhookCreate]: 'created webhooks',
  [AuditLogEvent.ChannelCreate]: 'created channels',
};

function isTrusted(guild, userId) {
  const cfg = db.guild(guild.id).config.antiraid;
  return userId === guild.ownerId || userId === guild.client.user.id || cfg.whitelist.includes(userId);
}

async function punishJoiner(member, action, reason) {
  try {
    if (action === 'ban' && member.bannable) await member.ban({ reason });
    else if (action === 'timeout' && member.moderatable) await member.timeout(60 * 6e4, reason);
    else if (member.kickable) await member.kick(reason);
    else return false;
    return true;
  } catch {
    return false;
  }
}

async function startRaid(guild, reason, durationMs) {
  const g = db.guild(guild.id);
  const cfg = g.config.antiraid;
  g.raid = { active: true, until: Date.now() + (durationMs || cfg.raidDurationMinutes * 6e4) };
  db.save();
  const e = embed(guild, {
    title: '🚨  Raid detected — raid mode ON',
    color: COLORS.error,
    description: `${reason}\n\nNew members will be **${cfg.raidAction === 'ban' ? 'banned' : cfg.raidAction === 'timeout' ? 'timed out' : 'kicked'}** until ${ts(g.raid.until)}.\nUse \`/raidmode off\` to end it early.`,
  });
  await alert(guild, e, cfg.alertRoleId);
  if (cfg.lockdownOnRaid) await lockdown(guild, null, 'Automatic lockdown: raid detected');
}

async function endRaid(guild, reason) {
  const g = db.guild(guild.id);
  g.raid = { active: false, until: 0 };
  db.save();
  await alert(guild, embed(guild, { title: '✅  Raid mode OFF', color: COLORS.success, description: reason }));
}

async function onJoin(member) {
  const guild = member.guild;
  const g = db.guild(guild.id);
  const cfg = g.config.antiraid;
  if (!cfg.enabled || member.user.bot) return;
  const now = Date.now();

  // Young accounts
  const ageDays = (now - member.user.createdTimestamp) / 864e5;
  if (cfg.minAccountAgeDays > 0 && ageDays < cfg.minAccountAgeDays) {
    const reason = `Account is only ${formatDuration(now - member.user.createdTimestamp)} old (minimum ${cfg.minAccountAgeDays}d)`;
    if (cfg.youngAccountAction === 'flag') {
      await alert(guild, embed(guild, { title: '🐣  New account joined', color: COLORS.warn, description: `${member} · ${reason}`, thumbnail: member.displayAvatarURL() }));
    } else if (await punishJoiner(member, cfg.youngAccountAction, reason)) {
      addCase(guild, { action: cfg.youngAccountAction, target: member.user, moderator: null, reason });
      return;
    }
  }

  // Raid mode already on: remove the newcomer
  if (g.raid.active) {
    if (await punishJoiner(member, cfg.raidAction, 'Raid mode is active')) return;
  }

  // Join burst detection
  const joins = (recentJoins.get(guild.id) || []).filter((j) => now - j.at < cfg.joinSeconds * 1000);
  joins.push({ id: member.id, at: now });
  recentJoins.set(guild.id, joins);
  if (!g.raid.active && joins.length >= cfg.joinThreshold) {
    await startRaid(guild, `**${joins.length}** members joined within **${cfg.joinSeconds}s**.`);
    // Also deal with the accounts that triggered it
    for (const j of joins) {
      const m = guild.members.cache.get(j.id);
      if (m) await punishJoiner(m, cfg.raidAction, 'Part of a detected raid');
    }
    recentJoins.set(guild.id, []);
  }
}

async function onAuditLog(entry, guild) {
  const cfg = db.guild(guild.id).config.antiraid;
  if (!cfg.enabled || !entry.executorId || isTrusted(guild, entry.executorId)) return;

  // Unapproved bots get kicked immediately
  if (cfg.antiBotAdd && entry.action === AuditLogEvent.BotAdd) {
    const bot = await guild.members.fetch(entry.targetId).catch(() => null);
    if (bot?.kickable) {
      await bot.kick(`Added by a non-whitelisted user (${entry.executorId})`);
      await alert(guild, embed(guild, { title: '🤖  Unapproved bot removed', color: COLORS.warn, description: `<@${entry.executorId}> added **${bot.user.tag}**. It was kicked.\nAdd their ID to the anti-raid whitelist in the dashboard to allow this.` }), cfg.alertRoleId);
    }
    return;
  }

  if (!cfg.antiNuke || !(entry.action in NUKE_EVENTS)) return;
  const key = `${guild.id}:${entry.executorId}`;
  const now = Date.now();
  const hits = (nukeActions.get(key) || []).filter((t) => now - t < cfg.nukeSeconds * 1000);
  hits.push(now);
  nukeActions.set(key, hits);
  if (hits.length < cfg.nukeThreshold) return;
  nukeActions.delete(key);

  const member = await guild.members.fetch(entry.executorId).catch(() => null);
  if (!member) return;
  const reason = `Anti-nuke: ${NUKE_EVENTS[entry.action]} ${hits.length} times in ${cfg.nukeSeconds}s`;
  let result = 'could not be punished (their role is above mine)';
  try {
    if (member.user.bot && member.kickable) {
      await member.kick(reason);
      result = 'was kicked (bot)';
    } else if (cfg.nukePunishment === 'ban' && member.bannable) {
      await member.ban({ reason });
      result = 'was banned';
    } else if (cfg.nukePunishment === 'kick' && member.kickable) {
      await member.kick(reason);
      result = 'was kicked';
    } else {
      const removable = member.roles.cache.filter((r) => r.editable && r.id !== guild.id);
      if (removable.size) {
        await member.roles.remove(removable, reason);
        result = `had **${removable.size}** roles removed`;
      }
    }
  } catch {}
  addCase(guild, { action: 'antinuke', target: member.user, moderator: null, reason });
  await alert(guild, embed(guild, { title: '☢️  Nuke attempt stopped', color: COLORS.error, description: `${member} ${result}.\n> ${reason}`, thumbnail: member.displayAvatarURL() }), cfg.alertRoleId);
}

module.exports = {
  startRaid,
  endRaid,
  init(client) {
    client.on(Events.GuildMemberAdd, (m) => onJoin(m).catch((e) => console.error('[antiraid]', e)));
    client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => onAuditLog(entry, guild).catch((e) => console.error('[antinuke]', e)));
  },
  async tick(client) {
    for (const guild of client.guilds.cache.values()) {
      const g = db.guild(guild.id);
      if (g.raid.active && Date.now() > g.raid.until) await endRaid(guild, 'Raid mode timer ended.');
    }
  },
};
