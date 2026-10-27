// Dashboard front end — plain JS, no build step.
'use strict';

// ── Tiny helpers ────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const clone = (v) => JSON.parse(JSON.stringify(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// h('div', { class: 'x', onclick }, ...children)
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  const late = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') late[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  Object.assign(el, late);
  return el;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = val;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 || res.status === 403) {
    location.href = '/';
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(text, isError = false) {
  const el = h('div', { class: `toast${isError ? ' err' : ''}` }, text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const until = (ms) => {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return 'now';
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
};
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// ── State ───────────────────────────────────────────────────────────────────
const S = { boot: null, config: null, section: 'overview', draft: null, dirty: false, timer: null };

function markDirty() {
  S.dirty = true;
  $('#savebar').classList.add('show');
}
function clearDirty() {
  S.dirty = false;
  $('#savebar').classList.remove('show');
}

// ── Form controls ───────────────────────────────────────────────────────────
const CHANNEL_ICON = { text: '#', voice: '🔊', forum: '💬', category: '📁' };

function channelSelect(value, onChange, { types = ['text'], placeholder = '— None —' } = {}) {
  const sel = h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, h('option', { value: '' }, placeholder));
  const chans = S.boot.channels;
  const opt = (c) => h('option', { value: c.id }, `${CHANNEL_ICON[c.type]} ${c.name}`);
  if (types.length === 1 && types[0] === 'category') {
    chans.filter((c) => c.type === 'category').forEach((c) => sel.append(opt(c)));
  } else {
    chans.filter((c) => !c.parentId && c.type !== 'category' && types.includes(c.type)).forEach((c) => sel.append(opt(c)));
    for (const cat of chans.filter((c) => c.type === 'category')) {
      const kids = chans.filter((c) => c.parentId === cat.id && types.includes(c.type));
      const withCat = types.includes('category');
      if (!kids.length && !withCat) continue;
      sel.append(
        h('optgroup', { label: cat.name.toUpperCase() }, withCat && h('option', { value: cat.id }, `📁 ${cat.name} (whole category)`), kids.map(opt)),
      );
    }
  }
  sel.value = value || '';
  return sel;
}

function roleSelect(value, onChange, { placeholder = '— None —', everyone = false } = {}) {
  const sel = h(
    'select',
    { class: 'input', onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, placeholder),
    everyone && h('option', { value: 'everyone' }, '@everyone'),
    S.boot.roles.map((r) => h('option', { value: r.id }, `@${r.name}${r.assignable ? '' : '  (above bot)'}`)),
  );
  sel.value = value || '';
  return sel;
}

function toggle(checked, onChange) {
  return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) }), h('span'));
}

// Chips for a list of IDs plus a dropdown to add more.
function multiPicker(values, onChange, { kind }) {
  const box = h('div', { class: 'chips' });
  const draw = () => {
    box.replaceChildren();
    for (const id of values) {
      let label = id;
      let color = null;
      if (kind === 'role') {
        const r = S.boot.roles.find((x) => x.id === id);
        label = r ? `@${r.name}` : 'Deleted role';
        color = r?.color;
      } else {
        const c = S.boot.channels.find((x) => x.id === id);
        label = c ? `${CHANNEL_ICON[c.type]} ${c.name}` : 'Deleted channel';
      }
      box.append(
        h(
          'span',
          { class: 'chip' },
          kind === 'role' && h('span', { class: 'dot', style: color ? { background: color } : null }),
          label,
          h('button', { title: 'Remove', onclick: () => { values.splice(values.indexOf(id), 1); onChange(values); draw(); } }, '×'),
        ),
      );
    }
    const add = (v) => {
      if (v && !values.includes(v)) {
        values.push(v);
        onChange(values);
        draw();
      }
    };
    box.append(kind === 'role' ? roleSelect('', add, { placeholder: '+ Add role' }) : channelSelect('', add, { types: ['text', 'category'], placeholder: '+ Add channel' }));
  };
  draw();
  return box;
}

function tagsInput(values, onChange, placeholder = 'Type and press Enter') {
  const box = h('div', { class: 'chips' });
  const draw = () => {
    box.replaceChildren();
    for (const v of values) {
      box.append(h('span', { class: 'chip' }, v, h('button', { title: 'Remove', onclick: () => { values.splice(values.indexOf(v), 1); onChange(values); draw(); } }, '×')));
    }
    const input = h('input', {
      class: 'input',
      placeholder,
      onkeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        const parts = input.value.split(',').map((s) => s.trim()).filter(Boolean);
        for (const p of parts) if (!values.includes(p)) values.push(p);
        if (parts.length) {
          onChange(values);
          draw();
          box.querySelector('input').focus();
        }
      },
    });
    box.append(input);
  };
  draw();
  return box;
}

