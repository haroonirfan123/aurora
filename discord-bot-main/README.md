# Aurora: all-in-one Discord bot

One bot that runs your whole server, with a web dashboard. Only the server owner and people with a role you choose can open the dashboard.

| Area | What it does |
|---|---|
| 🛡️ Moderation | `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/clearwarnings` `/purge` `/slowmode` `/lock` `/unlock`. Every action gets a numbered case in the mod log. Warnings can escalate on their own to a timeout, kick or ban. |
| 🤖 AutoMod | Catches spam, repeated messages, invites, links (with an allow-list), banned words, mass mentions and too many capitals. It can delete, warn or time out. You can exempt roles and channels. |
| 🚨 Anti-raid | Spots a burst of joins and turns on raid mode, which kicks, times out or bans new joiners and can lock the server. It can filter brand-new accounts. **Anti-nuke** stops anyone who mass-deletes channels or roles, mass-bans or spams webhooks. It also kicks bots added by people who aren't trusted. `/lockdown` and `/raidmode` are the manual controls. |
| 📜 Logging | Logs deleted, edited and bulk-deleted messages, joins and leaves, role and nickname changes, bans, channels, roles and voice. Server events and mod events can go to separate channels. |
| 🎫 Tickets | A panel with a button or topic menu opens a private channel. Staff can claim and close tickets, and a styled **HTML transcript** goes to a log channel and to the member. Also `/ticket add/remove/rename/close`. |
| 🎭 Reaction roles | Button panels built in the dashboard (pick any or pick one), plus classic emoji reactions with `/reactionrole`. |
| 💤 AFK | `/afk [reason]` adds an `[AFK]` nickname prefix and tells people who ping you that you're away. When you're back it shows who mentioned you. |
| 🪙 Economy | `/balance` `/daily` (with streaks) `/weekly` `/work` `/pay` `/deposit` `/withdraw` `/rob` `/coinflip` `/slots` `/leaderboard` `/shop` `/buy` `/inventory`, plus admin `/eco`. Members also earn coins by chatting. Shop items can give roles. |
| 🎉 Polls and giveaways | `/poll` uses buttons and live result bars. `/giveaway start/end/reroll/list` supports several winners and a required role. |
| ⏰ Reminders | `/remind in:2h about:...`, `/reminders list/cancel` |
| 📢 Announcements | `/announce` opens a form for a styled embed. The dashboard can send announcements now or schedule repeating ones. |
| 👋 Welcome | Welcome and leave messages, a welcome DM and auto-roles. |
| 🧭 General | `/help` (category menu), `/ping` `/serverinfo` `/userinfo` `/avatar` |

---

## Setup (about 10 minutes)

### 1. Install Node.js
Download the **LTS** version from https://nodejs.org (version 18.17 or newer).

### 2. Create the bot
1. Go to https://discord.com/developers/applications and click **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_TOKEN`.
3. On the same page, turn on all three **Privileged Gateway Intents**: Presence (optional), **Server Members** and **Message Content**.
4. **General Information** tab → copy **Application ID**. This is `CLIENT_ID`.
5. **OAuth2** tab → copy **Client Secret**. This is `CLIENT_SECRET`. Under **Redirects** add `http://localhost:3000/callback` and save.

### 3. Invite the bot
Open this link with your Application ID in place of `YOUR_CLIENT_ID`:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

`permissions=8` is Administrator, which keeps setup simple. Then go to **Server Settings → Roles** and **drag the bot's role near the top**. The bot can only manage members and roles that sit below its own role.

### 4. Create the dashboard role
Create a role such as **Bot Manager** and place it above your Admin role. Give it to the people who should control the bot. Turn on **Developer Mode** (User Settings → Advanced), then right-click the role → **Copy Role ID**. This is `DASHBOARD_ROLE_ID`. Right-click your server icon → **Copy Server ID**. This is `GUILD_ID`.

### 5. Configure and run
```bash
cd discord-bot
copy .env.example .env      # on Mac/Linux: cp .env.example .env
```
Open `.env`, fill in the values, then:
```bash
npm install
npm start
```
You should see:
```
✓ Registered 44 slash commands in Your Server
✓ Logged in as Aurora#1234
✓ Dashboard running at http://localhost:3000
```
Open **http://localhost:3000**, sign in with Discord, and set everything up. A good order is: **Logging** (pick channels) → **Tickets** (pick a category and support roles, then post the panel) → **AutoMod** and **Anti-Raid** → everything else.

---

## Hosting 24/7 for free (Oracle Cloud Always Free)

The bot and dashboard run together on one free Oracle Cloud server, with automatic HTTPS. Your data stays on the server's disk.

