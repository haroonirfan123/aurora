// Web dashboard: Discord login, role-gated access, settings API and quick actions.
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { ChannelType } = require('discord.js');
const db = require('../lib/db');
const defaults = require('../config/defaults');
const { lockdown, unlockdown } = require('../lib/moderation');
const tickets = require('../modules/tickets');
const reactionRoles = require('../modules/reactionroles');
const announcements = require('../modules/announcements');
const antiraid = require('../modules/antiraid');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const num = (v, min = 0, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
const snowflake = (v) => (/^\d{15,22}$/.test(String(v)) ? String(v) : '');

// Lists of objects need their own cleaners; everything else is cleaned by its default's type.
const LISTS = {
  'reactionRoles.panels': (p) => ({
    id: str(p.id, 40) || db.uid(),
    channelId: snowflake(p.channelId),
    messageId: snowflake(p.messageId),
    title: str(p.title, 256),
    description: str(p.description, 2000),
    mode: p.mode === 'unique' ? 'unique' : 'toggle',
    roles: (Array.isArray(p.roles) ? p.roles : [])
      .slice(0, 25)
      .map((r) => ({ roleId: snowflake(r?.roleId), label: str(r?.label, 80), emoji: str(r?.emoji, 64) }))
      .filter((r) => r.roleId),
  }),
  'reactionRoles.emoji': (e) => ({ channelId: snowflake(e.channelId), messageId: snowflake(e.messageId), emoji: str(e.emoji, 64), roleId: snowflake(e.roleId) }),
  'economy.shop': (i) => ({
    id: str(i.id, 40) || db.uid(),
    name: str(i.name, 80) || 'Item',
    emoji: str(i.emoji, 64),
    price: Math.round(num(i.price, 0)),
    description: str(i.description, 300),
    roleId: snowflake(i.roleId),
  }),
  'announcements.scheduled': (a) => ({
    id: str(a.id, 40) || db.uid(),
    channelId: snowflake(a.channelId),
    title: str(a.title, 256),
    message: str(a.message, 4000),
    imageUrl: str(a.imageUrl, 500),
    pingRoleId: a.pingRoleId === 'everyone' ? 'everyone' : snowflake(a.pingRoleId),
    nextRun: num(a.nextRun, 0, 8.64e15),
    repeatHours: num(a.repeatHours, 0, 24 * 365),
    enabled: a.enabled === true,
  }),
};

function clean(def, val, key) {
  if (LISTS[key]) return (Array.isArray(val) ? val : []).filter(isObj).slice(0, 100).map(LISTS[key]);
  if (Array.isArray(def)) return Array.isArray(val) ? [...new Set(val.map((v) => str(v)).filter(Boolean))].slice(0, 500) : def;
  if (isObj(def)) {
    const out = {};
    for (const k of Object.keys(def)) out[k] = clean(def[k], isObj(val) ? val[k] : undefined, `${key}.${k}`);
    return out;
  }
  if (typeof def === 'boolean') return typeof val === 'boolean' ? val : def;
  if (typeof def === 'number') return val === undefined ? def : num(val);
  if (typeof def === 'string') return typeof val === 'string' ? val.slice(0, 4000) : def;
  return def;
}

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function gatePage(kind, guild) {
  const icon = guild?.iconURL({ size: 128 }) || '';
  const copy = {
    login: ['Welcome back', 'Sign in with Discord to manage the bot.', '<a class="btn" href="/login">Continue with Discord</a>'],
    denied: ["You don't have access", 'Only the server owner and members with the dashboard role can open this page.', '<a class="btn ghost" href="/logout">Use another account</a>'],
    offline: ['Bot is starting', "The bot isn't connected to the server yet. Try again in a moment.", '<a class="btn" href="/">Retry</a>'],
  }[kind];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · Sign in</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css"></head><body class="gate"><div class="glow"></div><main class="gate-card">
${icon ? `<img class="gate-icon" src="${icon}" alt="">` : '<div class="gate-icon fallback">✨</div>'}
<h1>${copy[0]}</h1><p>${copy[1]}</p>${copy[2]}</main></body></html>`;
}

module.exports = (client) => {
  const { CLIENT_SECRET, GUILD_ID, DASHBOARD_ROLE_ID } = process.env;
  const CLIENT_ID = process.env.CLIENT_ID || client.user.id;
  // PORT and RAILWAY_PUBLIC_DOMAIN are set automatically on Railway
  const PORT = Number(process.env.DASHBOARD_PORT || process.env.PORT) || 3000;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const BASE = (process.env.DASHBOARD_URL || railway || `http://localhost:${PORT}`).replace(/\/$/, '');
  if (!process.env.SESSION_SECRET) console.warn('⚠ SESSION_SECRET is not set — everyone will be logged out when the bot restarts.');
  if (!DASHBOARD_ROLE_ID) console.warn('⚠ DASHBOARD_ROLE_ID is not set — only the server owner can use the dashboard.');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: BASE.startsWith('https'), maxAge: 7 * 864e5 },
    }),
  );
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  async function check(req) {
    const user = req.session.user;
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return { status: 503 };
    if (!user) return { status: 401, guild };
    if (user.id === guild.ownerId) return { guild, user };
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member && DASHBOARD_ROLE_ID && member.roles.cache.has(DASHBOARD_ROLE_ID)) return { guild, user };
    return { status: 403, guild };
  }

  // ── Pages
  app.get('/', async (req, res) => {
    const r = await check(req);
    if (r.status === 503) return res.status(503).send(gatePage('offline'));
    if (r.status === 401) return res.send(gatePage('login', r.guild));
    if (r.status === 403) return res.status(403).send(gatePage('denied', r.guild));
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: `${BASE}/callback`, response_type: 'code', scope: 'identify', state, prompt: 'none' });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.redirect('/');
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code: String(code), redirect_uri: `${BASE}/callback` }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
      const { access_token } = await tokenRes.json();
      const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!meRes.ok) throw new Error(`user lookup failed (${meRes.status})`);
      const me = await meRes.json();
      req.session.regenerate((err) => {
        if (err) return res.redirect('/');
        req.session.user = { id: me.id, username: me.global_name || me.username, avatar: me.avatar };
        res.redirect('/');
      });
    } catch (err) {
      console.error('[dashboard] login failed:', err.message);
      res.redirect('/');
    }
  });

  app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  // ── API (every route below needs access)
  const api = express.Router();
  api.use(async (req, res, next) => {
    // Custom header blocks cross-site form posts (CSRF)
    if (req.method !== 'GET' && req.get('X-Dashboard') !== '1') return res.status(400).json({ error: 'Bad request' });
    const r = await check(req);
    if (r.status) return res.status(r.status).json({ error: r.status === 403 ? 'No access' : 'Not signed in' });
    req.guild = r.guild;
    req.user = r.user;
    next();
  });

  api.get('/bootstrap', (req, res) => {
    const guild = req.guild;
    const cats = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory);
    const channels = [...guild.channels.cache.values()]
      .filter((c) => [...TEXT_TYPES, ChannelType.GuildCategory, ChannelType.GuildVoice, ChannelType.GuildForum].includes(c.type))
      .sort((a, b) => {
        const pa = a.type === ChannelType.GuildCategory ? a.rawPosition : (cats.get(a.parentId)?.rawPosition ?? -1);
        const pb = b.type === ChannelType.GuildCategory ? b.rawPosition : (cats.get(b.parentId)?.rawPosition ?? -1);
        return pa - pb || (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0) || a.rawPosition - b.rawPosition;
      })
      .map((c) => ({ id: c.id, name: c.name, type: c.type === ChannelType.GuildCategory ? 'category' : c.type === ChannelType.GuildVoice ? 'voice' : TEXT_TYPES.includes(c.type) ? 'text' : 'forum', parentId: c.parentId }));
    const me = guild.members.me;
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, assignable: r.position < me.roles.highest.position }));
    const u = req.user;
    res.json({
      user: { ...u, avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(u.id) >> 22n) % 6}.png` },
      bot: { name: client.user.username, avatarUrl: client.user.displayAvatarURL({ size: 64 }) },
      guild: { id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 128 }), memberCount: guild.memberCount },
      channels,
      roles,
      config: db.guild(guild.id).config,
    });
  });

  api.get('/overview', (req, res) => {
    const guild = req.guild;
    const g = db.guild(guild.id);
    const tag = (id) => (id ? client.users.cache.get(id)?.username || id : 'AutoMod');
    const economy = Object.values(g.economy);
    res.json({
      stats: {
        members: guild.memberCount,
        humans: guild.members.cache.filter((m) => !m.user.bot).size,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size - 1,
        openTickets: Object.keys(g.tickets).filter((id) => guild.channels.cache.has(id)).length,
        warnings: Object.values(g.warnings).reduce((n, l) => n + l.length, 0),
        cases: g.cases.length,
        reminders: g.reminders.length,
        economyUsers: economy.length,
        coins: economy.reduce((n, a) => n + a.wallet + a.bank, 0),
      },
      security: { raid: g.raid, lockdown: g.lockdown.length },
      cases: g.cases.slice(-12).reverse().map((c) => ({ ...c, target: c.targetId ? tag(c.targetId) : null, moderator: tag(c.moderatorId) })),
      giveaways: Object.entries(g.giveaways).filter(([, x]) => !x.ended).map(([id, x]) => ({ id, prize: x.prize, endsAt: x.endsAt, entries: x.entrants.length, channelId: x.channelId })),
      polls: Object.entries(g.polls).filter(([, x]) => !x.ended).map(([id, x]) => ({ id, question: x.question, endsAt: x.endsAt, votes: Object.keys(x.votes).length, channelId: x.channelId })),
      tickets: Object.entries(g.tickets).filter(([id]) => guild.channels.cache.has(id)).map(([id, t]) => ({ id, number: t.number, topic: t.topic, owner: tag(t.ownerId), claimedBy: t.claimedBy && tag(t.claimedBy), openedAt: t.openedAt })),
      uptime: client.uptime,
      ping: client.ws.ping,
    });
  });

  api.get('/config', (req, res) => res.json(db.guild(req.guild.id).config));

  api.put('/config/:section', (req, res) => {
    const section = req.params.section;
    if (!Object.hasOwn(defaults, section)) return res.status(404).json({ error: 'Unknown section' });
    const g = db.guild(req.guild.id);
    g.config[section] = clean(defaults[section], req.body, section);
    db.save();
    console.log(`[dashboard] ${req.user.username} updated ${section}`);
    res.json(g.config[section]);
  });

  const action = (fn) => async (req, res) => {
    try {
      res.json((await fn(req)) || { ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Failed' });
    }
  };
  const textChannel = (guild, id) => {
    const ch = guild.channels.cache.get(id);
    if (!ch || !TEXT_TYPES.includes(ch.type)) throw new Error('Pick a text channel.');
    return ch;
  };
  const by = (req) => ({ id: req.user.id });

  api.post('/actions/ticket-panel', action(async (req) => {
    const msg = await tickets.postPanel(req.guild, textChannel(req.guild, req.body.channelId));
    return { url: msg.url };
  }));

  api.post('/actions/role-panel', action(async (req) => {
    const panel = db.guild(req.guild.id).config.reactionRoles.panels.find((p) => p.id === req.body.panelId);
    if (!panel) throw new Error('Save the panel first.');
    const msg = await reactionRoles.postPanel(req.guild, panel);
    return { url: msg.url, messageId: msg.id };
  }));

  api.post('/actions/announce', action(async (req) => {
    const { channelId, title, message, pingRoleId, imageUrl } = req.body || {};
    if (!str(message, 4000).trim()) throw new Error('Write a message first.');
    textChannel(req.guild, channelId);
    const msg = await announcements.send(req.guild, { channelId, title: str(title, 256), message: str(message, 4000), pingRoleId: pingRoleId === 'everyone' ? 'everyone' : snowflake(pingRoleId), imageUrl: str(imageUrl, 500) });
    return { url: msg.url };
  }));

  api.post('/actions/raid', action(async (req) => {
    if (req.body.on) await antiraid.startRaid(req.guild, `Turned on from the dashboard by ${req.user.username}`);
    else await antiraid.endRaid(req.guild, `Turned off from the dashboard by ${req.user.username}`);
  }));

  api.post('/actions/lockdown', action(async (req) => {
    const n = req.body.on ? await lockdown(req.guild, by(req), 'Dashboard lockdown') : await unlockdown(req.guild, by(req), 'Dashboard unlock');
    return { channels: n };
  }));

  app.use('/api', api);

  // DASHBOARD_HOST=127.0.0.1 keeps it private when a reverse proxy (Caddy) sits in front
  app.listen(PORT, process.env.DASHBOARD_HOST || '0.0.0.0', () => console.log(`✓ Dashboard running at ${BASE}`));
};