function renderField(f) {
  const val = getPath(S.draft, f.k);
  const set = (v) => {
    setPath(S.draft, f.k, v);
    markDirty();
  };
  let ctl;
  let stack = false;
  switch (f.t) {
    case 'toggle':
      ctl = toggle(val, set);
      break;
    case 'number':
      ctl = [
        h('input', { class: 'input num', type: 'number', min: f.min ?? 0, max: f.max, step: f.step || 1, value: val, oninput: (e) => set(Number(e.target.value)) }),
        f.suffix && h('span', { class: 'suffix' }, f.suffix),
      ];
      break;
    case 'text':
      stack = !!f.wide;
      ctl = h('input', { class: 'input', value: val ?? '', placeholder: f.placeholder || '', oninput: (e) => set(e.target.value) });
      break;
    case 'textarea':
      stack = true;
      ctl = h('textarea', { class: 'input', value: val ?? '', placeholder: f.placeholder || '', oninput: (e) => set(e.target.value) });
      break;
    case 'select': {
      const sel = h('select', { class: 'input', onchange: (e) => set(e.target.value) }, f.options.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = val;
      ctl = sel;
      break;
    }
    case 'channel':
      ctl = channelSelect(val, set, { types: f.types || ['text'] });
      break;
    case 'category':
      ctl = channelSelect(val, set, { types: ['category'], placeholder: '— No category —' });
      break;
    case 'role':
      ctl = roleSelect(val, set);
      break;
    case 'roles':
      stack = true;
      ctl = multiPicker(val, set, { kind: 'role' });
      break;
    case 'channels':
      stack = true;
      ctl = multiPicker(val, set, { kind: 'channel' });
      break;
    case 'tags':
      stack = true;
      ctl = tagsInput(val, set, f.placeholder);
      break;
    case 'color': {
      const text = h('input', { class: 'input num', value: val, maxLength: 7, oninput: (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { picker.value = e.target.value; set(e.target.value); } } });
      const picker = h('input', { type: 'color', value: val, oninput: (e) => { text.value = e.target.value; set(e.target.value); } });
      ctl = [picker, text];
      break;
    }
  }
  return h(
    'div',
    { class: `field${stack ? ' stack' : ''}` },
    h('div', { class: 'lbl' }, h('b', null, f.label), f.help && h('small', null, f.help)),
    h('div', { class: 'ctl' }, ctl),
  );
}

// ── Sections ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { group: 'General' },
  { id: 'overview', icon: '🏠', label: 'Overview', desc: 'A live look at your server and everything the bot is doing.', render: renderOverview },
  {
    id: 'appearance',
    icon: '🎨',
    label: 'Appearance',
    config: 'theme',
    desc: 'How every message from the bot looks.',
    groups: [
      {
        title: 'Embed style',
        fields: [
          { k: 'color', t: 'color', label: 'Brand colour', help: 'Used on the side of every embed.' },
          { k: 'footer', t: 'text', label: 'Footer text', placeholder: 'Defaults to the server name', help: 'Shown at the bottom of embeds.' },
        ],
      },
    ],
  },
  {
    id: 'welcome',
    icon: '👋',
    label: 'Welcome & Roles',
    config: 'welcome',
    desc: 'Greet new members, say goodbye, and hand out roles automatically.',
    groups: [
      {
        title: 'Welcome message',
        desc: 'Placeholders: {user} {username} {server} {count}',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Send welcome messages' },
          { k: 'channelId', t: 'channel', label: 'Channel' },
          { k: 'message', t: 'textarea', label: 'Message' },
        ],
      },
      {
        title: 'Leave message',
        fields: [
          { k: 'leaveEnabled', t: 'toggle', label: 'Send leave messages' },
          { k: 'leaveChannelId', t: 'channel', label: 'Channel' },
          { k: 'leaveMessage', t: 'textarea', label: 'Message' },
        ],
      },
      {
        title: 'Direct message',
        fields: [
          { k: 'dmEnabled', t: 'toggle', label: 'DM new members' },
          { k: 'dmMessage', t: 'textarea', label: 'Message' },
        ],
      },
      { title: 'Auto roles', desc: 'Given to every new member when they join.', fields: [{ k: 'autoRoles', t: 'roles', label: 'Roles' }] },
    ],
  },
  { group: 'Safety' },
  {
    id: 'moderation',
    icon: '🛡️',
    label: 'Moderation',
    config: 'moderation',
    desc: 'How warnings escalate and how members are told about actions.',
    groups: [
      {
        title: 'Notifications',
        fields: [{ k: 'dmOnAction', t: 'toggle', label: 'DM members when they are punished', help: 'Includes the reason and duration.' }],
      },
      {
        title: 'Warning escalation',
        desc: 'Set a value to 0 to turn that step off.',
        fields: [
          { k: 'warnTimeoutAt', t: 'number', label: 'Time out at', suffix: 'warnings' },
          { k: 'warnTimeoutMinutes', t: 'number', label: 'Timeout length', suffix: 'minutes', min: 1 },
          { k: 'warnKickAt', t: 'number', label: 'Kick at', suffix: 'warnings' },
          { k: 'warnBanAt', t: 'number', label: 'Ban at', suffix: 'warnings' },
        ],
      },
    ],
  },
  {
    id: 'automod',
    icon: '🤖',
    label: 'AutoMod',
    config: 'automod',
    desc: 'Automatically remove spam, invites, bad words and more. Staff with Manage Messages are never filtered.',
    groups: [
      {
        title: 'General',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable AutoMod' },
          { k: 'action', t: 'select', label: 'When a rule is broken', options: [['delete', 'Delete the message only'], ['warn', 'Delete + warn (uses escalation)'], ['timeout', 'Delete + timeout']] },
          { k: 'timeoutMinutes', t: 'number', label: 'Timeout length', suffix: 'minutes', min: 1 },
        ],
      },
      {
        title: 'Filters',
        fields: [
          { k: 'antiSpam', t: 'toggle', label: 'Spam', help: 'Too many messages too quickly.' },
          { k: 'spamMessages', t: 'number', label: 'Messages allowed', suffix: 'msgs', min: 2 },
          { k: 'spamSeconds', t: 'number', label: '…within', suffix: 'seconds', min: 1 },
          { k: 'antiDuplicate', t: 'toggle', label: 'Repeated messages', help: 'Same message 3 times in 30s.' },
          { k: 'antiInvite', t: 'toggle', label: 'Discord invites' },
          { k: 'antiMassMention', t: 'toggle', label: 'Mass mentions' },
          { k: 'mentionLimit', t: 'number', label: 'Mention limit', suffix: 'per message', min: 2 },
          { k: 'antiCaps', t: 'toggle', label: 'Excessive caps' },
          { k: 'capsPercent', t: 'number', label: 'Caps threshold', suffix: '%', min: 10, max: 100 },
          { k: 'capsMinLength', t: 'number', label: 'Only check messages longer than', suffix: 'letters' },
        ],
      },
      {
        title: 'Links & words',
        fields: [
          { k: 'antiLinks', t: 'toggle', label: 'Block links', help: 'Except the allowed domains below.' },
          { k: 'allowedDomains', t: 'tags', label: 'Allowed domains', placeholder: 'e.g. youtube.com' },
          { k: 'bannedWords', t: 'tags', label: 'Banned words', placeholder: 'Add a word and press Enter' },
        ],
      },
      {
        title: 'Exemptions',
        fields: [
          { k: 'exemptRoles', t: 'roles', label: 'Ignored roles' },
          { k: 'exemptChannels', t: 'channels', label: 'Ignored channels / categories' },
        ],
      },
    ],
  },
  {
    id: 'antiraid',
    icon: '🚨',
    label: 'Anti-Raid',
    config: 'antiraid',
    desc: 'Stops join raids, nuke attempts by rogue staff, unapproved bots and brand-new accounts.',
    groups: [
      {
        title: 'Raid detection',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable anti-raid' },
          { k: 'joinThreshold', t: 'number', label: 'Trigger after', suffix: 'joins', min: 2 },
          { k: 'joinSeconds', t: 'number', label: '…within', suffix: 'seconds', min: 1 },
          { k: 'raidAction', t: 'select', label: 'During a raid, new members are', options: [['kick', 'Kicked'], ['timeout', 'Timed out (1h)'], ['ban', 'Banned']] },
          { k: 'raidDurationMinutes', t: 'number', label: 'Raid mode lasts', suffix: 'minutes', min: 1 },
          { k: 'lockdownOnRaid', t: 'toggle', label: 'Lock all channels when a raid starts' },
          { k: 'alertRoleId', t: 'role', label: 'Ping this role on alerts' },
        ],
      },
      {
        title: 'New accounts',
        fields: [
          { k: 'minAccountAgeDays', t: 'number', label: 'Minimum account age', suffix: 'days (0 = off)' },
          { k: 'youngAccountAction', t: 'select', label: 'Young accounts are', options: [['flag', 'Flagged in the log'], ['timeout', 'Timed out (1h)'], ['kick', 'Kicked']] },
        ],
      },
      {
        title: 'Anti-nuke',
        desc: 'Catches anyone mass-deleting channels/roles, mass-banning, or spamming webhooks.',
        fields: [
          { k: 'antiNuke', t: 'toggle', label: 'Enable anti-nuke' },
          { k: 'nukeThreshold', t: 'number', label: 'Trigger after', suffix: 'actions', min: 2 },
          { k: 'nukeSeconds', t: 'number', label: '…within', suffix: 'seconds', min: 5 },
          { k: 'nukePunishment', t: 'select', label: 'Punishment', options: [['strip', 'Remove all their roles'], ['kick', 'Kick'], ['ban', 'Ban']] },
          { k: 'antiBotAdd', t: 'toggle', label: 'Kick bots added by non-whitelisted users' },
          { k: 'whitelist', t: 'tags', label: 'Trusted user IDs', placeholder: 'Paste a user ID and press Enter', help: 'The server owner is always trusted.' },
        ],
      },
    ],
  },
  {
    id: 'logging',
    icon: '📜',
    label: 'Logging',
    config: 'logging',
    desc: 'Keep a record of everything that happens in the server.',
    groups: [
      {
        title: 'Channels',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable logging' },
          { k: 'channelId', t: 'channel', label: 'Server log channel' },
          { k: 'modChannelId', t: 'channel', label: 'Moderation log channel', help: 'Cases, AutoMod and security alerts. Falls back to the server log.' },
          { k: 'ignoredChannels', t: 'channels', label: 'Ignored channels' },
        ],
      },
      {
        title: 'What to log',
        fields: [
          { k: 'events.messageDelete', t: 'toggle', label: 'Deleted messages' },
          { k: 'events.messageEdit', t: 'toggle', label: 'Edited messages' },
          { k: 'events.memberJoin', t: 'toggle', label: 'Members joining' },
          { k: 'events.memberLeave', t: 'toggle', label: 'Members leaving' },
          { k: 'events.memberUpdate', t: 'toggle', label: 'Role & nickname changes' },
          { k: 'events.bans', t: 'toggle', label: 'Bans & unbans' },
          { k: 'events.channels', t: 'toggle', label: 'Channels created / deleted' },
          { k: 'events.roles', t: 'toggle', label: 'Roles created / deleted' },
          { k: 'events.voice', t: 'toggle', label: 'Voice activity' },
        ],
      },
    ],
  },
  { group: 'Community' },
  {
    id: 'tickets',
    icon: '🎫',
    label: 'Tickets',
    config: 'tickets',
    desc: 'Private support channels with claim, close and HTML transcripts.',
    groups: [
      {
        title: 'Setup',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable tickets' },
          { k: 'categoryId', t: 'category', label: 'Create tickets in category' },
          { k: 'supportRoles', t: 'roles', label: 'Support team roles', help: 'Can see, claim and close every ticket.' },
          { k: 'transcriptChannelId', t: 'channel', label: 'Transcript channel' },
          { k: 'maxOpen', t: 'number', label: 'Open tickets per member', min: 1, max: 10 },
        ],
      },
      {
        title: 'Panel & messages',
        fields: [
          { k: 'panelTitle', t: 'text', label: 'Panel title', wide: true },
          { k: 'panelDescription', t: 'textarea', label: 'Panel description' },
          { k: 'buttonLabel', t: 'text', label: 'Button / menu text' },
          { k: 'topics', t: 'tags', label: 'Topics', help: 'With 2+ topics members pick one from a menu.', placeholder: 'Add a topic' },
          { k: 'welcomeMessage', t: 'textarea', label: 'Message inside new tickets', placeholder: 'Placeholders: {user} {server}' },
        ],
      },
      {
        title: 'Post the panel',
        render: () => {
          const btn = h('button', { class: 'btn', onclick: async () => {
            btn.disabled = true;
            try {
              if (S.dirty) await save();
              const r = await api('/actions/ticket-panel', { method: 'POST', body: { channelId: S.draft.panelChannelId } });
              toast('Ticket panel posted ✓');
              window.open(r.url, '_blank');
            } catch (e) { toast(e.message, true); }
            btn.disabled = false;
          } }, '🎫  Post panel');
          return [renderField({ k: 'panelChannelId', t: 'channel', label: 'Channel' }), h('div', { class: 'actions' }, btn)];
        },
      },
    ],
  },
  {
    id: 'roles',
    icon: '🎭',
    label: 'Reaction Roles',
    config: 'reactionRoles',
    desc: 'Button role panels members can click, plus classic emoji reactions.',
    groups: [
      { title: 'Button role panels', desc: 'Build a panel, save, then post it. Posting again updates the same message.', render: renderPanels },
      { title: 'Emoji reaction roles', desc: 'Add these in Discord with /reactionrole add.', render: renderEmojiRoles },
    ],
  },
  {
    id: 'afk',
    icon: '💤',
    label: 'AFK',
    config: 'afk',
    desc: 'Members can set an AFK status with /afk.',
    groups: [
      {
        title: 'Settings',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable AFK' },
          { k: 'nickPrefix', t: 'text', label: 'Nickname prefix', placeholder: '[AFK] ', help: 'Added to their name while AFK. Leave empty to skip.' },
        ],
      },
    ],
  },
  {
    id: 'economy',
    icon: '🪙',
    label: 'Economy',
    config: 'economy',
    desc: 'Your own server currency with jobs, gambling and a shop.',
    groups: [
      {
        title: 'Currency',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Enable economy' },
          { k: 'currencyName', t: 'text', label: 'Currency name' },
          { k: 'currencyEmoji', t: 'text', label: 'Currency emoji' },
          { k: 'startingBalance', t: 'number', label: 'Starting balance' },
        ],
      },
      {
        title: 'Earning',
        fields: [
          { k: 'daily', t: 'number', label: '/daily reward' },
          { k: 'weekly', t: 'number', label: '/weekly reward' },
          { k: 'workMin', t: 'number', label: '/work minimum' },
          { k: 'workMax', t: 'number', label: '/work maximum' },
          { k: 'workCooldownMinutes', t: 'number', label: '/work cooldown', suffix: 'minutes' },
          { k: 'chatRewards', t: 'toggle', label: 'Earn coins by chatting' },
          { k: 'chatMin', t: 'number', label: 'Per message (min)' },
          { k: 'chatMax', t: 'number', label: 'Per message (max)' },
          { k: 'chatCooldownSeconds', t: 'number', label: 'Chat cooldown', suffix: 'seconds' },
        ],
      },
      {
        title: 'Risk',
        fields: [
          { k: 'robEnabled', t: 'toggle', label: 'Allow /rob' },
          { k: 'maxBet', t: 'number', label: 'Maximum bet', suffix: '0 = no limit' },
        ],
      },
      { title: 'Shop', desc: 'Items members can buy with /buy. Items can grant a role.', render: renderShop },
    ],
  },
  {
    id: 'announcements',
    icon: '📢',
    label: 'Announcements',
    config: 'announcements',
    desc: 'Send beautiful announcements now or schedule them to repeat.',
    groups: [
      { title: 'Send now', render: renderSendNow },
      { title: 'Defaults', fields: [{ k: 'defaultChannelId', t: 'channel', label: 'Default channel for /announce' }] },
      { title: 'Scheduled announcements', desc: 'Times use your browser’s time zone.', render: renderScheduled },
    ],
  },
];

