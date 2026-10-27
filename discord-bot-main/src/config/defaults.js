// Default settings for a server. Everything here can be changed from the dashboard.
// Stored settings are merged on top of these, so new options appear automatically.
module.exports = {
  theme: {
    color: '#8B5CF6',
    footer: '',
  },

  welcome: {
    enabled: false,
    channelId: '',
    message: 'Welcome {user} to **{server}**! You are our **#{count}** member.',
    leaveEnabled: false,
    leaveChannelId: '',
    leaveMessage: '**{username}** has left the server. We now have {count} members.',
    dmEnabled: false,
    dmMessage: 'Welcome to {server}! Make sure to read the rules.',
    autoRoles: [],
  },

  logging: {
    enabled: true,
    channelId: '',
    modChannelId: '',
    ignoredChannels: [],
    events: {
      messageDelete: true,
      messageEdit: true,
      memberJoin: true,
      memberLeave: true,
      memberUpdate: true,
      channels: true,
      roles: true,
      bans: true,
      voice: true,
    },
  },

  moderation: {
    dmOnAction: true,
    warnTimeoutAt: 3,
    warnTimeoutMinutes: 60,
    warnKickAt: 5,
    warnBanAt: 7,
  },

  automod: {
    enabled: true,
    exemptRoles: [],
    exemptChannels: [],
    action: 'warn', // delete | warn | timeout
    timeoutMinutes: 10,
    antiInvite: true,
    antiLinks: false,
    allowedDomains: ['tenor.com', 'giphy.com', 'youtube.com', 'youtu.be'],
    bannedWords: [],
    antiSpam: true,
    spamMessages: 6,
    spamSeconds: 5,
    antiDuplicate: true,
    antiMassMention: true,
    mentionLimit: 5,
    antiCaps: true,
    capsPercent: 70,
    capsMinLength: 12,
  },

  antiraid: {
    enabled: true,
    joinThreshold: 8,
    joinSeconds: 10,
    raidAction: 'kick', // kick | timeout | ban
    raidDurationMinutes: 10,
    lockdownOnRaid: false,
    alertRoleId: '',
    minAccountAgeDays: 0,
    youngAccountAction: 'flag', // flag | timeout | kick
    antiNuke: true,
    nukeThreshold: 3,
    nukeSeconds: 30,
    nukePunishment: 'strip', // strip | kick | ban
    antiBotAdd: true,
    whitelist: [],
  },

  tickets: {
    enabled: true,
    categoryId: '',
    supportRoles: [],
    transcriptChannelId: '',
    maxOpen: 1,
    panelChannelId: '',
    panelTitle: '🎫 Support Tickets',
    panelDescription: 'Need help? Pick a topic below and a private channel will be opened for you and our staff.',
    buttonLabel: 'Open a ticket',
    welcomeMessage: 'Hey {user}, thanks for reaching out! Describe your issue and a staff member will be with you shortly.',
    topics: ['General Support', 'Report a Member', 'Partnership'],
  },

  reactionRoles: {
    panels: [], // { id, channelId, messageId, title, description, mode, roles: [{ roleId, label, emoji }] }
    emoji: [], // { channelId, messageId, emoji, roleId }
  },

  afk: {
    enabled: true,
    nickPrefix: '[AFK] ',
  },

  economy: {
    enabled: true,
    currencyName: 'coins',
    currencyEmoji: '🪙',
    startingBalance: 100,
    daily: 250,
    weekly: 1500,
    workMin: 50,
    workMax: 300,
    workCooldownMinutes: 60,
    chatRewards: true,
    chatMin: 1,
    chatMax: 5,
    chatCooldownSeconds: 60,
    robEnabled: true,
    maxBet: 10000,
    shop: [], // { id, name, emoji, price, description, roleId }
  },

  announcements: {
    defaultChannelId: '',
    scheduled: [], // { id, channelId, title, message, pingRoleId, nextRun, repeatHours, enabled }
  },
};
