const db = require('./db');

// Sends an embed to the log channel. `type` matches a key in logging.events;
// `mod: true` sends to the moderation log channel instead (if one is set).
async function log(guild, embed, { type, mod = false } = {}) {
  const cfg = db.guild(guild.id).config.logging;
  if (!cfg.enabled) return;
  if (type && cfg.events[type] === false) return;
  const id = mod ? cfg.modChannelId || cfg.channelId : cfg.channelId;
  const channel = id && guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

// Alerts go to the mod log and can ping a role.
async function alert(guild, embed, roleId) {
  const cfg = db.guild(guild.id).config.logging;
  const id = cfg.modChannelId || cfg.channelId;
  const channel = id && guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  await channel
    .send({ content: roleId ? `<@&${roleId}>` : undefined, embeds: [embed], allowedMentions: { roles: roleId ? [roleId] : [] } })
    .catch(() => {});
}

module.exports = { log, alert };