// ── Custom editors ──────────────────────────────────────────────────────────
function rerender() {
  const y = window.scrollY;
  renderSection();
  window.scrollTo(0, y);
}

function renderPanels() {
  const panels = S.draft.panels;
  const out = panels.map((p, i) => {
    const change = (k) => (v) => { p[k] = v; markDirty(); };
    const postBtn = h('button', { class: 'btn sm', onclick: async () => {
      postBtn.disabled = true;
      try {
        if (S.dirty) await save();
        const r = await api('/actions/role-panel', { method: 'POST', body: { panelId: p.id } });
        const stored = S.config.reactionRoles.panels.find((x) => x.id === p.id);
        if (stored) stored.messageId = r.messageId;
        p.messageId = r.messageId;
        toast('Panel posted ✓');
        rerender();
      } catch (e) { toast(e.message, true); }
      postBtn.disabled = false;
    } }, p.messageId ? '↻  Save & update message' : '🚀  Save & post');
    return h(
      'div',
      { class: 'item' },
      h('div', { class: 'item-head' },
        h('span', { class: 'grow' }, p.title || 'Untitled panel'),
        h('span', { class: `badge ${p.messageId ? 'green' : ''}` }, p.messageId ? 'Posted' : 'Not posted'),
        h('button', { class: 'icon-btn', title: 'Delete panel', onclick: () => { panels.splice(i, 1); markDirty(); rerender(); } }, '🗑'),
      ),
      h('div', { class: 'form-grid' },
        h('label', null, 'Title', h('input', { class: 'input', value: p.title, oninput: (e) => change('title')(e.target.value) })),
        h('label', null, 'Channel', channelSelect(p.channelId, (v) => { p.channelId = v; p.messageId = ''; markDirty(); })),
        h('label', null, 'Mode', (() => {
          const s = h('select', { class: 'input', onchange: (e) => change('mode')(e.target.value) }, h('option', { value: 'toggle' }, 'Pick any number'), h('option', { value: 'unique' }, 'Pick only one'));
          s.value = p.mode;
          return s;
        })()),
        h('label', { class: 'full' }, 'Description', h('textarea', { class: 'input', value: p.description, style: { minHeight: '60px' }, oninput: (e) => change('description')(e.target.value) })),
      ),
      h('div', { class: 'lbl-sm', style: { marginTop: '12px' } }, 'Roles  ·  role · button label · emoji'),
      p.roles.map((r, j) =>
        h('div', { class: 'subrow' },
          roleSelect(r.roleId, (v) => { r.roleId = v; markDirty(); }, { placeholder: 'Choose role' }),
          h('input', { class: 'input', placeholder: 'Label', value: r.label, oninput: (e) => { r.label = e.target.value; markDirty(); } }),
          h('input', { class: 'input', placeholder: '🔥', value: r.emoji, oninput: (e) => { r.emoji = e.target.value; markDirty(); } }),
          h('button', { class: 'icon-btn', onclick: () => { p.roles.splice(j, 1); markDirty(); rerender(); } }, '✕'),
        ),
      ),
      h('div', { class: 'actions' },
        p.roles.length < 25 && h('button', { class: 'btn ghost sm', onclick: () => { p.roles.push({ roleId: '', label: '', emoji: '' }); markDirty(); rerender(); } }, '+ Add role'),
        postBtn,
      ),
    );
  });
  return [
    out.length ? out : h('div', { class: 'empty' }, 'No panels yet.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => {
      panels.push({ id: uid(), channelId: '', messageId: '', title: 'Pick your roles', description: '', mode: 'toggle', roles: [{ roleId: '', label: '', emoji: '' }] });
      markDirty();
      rerender();
    } }, '+ New panel')),
  ];
}

