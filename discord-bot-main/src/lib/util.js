const UNITS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };

// "1d2h30m" → milliseconds. Returns null if it can't be read.
function parseDuration(input) {
  if (!input) return null;
  const parts = String(input).toLowerCase().replace(/\s+/g, '').match(/\d+(\.\d+)?[smhdw]/g);
  if (!parts || parts.join('') !== String(input).toLowerCase().replace(/\s+/g, '')) return null;
  return parts.reduce((ms, p) => ms + parseFloat(p) * UNITS[p.slice(-1)], 0);
}

function formatDuration(ms) {
  if (ms < 1000) return 'less than a second';
  const out = [];
  for (const [label, size] of [['d', 864e5], ['h', 36e5], ['m', 6e4], ['s', 1e3]]) {
    const n = Math.floor(ms / size);
    if (n) out.push(`${n}${label}`);
    ms %= size;
  }
  return out.slice(0, 3).join(' ');
}

const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function fill(template, member, guild) {
  return String(template || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user?.username ?? member.username ?? 'Unknown')
    .replaceAll('{server}', guild.name)
    .replaceAll('{count}', String(guild.memberCount));
}

function bar(fraction, size = 12) {
  const full = Math.round(Math.max(0, Math.min(1, fraction)) * size);
  return '▰'.repeat(full) + '▱'.repeat(size - full);
}

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

const fmt = (n) => Number(n).toLocaleString('en-US');

module.exports = { parseDuration, formatDuration, ts, randInt, fill, bar, truncate, fmt };
