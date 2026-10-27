// One place for the bot's look so every message feels like the same product.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('./db');

const COLORS = {
  success: 0x34d399,
  error: 0xf87171,
  warn: 0xfbbf24,
  info: 0x60a5fa,
  muted: 0x2b2d31,
};

function brand(guild) {
  const hex = db.guild(guild.id).config.theme.color;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0x8b5cf6;
}

// A full embed with the server's colour, footer and timestamp.
function embed(guild, { title, description, color, thumbnail, footer = true } = {}) {
  const e = new EmbedBuilder().setColor(color ?? brand(guild));
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  if (thumbnail) e.setThumbnail(thumbnail);
  if (footer) {
    const text = db.guild(guild.id).config.theme.footer || guild.name;
    e.setFooter({ text, iconURL: guild.iconURL() ?? undefined }).setTimestamp();
  }
  return e;
}

// Short one-line replies.
const ok = (text) => new EmbedBuilder().setColor(COLORS.success).setDescription(`✅  ${text}`);
const fail = (text) => new EmbedBuilder().setColor(COLORS.error).setDescription(`❌  ${text}`);
const info = (text) => new EmbedBuilder().setColor(COLORS.info).setDescription(text);

const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

module.exports = { COLORS, brand, embed, ok, fail, info, ephemeral };