function renderEmojiRoles() {
  const list = S.draft.emoji;
  if (!list.length) return h('div', { class: 'empty' }, 'None yet.');
  return h('div', { class: 'list' }, list.map((e, i) => {
    const role = S.boot.roles.find((r) => r.id === e.roleId);
    const emoji = /^\d+$/.test(e.emoji) ? h('img', { src: `https://cdn.discordapp.com/emojis/${e.emoji}.png`, style: { width: '20px', height: '20px' } }) : e.emoji;
    return h('div', { class: 'row' },
      h('span', { style: { fontSize: '18px' } }, emoji),
      h('span', { class: 'grow' }, role ? `@${role.name}` : 'Deleted role'),
      h('a', { href: `https://discord.com/channels/${S.boot.guild.id}/${e.channelId}/${e.messageId}`, target: '_blank', class: 'meta' }, 'View message ↗'),
      h('button', { class: 'icon-btn', onclick: () => { list.splice(i, 1); markDirty(); rerender(); } }, '🗑'),
    );
  }));
}

function renderShop() {
  const items = S.draft.shop;
  const out = items.map((it, i) => {
    const set = (k, cast = String) => (e) => { it[k] = cast(e.target.value); markDirty(); };
    return h('div', { class: 'item' },
      h('div', { class: 'item-head' },
        h('span', { class: 'grow' }, `${it.emoji || '📦'}  ${it.name || 'New item'}`),
        h('button', { class: 'icon-btn', onclick: () => { items.splice(i, 1); markDirty(); rerender(); } }, '🗑'),
      ),
      h('div', { class: 'form-grid' },
        h('label', null, 'Name', h('input', { class: 'input', value: it.name, oninput: set('name') })),
        h('label', null, 'Emoji', h('input', { class: 'input', value: it.emoji, oninput: set('emoji') })),
        h('label', null, 'Price', h('input', { class: 'input', type: 'number', min: 0, value: it.price, oninput: set('price', Number) })),
        h('label', null, 'Gives role (optional)', roleSelect(it.roleId, (v) => { it.roleId = v; markDirty(); })),
        h('label', { class: 'full' }, 'Description', h('input', { class: 'input', value: it.description, oninput: set('description') })),
      ),
    );
  });
  return [
    out.length ? out : h('div', { class: 'empty' }, 'The shop is empty.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => {
      items.push({ id: uid(), name: 'VIP', emoji: '💎', price: 5000, description: '', roleId: '' });
      markDirty();
      rerender();
    } }, '+ Add item')),
  ];
}