### 1. Create the server (in your browser, ~10 min)
1. Sign up at https://signup.cloud.oracle.com. It asks for a card to verify your identity, but Always Free resources are never charged. Pick a **home region** near you; you can't change it later.
2. **Menu → Compute → Instances → Create instance**
   - **Image:** Canonical **Ubuntu 24.04**
   - **Shape:** Change shape → **Ampere** → `VM.Standard.A1.Flex`, 1 OCPU and 6 GB memory (this is labelled *Always Free eligible*). If it says "out of capacity", try again later or choose `VM.Standard.E2.1.Micro`.
   - **SSH keys:** *Generate a key pair* → **download the private key**. Save it as `C:\Users\<you>\.ssh\oracle.key`.
   - Click **Create** and copy the **Public IP address** when it's running.
3. Open the web ports: on the instance page click the **Subnet** → **Default Security List** → **Add Ingress Rules**:
   Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port range `80,443` → **Add**.

### 2. Upload the bot (from your PC)
Open a terminal in the bot folder and pack it. This leaves out `node_modules`, your data and your `.env`:
```bash
npm run bundle
```
Then upload it and log in to the server, with your server's IP in place of `YOUR_IP`:
```bash
scp -i ~/.ssh/oracle.key aurora-bot.tgz ubuntu@YOUR_IP:~
```
```bash
ssh -i ~/.ssh/oracle.key ubuntu@YOUR_IP
```
If Windows complains that the key's permissions are too open, right-click the key → Properties → Security → Advanced → disable inheritance, then remove everyone except yourself.

### 3. Install and start it (on the server)
```bash
mkdir -p aurora-bot && tar -xzf aurora-bot.tgz -C aurora-bot && cd aurora-bot && bash deploy/setup.sh
```
The script installs everything and gives you a free HTTPS address like `https://129-146-1-2.sslip.io`. This is your dashboard. Then add your secrets as environment variables:
```bash
sudo nano /etc/aurora-bot.env
```
Fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `CLIENT_SECRET` and `DASHBOARD_ROLE_ID` (the URL and session secret are already filled in). Save with Ctrl+O, Enter, Ctrl+X, then:
```bash
sudo systemctl restart aurora-bot
```
Finally, in the Discord Developer Portal → **OAuth2 → Redirects**, add the `https://…sslip.io/callback` address the script printed.

Have your own domain? Point it at the server's IP, then run `DOMAIN=dash.yourdomain.com bash deploy/setup.sh` and change `DASHBOARD_URL` in `/etc/aurora-bot.env` to match.

**Useful commands on the server**
- Live logs: `journalctl -u aurora-bot -f`
- Restart: `sudo systemctl restart aurora-bot`
- Update to a new version: run `npm run bundle` and the `scp` command again, then on the server run the step 3 command again. Your data and secrets are kept.

---

## Hosting on Railway (easiest, paid)

Railway is simpler than Oracle: no server to manage, and secrets are typed into a web page. It isn't free long-term: after the trial credit it's the Hobby plan, about $5/month. Check https://railway.com/pricing for current prices.

1. Put this folder in a **private** GitHub repo. `.gitignore` already keeps `.env`, `data/` and `node_modules` out.
2. At https://railway.com: **New Project → Deploy from GitHub repo** → pick the repo. Railway detects Node.js and runs `npm start`.
3. Open the service → **Variables** and add `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `CLIENT_SECRET` and `DASHBOARD_ROLE_ID`. Add `SESSION_SECRET` (any long random text) and `DATA_DIR=/data`.
4. **Keep your data:** right-click the service → **Attach volume** → mount path `/data`. Without this, warnings and the economy reset on every deploy.
5. **Settings → Networking → Generate Domain.** The bot picks up this address automatically.
6. In the Discord Developer Portal → **OAuth2 → Redirects**, add `https://<your-app>.up.railway.app/callback`.

Every push to GitHub redeploys the bot automatically. Logs are in the service's **Deployments** tab.

---

## Good to know

- **Data** is saved in `data/db.json`. Back up that file to keep warnings, the economy and other data.
- **Settings are live.** Changes saved in the dashboard apply right away, with no restart.
- **Trusted users:** the anti-nuke and bot-add protection skips the server owner and the user IDs in *Anti-Raid → Trusted user IDs*. Add your co-owners there, or they'll be stopped when they delete channels in bulk.
- **Hosting 24/7:** see *Hosting 24/7 for free* above.
- `npm run check` loads every command without logging in, which is handy after you make edits.

## Project layout
```
src/
  index.js            starts the bot, routes commands/buttons, runs the 15s timer
  config/defaults.js  every setting and its default value
  commands/           slash commands, grouped by category
  modules/            features: automod, antiraid, logging, tickets, polls…
  lib/                database, embed theme, moderation helpers
  dashboard/          web server + the dashboard page (public/)
```
To add a command, add `{ data, execute }` to the array in any file in `src/commands/`. It's registered automatically on the next start.
