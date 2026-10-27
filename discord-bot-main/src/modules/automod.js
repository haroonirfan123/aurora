// Filters messages for spam, invites, links, bad words, mass mentions and caps.
const { Events, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { COLORS } = require('../lib/theme');
const { EmbedBuilder } = require('discord.js');
const { addCase, warn } = require('../lib/moderation');

const INVITE = /(discord\.gg|discord(app)?\.com\/invite|dsc\.gg)\/[\w-]+/i;
const LINK = /https?:\/\/([^\s/<>]+)/gi;

const history = new Map(); // `${guildId}:${userId}` → [{ at, content, id }]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function check(message, cfg) {
  const content = message.content || '';
  const lower = content.toLowerCase();

  if (cfg.bannedWords.length) {
    const hit = cfg.bannedWords.find((w) => w && new RegExp(`(^|\\W)${escape(w.toLowerCase())}($|\\W)`, 'i').test(lower));
    if (hit) return 'Used a filtered word';
  }
  if (cfg.antiInvite && INVITE.test(content)) return 'Posted a server invite';
  if (cfg.antiLinks) {
    for (const [, host] of content.matchAll(LINK)) {
      const h = host.toLowerCase().replace(/^www\./, '');
      if (!cfg.allowedDomains.some((d) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`))) return 'Posted a link that is not allowed';
    }
  }
  if (cfg.antiMassMention) {
    const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0);
    if (count >= cfg.mentionLimit) return `Mentioned ${count} users/roles at once`;
  }
  if (cfg.antiCaps) {
    const letters = content.replace(/[^a-z]/gi, '');
    if (letters.length >= cfg.capsMinLength) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if ((upper / letters.length) * 100 >= cfg.capsPercent) return 'Too many capital letters';
    }
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const recent = (history.get(key) || []).filter((h) => now - h.at < 30_000);
  recent.push({ at: now, content: lower, id: message.id });
  history.set(key, recent);

  if (cfg.antiSpam) {
    const burst = recent.filter((h) => now - h.at < cfg.spamSeconds * 1000);
    if (burst.length >= cfg.spamMessages) {
      history.set(key, []);
      return { reason: `Sent ${burst.length} messages in ${cfg.spamSeconds}s`, spam: burst.map((h) => h.id) };
    }
  }
  if (cfg.antiDuplicate && lower.length > 3 && recent.filter((h) => h.content === lower).length >= 3) {
    history.set(key, recent.filter((h) => h.content !== lower));
    return 'Sent the same message repeatedly';
  }
  return null;
}

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const cfg = db.guild(message.guild.id).config.automod;
  if (!cfg.enabled) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (cfg.exemptChannels.includes(message.channel.id) || cfg.exemptChannels.includes(message.channel.parentId)) return;
  if (message.member.roles.cache.some((r) => cfg.exemptRoles.includes(r.id))) return;

  let result = check(message, cfg);
  if (!result) return;
  const reason = typeof result === 'string' ? result : result.reason;

  if (result.spam) await message.channel.bulkDelete(result.spam, true).catch(() => {});
  else await message.delete().catch(() => {});

  const notice = await message.channel
    .send({ content: `${message.author}`, embeds: [new EmbedBuilder().setColor(COLORS.warn).setDescription(`🛡️  ${reason}. Please follow the server rules.`)] })
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);

  const full = `AutoMod: ${reason}`;
  if (cfg.action === 'warn') {
    await warn(message.guild, message.member, null, full);
  } else if (cfg.action === 'timeout' && message.member.moderatable) {
    const ms = cfg.timeoutMinutes * 6e4;
    await message.member.timeout(ms, full).catch(() => {});
    addCase(message.guild, { action: 'timeout', target: message.author, moderator: null, reason: full, duration: ms });
  } else {
    addCase(message.guild, { action: 'automod', target: message.author, moderator: null, reason: full, extra: `In <#${message.channel.id}>` });
  }
}

module.exports = {
  init(client) {
    client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error('[automod]', e)));
    // Forget idle users so memory stays small
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of history) if (!v.length || now - v[v.length - 1].at > 60_000) history.delete(k);
    }, 60_000);
  },
};