function embedPreview(get) {
  const box = h('div', { class: 'preview' });
  const draw = () => {
    const { title, message } = get();
    box.replaceChildren(
      h('div', { class: 'bar', style: { background: S.config.theme.color } }),
      h('div', null, title && h('div', { class: 't' }, `📢  ${title}`), h('div', { class: 'd' }, message || 'Your message will appear here…')),
    );
  };
  draw();
  return { box, draw };
}

const sendForm = { channelId: '', pingRoleId: '', title: '', message: '', imageUrl: '' };
function renderSendNow() {
  if (!sendForm.channelId) sendForm.channelId = S.draft.defaultChannelId;
  const preview = embedPreview(() => sendForm);
  const set = (k) => (e) => { sendForm[k] = e.target.value; preview.draw(); };
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true;
    try {
      const r = await api('/actions/announce', { method: 'POST', body: sendForm });
      toast('Announcement sent ✓');
      sendForm.title = sendForm.message = sendForm.imageUrl = '';
      rerender();
      window.open(r.url, '_blank');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  } }, '📢  Send announcement');
  return [
    h('div', { class: 'form-grid' },
      h('label', null, 'Channel', channelSelect(sendForm.channelId, (v) => (sendForm.channelId = v))),
      h('label', null, 'Ping', roleSelect(sendForm.pingRoleId, (v) => (sendForm.pingRoleId = v), { placeholder: 'No ping', everyone: true })),
      h('label', { class: 'full' }, 'Title', h('input', { class: 'input', value: sendForm.title, oninput: set('title') })),
      h('label', { class: 'full' }, 'Message (Discord markdown works)', h('textarea', { class: 'input', value: sendForm.message, oninput: set('message') })),
      h('label', { class: 'full' }, 'Image URL (optional)', h('input', { class: 'input', value: sendForm.imageUrl, placeholder: 'https://…', oninput: set('imageUrl') })),
      h('label', { class: 'full' }, 'Preview', preview.box),
    ),
    h('div', { class: 'actions' }, btn),
  ];
}

const toLocalInput = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function renderScheduled() {
  const list = S.draft.scheduled;
  const out = list.map((a, i) => {
    const set = (k, cast = String) => (e) => { a[k] = cast(e.target.value); markDirty(); };
    return h('div', { class: 'item' },
      h('div', { class: 'item-head' },
        h('span', { class: 'grow' }, a.title || 'Untitled announcement'),
        h('span', { class: `badge ${a.enabled ? 'green' : ''}` }, a.enabled ? (a.nextRun ? `Next ${until(a.nextRun)}` : 'No time set') : 'Paused'),
        toggle(a.enabled, (v) => { a.enabled = v; markDirty(); }),
        h('button', { class: 'icon-btn', onclick: () => { list.splice(i, 1); markDirty(); rerender(); } }, '🗑'),
      ),
      h('div', { class: 'form-grid' },
        h('label', null, 'Channel', channelSelect(a.channelId, (v) => { a.channelId = v; markDirty(); })),
        h('label', null, 'Ping', roleSelect(a.pingRoleId, (v) => { a.pingRoleId = v; markDirty(); }, { placeholder: 'No ping', everyone: true })),
        h('label', null, 'First send', h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(a.nextRun), oninput: (e) => { a.nextRun = e.target.value ? new Date(e.target.value).getTime() : 0; markDirty(); } })),
        h('label', null, 'Repeat every (hours, 0 = once)', h('input', { class: 'input', type: 'number', min: 0, value: a.repeatHours, oninput: set('repeatHours', Number) })),
        h('label', { class: 'full' }, 'Title', h('input', { class: 'input', value: a.title, oninput: set('title') })),
        h('label', { class: 'full' }, 'Message', h('textarea', { class: 'input', value: a.message, oninput: set('message') })),
        h('label', { class: 'full' }, 'Image URL (optional)', h('input', { class: 'input', value: a.imageUrl || '', oninput: set('imageUrl') })),
      ),
    );
  });
  return [
    out.length ? out : h('div', { class: 'empty' }, 'Nothing scheduled.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => {
      list.push({ id: uid(), channelId: S.draft.defaultChannelId, title: '', message: '', imageUrl: '', pingRoleId: '', nextRun: Date.now() + 36e5, repeatHours: 0, enabled: true });
      markDirty();
      rerender();
    } }, '+ Schedule announcement')),
  ];
}

// ── Overview ────────────────────────────────────────────────────────────────
const CASE_ICON = { ban: '🔨', unban: '🕊️', kick: '👢', timeout: '🔇', untimeout: '🔊', warn: '⚠️', clearwarns: '🧹', purge: '🗑️', lockdown: '🔒', unlock: '🔓', antinuke: '☢️', automod: '🤖' };

async function renderOverview(root) {
  const o = await api('/overview');
  if (S.section !== 'overview') return;
  const st = o.stats;
  const stat = (icon, k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, icon, k), h('div', { class: 'v' }, v));
  const raid = o.security.raid.active;
  const locked = o.security.lockdown > 0;
  const act = (path, body, msg) => async (e) => {
    e.target.disabled = true;
    try {
      await api(path, { method: 'POST', body });
      toast(msg);
      renderSection();
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
  const link = (ch, id) => `https://discord.com/channels/${S.boot.guild.id}/${ch}/${id}`;

  root.append(
    h('div', { class: 'stats' },
      stat('👥', 'Members', fmt(st.members)),
      stat('🎫', 'Open tickets', fmt(st.openTickets)),
      stat('⚠️', 'Warnings issued', fmt(st.warnings)),
      stat('📁', 'Mod cases', fmt(st.cases)),
      stat('🪙', 'Coins in circulation', fmt(st.coins)),
      stat('⏰', 'Pending reminders', fmt(st.reminders)),
    ),
    h('div', { class: 'grid two' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', null, h('h3', null, 'Security'), h('p', { class: 'sub', style: { margin: 0 } }, 'Emergency controls')),
          h('span', { class: `badge ${raid ? 'red' : 'green'}` }, h('span', { class: `pulse${raid ? ' red' : ''}` }), raid ? 'Raid mode' : 'All calm'),
        ),
        h('div', { class: 'field' },
          h('div', { class: 'lbl' }, h('b', null, 'Raid mode'), h('small', null, raid ? `Active — ends ${until(o.security.raid.until)}` : 'New members are removed while on.')),
          h('button', { class: `btn sm ${raid ? 'ghost' : 'danger'}`, onclick: act('/actions/raid', { on: !raid }, raid ? 'Raid mode off' : 'Raid mode on') }, raid ? 'Turn off' : 'Turn on'),
        ),
        h('div', { class: 'field' },
          h('div', { class: 'lbl' }, h('b', null, 'Lockdown'), h('small', null, locked ? `${o.security.lockdown} channels locked` : 'Lock every public channel at once.')),
          h('button', { class: `btn sm ${locked ? 'ghost' : 'danger'}`, onclick: act('/actions/lockdown', { on: !locked }, locked ? 'Lockdown lifted' : 'Server locked down') }, locked ? 'Unlock all' : 'Lock all'),
        ),
        h('div', { class: 'field' },
          h('div', { class: 'lbl' }, h('b', null, 'Bot status'), h('small', null, `Gateway ping ${o.ping}ms · up ${Math.floor(o.uptime / 36e5)}h ${Math.floor((o.uptime % 36e5) / 6e4)}m`)),
          h('span', { class: 'badge green' }, 'Online'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Recent moderation'),
        h('p', { class: 'sub' }, 'Latest cases from commands, AutoMod and anti-raid'),
        o.cases.length
          ? h('div', { class: 'list' }, o.cases.map((c) => h('div', { class: 'row' },
              h('span', null, CASE_ICON[c.action] || '📝'),
              h('span', { class: 'grow' }, h('b', null, c.target ? `${c.target}` : c.action), h('span', { class: 'meta' }, `  ·  ${c.reason || ''}`)),
              h('span', { class: 'meta' }, `#${c.id} · ${ago(c.at)}`),
            )))
          : h('div', { class: 'empty' }, 'No cases yet — peaceful!'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Giveaways & polls'),
        h('p', { class: 'sub' }, 'Start them in Discord with /giveaway start and /poll'),
        o.giveaways.length + o.polls.length
          ? h('div', { class: 'list' },
              o.giveaways.map((g) => h('div', { class: 'row' }, h('span', null, '🎉'), h('a', { class: 'grow', href: link(g.channelId, g.id), target: '_blank' }, g.prize), h('span', { class: 'badge violet' }, `${g.entries} entries`), h('span', { class: 'meta' }, `ends ${until(g.endsAt)}`))),
              o.polls.map((p) => h('div', { class: 'row' }, h('span', null, '📊'), h('a', { class: 'grow', href: link(p.channelId, p.id), target: '_blank' }, p.question), h('span', { class: 'badge' }, `${p.votes} votes`), h('span', { class: 'meta' }, `ends ${until(p.endsAt)}`))),
            )
          : h('div', { class: 'empty' }, 'Nothing running right now.'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Open tickets'),
        h('p', { class: 'sub' }, 'Support requests waiting on staff'),
        o.tickets.length
          ? h('div', { class: 'list' }, o.tickets.map((t) => h('div', { class: 'row' },
              h('span', null, '🎫'),
              h('a', { class: 'grow', href: `https://discord.com/channels/${S.boot.guild.id}/${t.id}`, target: '_blank' }, `#${t.number} · ${t.topic}`),
              h('span', { class: `badge ${t.claimedBy ? 'green' : 'amber'}` }, t.claimedBy ? `Claimed · ${t.claimedBy}` : 'Unclaimed'),
              h('span', { class: 'meta' }, `${t.owner} · ${ago(t.openedAt)}`),
            )))
          : h('div', { class: 'empty' }, 'Inbox zero ✨'),
      ),
    ),
  );
}

// ── Rendering & navigation ──────────────────────────────────────────────────
function renderSidebar() {
  const { guild, user } = S.boot;
  const items = [
    h('div', { class: 'brand' },
      guild.iconUrl ? h('img', { src: guild.iconUrl, alt: '' }) : h('div', { class: 'ph' }, '✨'),
      h('div', null, h('b', null, guild.name), h('span', null, `${fmt(guild.memberCount)} members`)),
    ),
    SECTIONS.map((s) =>
      s.group
        ? h('div', { class: 'nav-label' }, s.group)
        : h('button', { class: `nav-item${S.section === s.id ? ' active' : ''}`, onclick: () => go(s.id) }, h('span', { class: 'ico' }, s.icon), s.label),
    ),
    h('div', { class: 'me' }, h('img', { src: user.avatarUrl, alt: '' }), h('div', null, h('b', null, user.username), h('a', { href: '/logout' }, 'Sign out'))),
  ];
  $('#sidebar').replaceChildren(...items.flat());
}

function renderSection() {
  const sec = SECTIONS.find((s) => s.id === S.section);
  const root = $('#content');
  clearInterval(S.timer);
  root.replaceChildren(
    h('button', { class: 'btn ghost sm menu-btn', onclick: () => $('#sidebar').classList.toggle('open') }, '☰  Menu'),
    h('div', { class: 'page-head' }, h('h1', null, sec.icon, ' ', sec.label), h('p', null, sec.desc)),
  );
  if (sec.render) {
    sec.render(root).catch((e) => toast(e.message, true));
    if (sec.id === 'overview') S.timer = setInterval(() => S.section === 'overview' && !document.hidden && rerender(), 30_000);
    return;
  }
  root.append(
    h('div', { class: 'grid' }, sec.groups.map((g) =>
      h('div', { class: 'card' }, h('h3', null, g.title), g.desc && h('p', { class: 'sub' }, g.desc), g.render ? g.render() : g.fields.map(renderField)),
    )),
  );
}

async function go(id, force = false) {
  if (S.dirty && !force && !confirm('You have unsaved changes. Leave without saving?')) return;
  clearDirty();
  S.section = id;
  history.replaceState(null, '', `#${id}`);
  $('#sidebar').classList.remove('open');
  renderSidebar();
  const sec = SECTIONS.find((s) => s.id === id);
  if (sec.config) {
    const config = await api('/config');
    if (S.section !== id) return; // user clicked somewhere else meanwhile
    S.config = config;
    S.draft = clone(config[sec.config]);
  }
  renderSection();
  window.scrollTo(0, 0);
}

async function save() {
  const sec = SECTIONS.find((s) => s.id === S.section);
  const btn = $('#save');
  btn.disabled = true;
  try {
    const saved = await api(`/config/${sec.config}`, { method: 'PUT', body: S.draft });
    S.config[sec.config] = saved;
    S.draft = clone(saved);
    clearDirty();
    toast('Settings saved ✓');
    rerender();
  } catch (e) {
    toast(e.message, true);
    throw e;
  } finally {
    btn.disabled = false;
  }
}

$('#save').addEventListener('click', () => save().catch(() => {}));
$('#discard').addEventListener('click', () => {
  const sec = SECTIONS.find((s) => s.id === S.section);
  S.draft = clone(S.config[sec.config]);
  clearDirty();
  rerender();
});
window.addEventListener('beforeunload', (e) => {
  if (S.dirty) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && S.dirty) {
    e.preventDefault();
    save().catch(() => {});
  }
});

(async function start() {
  try {
    S.boot = await api('/bootstrap');
    S.config = S.boot.config;
    document.title = `${S.boot.guild.name} · Dashboard`;
    const initial = location.hash.slice(1);
    await go(SECTIONS.some((s) => s.id === initial) ? initial : 'overview', true);
  } catch (e) {
    $('#content').replaceChildren(h('div', { class: 'loading' }, `Couldn't load the dashboard: ${e.message}`));
  }
})();
